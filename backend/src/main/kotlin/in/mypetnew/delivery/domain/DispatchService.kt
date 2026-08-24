package `in`.mypetnew.delivery.domain

import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

enum class DispatchStatus {
    SEARCHING,
    OFFERED,
    ASSIGNED,
    PICKED_UP,
    DELIVERED,
    FAILED,
}

enum class DispatchOfferStatus {
    PENDING,
    ACCEPTED,
    REJECTED,
    TIMED_OUT,
}

data class CaptainLocation(
    val latitude: Double,
    val longitude: Double,
    val observedAt: Instant,
)

data class CaptainDeliveryState(
    val captainId: UUID,
    val approved: Boolean = false,
    val online: Boolean = false,
    val busy: Boolean = false,
    val lastLocationAt: Instant? = null,
)

data class DeliveryProof(
    val type: String = "PIN",
    val pinCode: String,
    val capturedAt: Instant = Instant.now(),
)

data class DispatchJob(
    val id: UUID,
    val orderId: UUID,
    val outletId: UUID,
    val originLatitude: Double,
    val originLongitude: Double,
    val status: DispatchStatus,
    val assignedCaptainId: UUID? = null,
    val attemptCount: Int = 0,
    val failureReason: String? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
    val assignedAt: Instant? = null,
    val pickedUpAt: Instant? = null,
    val deliveredAt: Instant? = null,
    val pickupPin: String = "1234",
    val deliveryPin: String = "5678",
    val pickupIdempotencyKey: String? = null,
    val pickupFingerprint: String? = null,
    val pickupProofPayload: String? = null,
    val deliveryIdempotencyKey: String? = null,
    val deliveryFingerprint: String? = null,
    val deliveryProofPayload: String? = null,
)

data class DispatchOffer(
    val id: UUID,
    val jobId: UUID,
    val captainId: UUID,
    val rank: Int,
    val status: DispatchOfferStatus,
    val offeredAt: Instant,
    val expiresAt: Instant,
    val respondedAt: Instant? = null,
)

interface DispatchPersistence {
    fun <T> inTransaction(block: () -> T): T
    fun approveCaptain(captainId: UUID): CaptainDeliveryState
    fun updateCaptainPresence(captainId: UUID, online: Boolean, lastLocationAt: Instant?): CaptainDeliveryState
    fun updateCaptainBusy(captainId: UUID, busy: Boolean): CaptainDeliveryState
    fun captainState(captainId: UUID): CaptainDeliveryState?
    fun lockCaptainState(captainId: UUID): CaptainDeliveryState?
    fun findJobByOrder(orderId: UUID): DispatchJob?
    fun getJob(jobId: UUID): DispatchJob?
    fun findActiveJobByCaptain(captainId: UUID): DispatchJob?
    fun createJob(job: DispatchJob): DispatchJob
    fun saveJob(job: DispatchJob): DispatchJob
    fun activeJobs(): List<DispatchJob>
    fun offers(jobId: UUID): List<DispatchOffer>
    fun pendingOffers(captainId: UUID): List<DispatchOffer>
    fun getOffer(offerId: UUID): DispatchOffer?
    fun createOffer(offer: DispatchOffer): DispatchOffer
    fun saveOffer(offer: DispatchOffer): DispatchOffer
}

interface CaptainGeoIndex {
    fun update(captainId: UUID, location: CaptainLocation)
    fun remove(captainId: UUID)
    fun location(captainId: UUID): CaptainLocation?
    fun nearest(latitude: Double, longitude: Double, radiusKm: Double, limit: Int): List<UUID>
}

class InMemoryCaptainGeoIndex : CaptainGeoIndex {
    private val locations = mutableMapOf<UUID, CaptainLocation>()

    @Synchronized
    override fun update(captainId: UUID, location: CaptainLocation) {
        val current = locations[captainId]
        if (current == null || !location.observedAt.isBefore(current.observedAt)) {
            locations[captainId] = location
        }
    }

    @Synchronized
    override fun remove(captainId: UUID) {
        locations.remove(captainId)
    }

    @Synchronized
    override fun location(captainId: UUID): CaptainLocation? = locations[captainId]

    @Synchronized
    override fun nearest(latitude: Double, longitude: Double, radiusKm: Double, limit: Int): List<UUID> =
        locations.entries
            .map { (captainId, location) -> captainId to distanceKm(latitude, longitude, location.latitude, location.longitude) }
            .filter { it.second <= radiusKm }
            .sortedWith(compareBy<Pair<UUID, Double>> { it.second }.thenBy { it.first.toString() })
            .take(limit)
            .map { it.first }

