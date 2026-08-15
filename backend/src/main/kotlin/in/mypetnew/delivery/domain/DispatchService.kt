package `in`.mypetnew.delivery.domain

import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
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
    val lastLocation: CaptainLocation? = null,
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
    fun updateCaptainPresence(captainId: UUID, online: Boolean, location: CaptainLocation?): CaptainDeliveryState
    fun updateCaptainBusy(captainId: UUID, busy: Boolean): CaptainDeliveryState
    fun captainState(captainId: UUID): CaptainDeliveryState?
    fun findJobByOrder(orderId: UUID): DispatchJob?
    fun getJob(jobId: UUID): DispatchJob?
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
    fun nearest(latitude: Double, longitude: Double, radiusKm: Double, limit: Int): List<UUID>
}

class InMemoryCaptainGeoIndex : CaptainGeoIndex {
    private val locations = mutableMapOf<UUID, CaptainLocation>()

    @Synchronized
    override fun update(captainId: UUID, location: CaptainLocation) {
        locations[captainId] = location
    }

    @Synchronized
    override fun remove(captainId: UUID) {
        locations.remove(captainId)
    }

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
) {
    fun approveCaptain(captainId: UUID): CaptainDeliveryState = persistence.approveCaptain(captainId)

    fun updateAvailability(
        captainId: UUID,
        online: Boolean,
        latitude: Double? = null,
        longitude: Double? = null,
    ): CaptainDeliveryState {
        if ((latitude == null) != (longitude == null)) invalidLocation()
        val location = if (latitude != null && longitude != null) {
            if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) invalidLocation()
            CaptainLocation(latitude, longitude, clock.instant())
        } else {
            null
        }
        if (online && location == null) {
            throw DomainException("CAPTAIN_LOCATION_REQUIRED", "An online captain must provide a current location")
        }
        val state = persistence.updateCaptainPresence(captainId, online, location)
        if (online && location != null) geoIndex.update(captainId, location) else geoIndex.remove(captainId)
        return state
    }

    fun start(order: ProductOrder, originLatitude: Double, originLongitude: Double): DispatchJob {
        if (order.fulfilmentMode != DELIVERY_MODE || order.status != OrderStatus.READY_FOR_PICKUP) {
            throw DomainException("DISPATCH_ORDER_INVALID", "Dispatch can start only for a ready Captain-delivery order")
        }
        validateLocation(originLatitude, originLongitude)
        persistence.findJobByOrder(order.id)?.let { return it }
        val now = clock.instant()
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
            if (!eligible(captainId, now)) {
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

    fun markPickedUp(captainId: UUID, jobId: UUID, idempotencyKey: String): DispatchJob = persistence.inTransaction {
        val job = requireAssignedJob(jobId, captainId, setOf(DispatchStatus.ASSIGNED, DispatchStatus.PICKED_UP))
        if (job.status == DispatchStatus.PICKED_UP) return@inTransaction job
        orders.transition(
            orderId = job.orderId,
            target = OrderStatus.PICKED_UP,
            idempotencyKey = idempotencyKey,
            actorId = captainId,
            actorRole = Role.CAPTAIN,
            traceId = "dispatch:${job.id}",
        )
        val now = clock.instant()
        persistence.saveJob(job.copy(status = DispatchStatus.PICKED_UP, pickedUpAt = now, updatedAt = now))
    }

    fun markDelivered(captainId: UUID, jobId: UUID, idempotencyKey: String): DispatchJob = persistence.inTransaction {
        val job = requireAssignedJob(jobId, captainId, setOf(DispatchStatus.PICKED_UP, DispatchStatus.DELIVERED))
        if (job.status == DispatchStatus.DELIVERED) return@inTransaction job
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
        persistence.saveJob(job.copy(status = DispatchStatus.DELIVERED, deliveredAt = now, updatedAt = now))
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

    fun captainState(captainId: UUID): CaptainDeliveryState? = persistence.captainState(captainId)

    private fun offerNext(jobId: UUID): DispatchJob = persistence.inTransaction {
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
        val nextAttempt = job.attemptCount + 1
        if (candidate == null) {
            return@inTransaction persistence.saveJob(
                job.copy(
                    attemptCount = nextAttempt,
                    failureReason = "NO_ELIGIBLE_CAPTAIN",
                    status = if (nextAttempt >= maxAttempts) DispatchStatus.FAILED else DispatchStatus.SEARCHING,
                    updatedAt = now,
                ),
            )
        }
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
        persistence.saveJob(
            job.copy(
                status = DispatchStatus.OFFERED,
                attemptCount = nextAttempt,
                failureReason = null,
                updatedAt = now,
            ),
        )
    }

    private fun eligible(captainId: UUID, now: Instant): Boolean {
        val state = persistence.captainState(captainId) ?: return false
        val location = state.lastLocation ?: return false
        return state.approved && state.online && !state.busy && !location.observedAt.isBefore(now.minus(locationFreshness))
    }

    private fun requireAssignedJob(jobId: UUID, captainId: UUID, allowed: Set<DispatchStatus>): DispatchJob {
        val job = requireJob(jobId)
        if (job.assignedCaptainId != captainId || job.status !in allowed) unavailable()
        return job
    }

    private fun requireJob(jobId: UUID): DispatchJob = persistence.getJob(jobId) ?: unavailable()

    private fun validateLocation(latitude: Double, longitude: Double) {
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) invalidLocation()
    }

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
    private val offers = mutableMapOf<UUID, DispatchOffer>()

    override fun <T> inTransaction(block: () -> T): T = synchronized(monitor) { block() }

    override fun approveCaptain(captainId: UUID): CaptainDeliveryState = synchronized(monitor) {
        val state = captains[captainId] ?: CaptainDeliveryState(captainId)
        state.copy(approved = true).also { captains[captainId] = it }
    }

    override fun updateCaptainPresence(
        captainId: UUID,
        online: Boolean,
        location: CaptainLocation?,
    ): CaptainDeliveryState = synchronized(monitor) {
        val state = captains[captainId] ?: CaptainDeliveryState(captainId)
        state.copy(online = online, lastLocation = location ?: state.lastLocation).also { captains[captainId] = it }
    }

    override fun updateCaptainBusy(captainId: UUID, busy: Boolean): CaptainDeliveryState = synchronized(monitor) {
        val state = captains[captainId] ?: CaptainDeliveryState(captainId)
        state.copy(busy = busy).also { captains[captainId] = it }
    }

    override fun captainState(captainId: UUID): CaptainDeliveryState? = synchronized(monitor) { captains[captainId] }

    override fun findJobByOrder(orderId: UUID): DispatchJob? = synchronized(monitor) { jobByOrder[orderId]?.let(jobs::get) }

    override fun getJob(jobId: UUID): DispatchJob? = synchronized(monitor) { jobs[jobId] }

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
        offers.values.filter { it.jobId == jobId }.sortedBy { it.rank }
    }

    override fun pendingOffers(captainId: UUID): List<DispatchOffer> = synchronized(monitor) {
        offers.values.filter { it.captainId == captainId && it.status == DispatchOfferStatus.PENDING }
            .sortedBy { it.offeredAt }
    }

    override fun getOffer(offerId: UUID): DispatchOffer? = synchronized(monitor) { offers[offerId] }

    override fun createOffer(offer: DispatchOffer): DispatchOffer = synchronized(monitor) {
        offers[offer.id] = offer
        offer
    }

    override fun saveOffer(offer: DispatchOffer): DispatchOffer = synchronized(monitor) {
        if (!offers.containsKey(offer.id)) unavailable()
        offers[offer.id] = offer
        offer
    }

    private fun unavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )
}