    private fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val earthRadiusKm = 6_371.0088
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        return 2 * earthRadiusKm * asin(sqrt(a.coerceIn(0.0, 1.0)))
    }
}

class DispatchService(
    private val persistence: DispatchPersistence,
    private val geoIndex: CaptainGeoIndex,
    private val orders: OrderService,
    private val clock: Clock = Clock.systemUTC(),
    private val locationFreshness: Duration = Duration.ofMinutes(2),
    private val offerLifetime: Duration = Duration.ofSeconds(30),
    private val searchRadiusKm: Double = 5.0,
    private val maxAttempts: Int = 10,
    private val offerNotifier: (DispatchOffer) -> Unit = {},
) {
    private val random = SecureRandom()

    fun approveCaptain(captainId: UUID): CaptainDeliveryState = persistence.approveCaptain(captainId)

    fun updateAvailability(
        captainId: UUID,
        online: Boolean,
        latitude: Double? = null,
        longitude: Double? = null,
        accuracy: Double? = null,
        capturedAt: Instant? = null,
        heading: Double? = null,
        speed: Double? = null,
    ): CaptainDeliveryState {
        val now = clock.instant()
        val location = validatedLocation(latitude, longitude, accuracy, capturedAt, now)
        if (online && location == null) {
            throw DomainException("CAPTAIN_LOCATION_REQUIRED", "An online captain must provide a current location")
        }
        val state = persistence.inTransaction {
            // Serialize availability with offer acceptance on the Captain row. The
            // persistence guard below is a second line of defense for JDBC races.
            val currentState = persistence.lockCaptainState(captainId)
            if (online && currentState?.approved != true) {
                throw DomainException(
                    "CAPTAIN_NOT_APPROVED",
                    "Captain approval is required before going online",
                )
            }
            if (!online && persistence.findActiveJobByCaptain(captainId) != null) {
                throw DomainException(
                    "CAPTAIN_ACTIVE_DELIVERY",
                    "A captain with an active delivery cannot go offline",
                )
            }
            if (
                location != null &&
                currentState?.lastLocationAt != null &&
                location.observedAt.isBefore(currentState.lastLocationAt)
            ) {
                throw DomainException(
                    "LOCATION_OUT_OF_ORDER",
                    "The location fix is older than the latest accepted coordinate",
                )
            }
            val updatedState = persistence.updateCaptainPresence(captainId, online, location?.observedAt)
            // Keep the geo-index side effect inside the Captain-row serialization window
            // so a delayed online upload cannot re-add a Captain after a newer offline commit.
            if (online && location != null) geoIndex.update(captainId, location) else geoIndex.remove(captainId)
            updatedState
        }
        return state
    }

    /**
     * Records telemetry without mutating the Captain's explicit availability choice.
     * Captain-row locking makes this serialize with go-offline: an older telemetry
     * request can finish first, but it can never re-enable presence after offline commits.
     */
    fun updateLocation(
        captainId: UUID,
        latitude: Double?,
        longitude: Double?,
        accuracy: Double? = null,
        capturedAt: Instant? = null,
        heading: Double? = null,
        speed: Double? = null,
    ): CaptainDeliveryState {
        val now = clock.instant()
        val location = validatedLocation(latitude, longitude, accuracy, capturedAt, now)
            ?: throw DomainException("CAPTAIN_LOCATION_REQUIRED", "Captain telemetry requires a current location")
        return persistence.inTransaction {
            val currentState = persistence.lockCaptainState(captainId) ?: unavailable()
            if (!currentState.online && !currentState.busy) {
                throw DomainException(
                    "CAPTAIN_OFFLINE",
                    "Location telemetry is not accepted while the Captain is offline",
                )
            }
            if (
                currentState.lastLocationAt != null &&
                location.observedAt.isBefore(currentState.lastLocationAt)
            ) {
                throw DomainException(
                    "LOCATION_OUT_OF_ORDER",
                    "The location fix is older than the latest accepted coordinate",
                )
            }
            val state = persistence.updateCaptainPresence(
                captainId,
                currentState.online || currentState.busy,
                location.observedAt,
            )
            geoIndex.update(captainId, location)
            state
        }
    }

    fun start(
        order: ProductOrder,
        originLatitude: Double,
        originLongitude: Double,
        customPickupPin: String? = null,
        customDeliveryPin: String? = null,
    ): DispatchJob {
        if (order.fulfilmentMode != DELIVERY_MODE || order.status != OrderStatus.READY_FOR_PICKUP) {
            throw DomainException("DISPATCH_ORDER_INVALID", "Dispatch can start only for a ready Captain-delivery order")
        }
        validateLocation(originLatitude, originLongitude)
        persistence.findJobByOrder(order.id)?.let { return it }
        val now = clock.instant()
        val generatedPickup = customPickupPin ?: "%04d".format(random.nextInt(10000))
        val generatedDelivery = customDeliveryPin ?: "%04d".format(random.nextInt(10000))
        val job = persistence.createJob(
            DispatchJob(
                id = UUID.randomUUID(),
                orderId = order.id,
                outletId = order.outletId,
                originLatitude = originLatitude,
                originLongitude = originLongitude,
                status = DispatchStatus.SEARCHING,
                createdAt = now,
                updatedAt = now,
                pickupPin = generatedPickup,
                deliveryPin = generatedDelivery,
            ),
        )
        return offerNext(job.id)
    }

    fun pendingOffers(captainId: UUID): List<DispatchOffer> = persistence.pendingOffers(captainId)
        .filter { it.status == DispatchOfferStatus.PENDING && clock.instant().isBefore(it.expiresAt) }

    fun respondToOffer(captainId: UUID, offerId: UUID, accept: Boolean): DispatchJob {
        val result = persistence.inTransaction {
            val offer = persistence.getOffer(offerId) ?: unavailable()
            if (offer.captainId != captainId) unavailable()
            if (offer.status == DispatchOfferStatus.ACCEPTED && accept) {
                val assigned = requireJob(offer.jobId)
                if (
                    assigned.assignedCaptainId == captainId &&
                    assigned.status in setOf(DispatchStatus.ASSIGNED, DispatchStatus.PICKED_UP, DispatchStatus.DELIVERED)
                ) {
                    return@inTransaction assigned
                }
                throw DomainException("DISPATCH_CONFLICT", "The accepted delivery assignment changed unexpectedly")
            }
            if (offer.status == DispatchOfferStatus.REJECTED && !accept) {
                return@inTransaction requireJob(offer.jobId)
            }
            if (offer.status != DispatchOfferStatus.PENDING) {
                throw DomainException("DISPATCH_OFFER_RESOLVED", "The dispatch offer is already resolved")
            }
            val now = clock.instant()
            if (!now.isBefore(offer.expiresAt)) {
                persistence.saveOffer(offer.copy(status = DispatchOfferStatus.TIMED_OUT, respondedAt = now))
                val timedOutJob = requireJob(offer.jobId)
                persistence.saveJob(timedOutJob.copy(status = DispatchStatus.SEARCHING, updatedAt = now))
                throw DomainException("DISPATCH_OFFER_EXPIRED", "The dispatch offer expired")
            }
            val job = requireJob(offer.jobId)
            if (job.status != DispatchStatus.OFFERED || job.assignedCaptainId != null) {
                throw DomainException("DISPATCH_CONFLICT", "The delivery was already assigned or changed")
            }
            if (!accept) {
                persistence.saveOffer(offer.copy(status = DispatchOfferStatus.REJECTED, respondedAt = now))
                return@inTransaction persistence.saveJob(job.copy(status = DispatchStatus.SEARCHING, updatedAt = now))
            }
            val lockedCaptainState = persistence.lockCaptainState(captainId)
            if (!eligible(captainId, now, lockedCaptainState)) {
                throw DomainException("CAPTAIN_NOT_ELIGIBLE", "The captain is no longer eligible for this delivery")
            }
            persistence.saveOffer(offer.copy(status = DispatchOfferStatus.ACCEPTED, respondedAt = now))
            persistence.updateCaptainBusy(captainId, true)
            persistence.saveJob(
                job.copy(
                    status = DispatchStatus.ASSIGNED,
                    assignedCaptainId = captainId,
                    assignedAt = now,
                    updatedAt = now,
                    failureReason = null,
                ),
            )
        }
        return if (accept) result else offerNext(result.id)
    }

    fun markPickedUp(
        captainId: UUID,
        jobId: UUID,
        proof: DeliveryProof,
        idempotencyKey: String,
    ): DispatchJob = persistence.inTransaction {
        validateIdempotencyKey(idempotencyKey)
        validateProof(proof)
        val fingerprint = sha256("${proof.type}:${proof.pinCode}")
        val job = requireAssignedJob(jobId, captainId, setOf(DispatchStatus.ASSIGNED, DispatchStatus.PICKED_UP))
        if (job.status == DispatchStatus.PICKED_UP) {
            if (job.pickupIdempotencyKey == idempotencyKey) {
                if (job.pickupFingerprint == fingerprint) {
                    return@inTransaction job
                }
                throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "The idempotency key was already used for another request")
            }
            throw DomainException("DISPATCH_CONFLICT", "The delivery job is already picked up")
        }
        if (proof.pinCode != job.pickupPin) {
            throw DomainException("PROOF_INVALID", "The pickup verification code is incorrect")
        }
        orders.transition(
            orderId = job.orderId,
            target = OrderStatus.PICKED_UP,
            idempotencyKey = idempotencyKey,
            actorId = captainId,
            actorRole = Role.CAPTAIN,
            traceId = "dispatch:${job.id}",
        )
        val now = clock.instant()
        persistence.saveJob(
            job.copy(
                status = DispatchStatus.PICKED_UP,
                pickedUpAt = now,
                updatedAt = now,
                pickupIdempotencyKey = idempotencyKey,
                pickupFingerprint = fingerprint,
                pickupProofPayload = """{"type":"${proof.type}","capturedAt":"${proof.capturedAt}"}""",
            ),
        )
    }

    fun markDelivered(
        captainId: UUID,
        jobId: UUID,
        proof: DeliveryProof,
        idempotencyKey: String,
    ): DispatchJob = persistence.inTransaction {
        validateIdempotencyKey(idempotencyKey)
        validateProof(proof)
        val fingerprint = sha256("${proof.type}:${proof.pinCode}")
        val job = requireAssignedJob(jobId, captainId, setOf(DispatchStatus.PICKED_UP, DispatchStatus.DELIVERED))
        if (job.status == DispatchStatus.DELIVERED) {
            if (job.deliveryIdempotencyKey == idempotencyKey) {
                if (job.deliveryFingerprint == fingerprint) {
                    return@inTransaction job
                }
                throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "The idempotency key was already used for another request")
            }
            throw DomainException("DISPATCH_CONFLICT", "The delivery job is already delivered")
        }
        if (proof.pinCode != job.deliveryPin) {
            throw DomainException("PROOF_INVALID", "The delivery verification code is incorrect")
        }
        orders.transition(
            orderId = job.orderId,
            target = OrderStatus.DELIVERED,
            idempotencyKey = idempotencyKey,
            actorId = captainId,
            actorRole = Role.CAPTAIN,
            traceId = "dispatch:${job.id}",
        )
        val now = clock.instant()
        persistence.updateCaptainBusy(captainId, false)
        persistence.saveJob(
            job.copy(
                status = DispatchStatus.DELIVERED,
                deliveredAt = now,
                updatedAt = now,
                deliveryIdempotencyKey = idempotencyKey,
                deliveryFingerprint = fingerprint,
                deliveryProofPayload = """{"type":"${proof.type}","capturedAt":"${proof.capturedAt}"}""",
            ),
        )
    }

    fun retryPendingDispatches() {
        val now = clock.instant()
        persistence.activeJobs().forEach { job ->
            when (job.status) {
                DispatchStatus.SEARCHING -> offerNext(job.id)
                DispatchStatus.OFFERED -> {
                    val pending = persistence.offers(job.id).firstOrNull { it.status == DispatchOfferStatus.PENDING }
                    if (pending != null && !now.isBefore(pending.expiresAt)) {
                        persistence.inTransaction {
                            val current = persistence.getOffer(pending.id) ?: return@inTransaction
                            if (current.status != DispatchOfferStatus.PENDING) return@inTransaction
                            persistence.saveOffer(current.copy(status = DispatchOfferStatus.TIMED_OUT, respondedAt = now))
                            val currentJob = requireJob(job.id)
                            if (currentJob.status == DispatchStatus.OFFERED) {
                                persistence.saveJob(currentJob.copy(status = DispatchStatus.SEARCHING, updatedAt = now))
                            }
                        }
                        offerNext(job.id)
                    }
                }
                else -> Unit
            }
        }
    }

    fun tracking(orderId: UUID): DispatchJob? = persistence.findJobByOrder(orderId)

    fun getCaptainJob(captainId: UUID, jobId: UUID): DispatchJob {
        val job = persistence.getJob(jobId) ?: unavailable()
        if (job.assignedCaptainId != captainId) unavailable()
        return job
    }

    fun findActiveJob(captainId: UUID): DispatchJob? = persistence.findActiveJobByCaptain(captainId)

    fun captainState(captainId: UUID): CaptainDeliveryState? = persistence.captainState(captainId)

    fun captainLocation(captainId: UUID): CaptainLocation? = geoIndex.location(captainId)

    private fun offerNext(jobId: UUID): DispatchJob {
        var createdOffer: DispatchOffer? = null
        val result = persistence.inTransaction {
            val job = requireJob(jobId)
            if (job.status != DispatchStatus.SEARCHING) return@inTransaction job
            val now = clock.instant()
            if (job.attemptCount >= maxAttempts) {
                return@inTransaction persistence.saveJob(
                    job.copy(status = DispatchStatus.FAILED, failureReason = "MAX_ATTEMPTS_EXHAUSTED", updatedAt = now),
                )
            }
            val attempted = persistence.offers(job.id).map { it.captainId }.toSet()
            val candidate = geoIndex.nearest(job.originLatitude, job.originLongitude, searchRadiusKm, 50)
                .firstOrNull { it !in attempted && eligible(it, now) }
            if (candidate == null) {
                return@inTransaction persistence.saveJob(
                    job.copy(
                        failureReason = "NO_ELIGIBLE_CAPTAIN",
                        status = DispatchStatus.SEARCHING,
                        updatedAt = now,
                    ),
                )
            }
            val nextAttempt = job.attemptCount + 1
            val offer = DispatchOffer(
                id = UUID.randomUUID(),
                jobId = job.id,
                captainId = candidate,
                rank = nextAttempt,
                status = DispatchOfferStatus.PENDING,
                offeredAt = now,
                expiresAt = now.plus(offerLifetime),
            )
            persistence.createOffer(offer)
            createdOffer = offer
            persistence.saveJob(
                job.copy(
                    status = DispatchStatus.OFFERED,
                    attemptCount = nextAttempt,
                    failureReason = null,
                    updatedAt = now,
                ),
            )
        }
        createdOffer?.let { runCatching { offerNotifier(it) } }
        return result
    }

    private fun eligible(
        captainId: UUID,
        now: Instant,
        knownState: CaptainDeliveryState? = persistence.captainState(captainId),
    ): Boolean {
        val state = knownState ?: return false
        val lastLocationAt = state.lastLocationAt ?: return false
        return state.approved && state.online && !state.busy && !lastLocationAt.isBefore(now.minus(locationFreshness))
    }

    private fun requireAssignedJob(jobId: UUID, captainId: UUID, allowed: Set<DispatchStatus>): DispatchJob {
        val job = requireJob(jobId)
        if (job.assignedCaptainId != captainId || job.status !in allowed) unavailable()
        return job
    }

    private fun requireJob(jobId: UUID): DispatchJob = persistence.getJob(jobId) ?: unavailable()

    private fun validatedLocation(
        latitude: Double?,
        longitude: Double?,
        accuracy: Double?,
        capturedAt: Instant?,
        now: Instant,
    ): CaptainLocation? {
        if ((latitude == null) != (longitude == null)) invalidLocation()
        if (accuracy != null) {
            if (accuracy < 0.0 || accuracy.isNaN() || accuracy.isInfinite()) invalidLocation()
            if (accuracy > 200.0) {
                throw DomainException(
                    "LOCATION_ACCURACY_INSUFFICIENT",
                    "A precise location fix is required for Captain tracking",
                )
            }
        }
        if (
            capturedAt != null &&
            (capturedAt.isBefore(now.minus(locationFreshness)) || capturedAt.isAfter(now.plusSeconds(60)))
        ) {
            throw DomainException("LOCATION_STALE", "Location coordinate timestamp is stale or in the future")
        }
        if (latitude == null || longitude == null) return null
        if (
            latitude !in -90.0..90.0 ||
            longitude !in -180.0..180.0 ||
            latitude.isNaN() ||
            longitude.isNaN() ||
            latitude.isInfinite() ||
            longitude.isInfinite()
        ) {
            invalidLocation()
        }
        return CaptainLocation(latitude, longitude, capturedAt ?: now)
    }

    private fun validateLocation(latitude: Double, longitude: Double) {
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) invalidLocation()
    }

    private fun validateProof(proof: DeliveryProof) {
        if (proof.type != "PIN") {
            throw DomainException("PROOF_TYPE_UNSUPPORTED", "Only PIN verification is supported")
        }
        if (!proof.pinCode.matches(Regex("[0-9]{4,8}"))) {
            throw DomainException("PROOF_INVALID", "Verification code must be 4 to 8 digits")
        }
    }

    private fun validateIdempotencyKey(key: String) {
        if (!key.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun invalidLocation(): Nothing = throw DomainException(
        "LOCATION_INVALID",
        "The supplied location is invalid",
    )

    private fun unavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )

    companion object {
        const val DELIVERY_MODE = "MYPET_CAPTAIN_DELIVERY"
    }
}

class InMemoryDispatchPersistence : DispatchPersistence {
    private val monitor = Any()
    private val captains = mutableMapOf<UUID, CaptainDeliveryState>()
    private val jobs = mutableMapOf<UUID, DispatchJob>()
    private val jobByOrder = mutableMapOf<UUID, UUID>()
    private val offersById = mutableMapOf<UUID, DispatchOffer>()

    override fun <T> inTransaction(block: () -> T): T = synchronized(monitor) { block() }

    override fun approveCaptain(captainId: UUID): CaptainDeliveryState = synchronized(monitor) {
        val state = captains[captainId] ?: CaptainDeliveryState(captainId)
        state.copy(approved = true).also { captains[captainId] = it }
    }

    override fun updateCaptainPresence(
        captainId: UUID,
        online: Boolean,
        lastLocationAt: Instant?,
    ): CaptainDeliveryState = synchronized(monitor) {
        val state = captains[captainId] ?: CaptainDeliveryState(captainId)
        state.copy(online = online, lastLocationAt = lastLocationAt ?: state.lastLocationAt).also { captains[captainId] = it }
    }

    override fun updateCaptainBusy(captainId: UUID, busy: Boolean): CaptainDeliveryState = synchronized(monitor) {
        val state = captains[captainId] ?: CaptainDeliveryState(captainId)
        state.copy(busy = busy).also { captains[captainId] = it }
    }

    override fun captainState(captainId: UUID): CaptainDeliveryState? = synchronized(monitor) { captains[captainId] }

    override fun lockCaptainState(captainId: UUID): CaptainDeliveryState? =
        synchronized(monitor) { captains[captainId] }

    override fun findJobByOrder(orderId: UUID): DispatchJob? = synchronized(monitor) {
        jobByOrder[orderId]?.let { jobs[it] }
    }

    override fun getJob(jobId: UUID): DispatchJob? = synchronized(monitor) { jobs[jobId] }

    override fun findActiveJobByCaptain(captainId: UUID): DispatchJob? = synchronized(monitor) {
        jobs.values.firstOrNull {
            it.assignedCaptainId == captainId && (it.status == DispatchStatus.ASSIGNED || it.status == DispatchStatus.PICKED_UP)
        }
    }

    override fun createJob(job: DispatchJob): DispatchJob = synchronized(monitor) {
        jobByOrder[job.orderId]?.let { existing -> return@synchronized requireNotNull(jobs[existing]) }
        jobs[job.id] = job
        jobByOrder[job.orderId] = job.id
        job
    }

    override fun saveJob(job: DispatchJob): DispatchJob = synchronized(monitor) {
        if (!jobs.containsKey(job.id)) unavailable()
        jobs[job.id] = job
        job
    }

    override fun activeJobs(): List<DispatchJob> = synchronized(monitor) {
        jobs.values.filter { it.status == DispatchStatus.SEARCHING || it.status == DispatchStatus.OFFERED }.toList()
    }

    override fun offers(jobId: UUID): List<DispatchOffer> = synchronized(monitor) {
        offersById.values.filter { it.jobId == jobId }.sortedBy { it.rank }
    }

    override fun pendingOffers(captainId: UUID): List<DispatchOffer> = synchronized(monitor) {
        offersById.values.filter { it.captainId == captainId && it.status == DispatchOfferStatus.PENDING }
            .sortedBy { it.offeredAt }
    }

    override fun getOffer(offerId: UUID): DispatchOffer? = synchronized(monitor) { offersById[offerId] }

    override fun createOffer(offer: DispatchOffer): DispatchOffer = synchronized(monitor) {
        offersById[offer.id] = offer
        offer
    }

    override fun saveOffer(offer: DispatchOffer): DispatchOffer = synchronized(monitor) {
        if (!offersById.containsKey(offer.id)) unavailable()
        offersById[offer.id] = offer
        offer
    }

    private fun unavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )
}
