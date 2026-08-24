package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.delivery.domain.CaptainDeliveryState
import `in`.mypetnew.delivery.domain.DispatchJob
import `in`.mypetnew.delivery.domain.DispatchOffer
import `in`.mypetnew.delivery.domain.DispatchOfferStatus
import `in`.mypetnew.delivery.domain.DispatchPersistence
import `in`.mypetnew.delivery.domain.DispatchStatus
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

class JdbcDispatchPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : DispatchPersistence {
    override fun <T> inTransaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("Dispatch transaction returned no result")

    override fun approveCaptain(captainId: UUID): CaptainDeliveryState = inTransaction {
        requireCaptainAccount(captainId)
        jdbc.update(
            """
            INSERT INTO mypet.captain_delivery_state(captain_id, approved, online, busy, updated_at)
            VALUES (?, TRUE, FALSE, FALSE, CURRENT_TIMESTAMP)
            ON CONFLICT (captain_id) DO UPDATE
            SET approved = TRUE, updated_at = CURRENT_TIMESTAMP
            """.trimIndent(),
            captainId,
        )
        captainState(captainId) ?: unavailable()
    }

    override fun updateCaptainPresence(
        captainId: UUID,
        online: Boolean,
        lastLocationAt: Instant?,
    ): CaptainDeliveryState = inTransaction {
        requireCaptainAccount(captainId)
        val updated = jdbc.update(
            """
            INSERT INTO mypet.captain_delivery_state(
                captain_id, approved, online, busy, last_location_at, updated_at
            ) VALUES (?, FALSE, ?, FALSE, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (captain_id) DO UPDATE
            SET online = EXCLUDED.online,
                last_location_at = COALESCE(EXCLUDED.last_location_at, mypet.captain_delivery_state.last_location_at),
                updated_at = CURRENT_TIMESTAMP
            WHERE EXCLUDED.online
               OR (
                    NOT mypet.captain_delivery_state.busy
                    AND NOT EXISTS (
                        SELECT 1
                        FROM mypet.dispatch_job active_job
                        WHERE active_job.assigned_captain_id = EXCLUDED.captain_id
                          AND active_job.status IN ('ASSIGNED', 'PICKED_UP')
                    )
               )
            """.trimIndent(),
            captainId,
            online,
            lastLocationAt?.let(Timestamp::from),
        )
        if (updated != 1 && !online) {
            throw DomainException(
                "CAPTAIN_ACTIVE_DELIVERY",
                "A captain with an active delivery cannot go offline",
            )
        }
        if (updated != 1) unavailable()
        captainState(captainId) ?: unavailable()
    }

    override fun updateCaptainBusy(captainId: UUID, busy: Boolean): CaptainDeliveryState = inTransaction {
        val updated = jdbc.update(
            """
            UPDATE mypet.captain_delivery_state
            SET busy = ?, updated_at = CURRENT_TIMESTAMP
            WHERE captain_id = ?
            """.trimIndent(),
            busy,
            captainId,
        )
        if (updated != 1) unavailable()
        captainState(captainId) ?: unavailable()
    }

    override fun captainState(captainId: UUID): CaptainDeliveryState? = jdbc.query(
        """
        SELECT captain_id, approved, online, busy, last_location_at
        FROM mypet.captain_delivery_state
        WHERE captain_id = ?
        """.trimIndent(),
        { result, _ -> captain(result) },
        captainId,
    ).singleOrNull()

    override fun lockCaptainState(captainId: UUID): CaptainDeliveryState? = jdbc.query(
        """
        SELECT captain_id, approved, online, busy, last_location_at
        FROM mypet.captain_delivery_state
        WHERE captain_id = ?
        FOR UPDATE
        """.trimIndent(),
        { result, _ -> captain(result) },
        captainId,
    ).singleOrNull()

    override fun findJobByOrder(orderId: UUID): DispatchJob? = jdbc.query(
        """
        SELECT id, order_id, outlet_id, origin_latitude, origin_longitude, status,
               assigned_captain_id, attempt_count, failure_reason, assigned_at,
               picked_up_at, delivered_at, created_at, updated_at,
               pickup_pin, delivery_pin, pickup_idempotency_key, pickup_fingerprint,
               pickup_proof_payload, delivery_idempotency_key, delivery_fingerprint, delivery_proof_payload
        FROM mypet.dispatch_job
        WHERE order_id = ?
        """.trimIndent(),
        { result, _ -> job(result) },
        orderId,
    ).singleOrNull()

    override fun getJob(jobId: UUID): DispatchJob? = jdbc.query(
        """
        SELECT id, order_id, outlet_id, origin_latitude, origin_longitude, status,
               assigned_captain_id, attempt_count, failure_reason, assigned_at,
               picked_up_at, delivered_at, created_at, updated_at,
               pickup_pin, delivery_pin, pickup_idempotency_key, pickup_fingerprint,
               pickup_proof_payload, delivery_idempotency_key, delivery_fingerprint, delivery_proof_payload
        FROM mypet.dispatch_job
        WHERE id = ?
        FOR UPDATE
        """.trimIndent(),
        { result, _ -> job(result) },
        jobId,
    ).singleOrNull()

    override fun findActiveJobByCaptain(captainId: UUID): DispatchJob? = jdbc.query(
        """
        SELECT id, order_id, outlet_id, origin_latitude, origin_longitude, status,
               assigned_captain_id, attempt_count, failure_reason, assigned_at,
               picked_up_at, delivered_at, created_at, updated_at,
               pickup_pin, delivery_pin, pickup_idempotency_key, pickup_fingerprint,
               pickup_proof_payload, delivery_idempotency_key, delivery_fingerprint, delivery_proof_payload
        FROM mypet.dispatch_job
        WHERE assigned_captain_id = ? AND status IN ('ASSIGNED', 'PICKED_UP')
        ORDER BY updated_at DESC
        LIMIT 1
        """.trimIndent(),
        { result, _ -> job(result) },
        captainId,
    ).singleOrNull()

    override fun createJob(job: DispatchJob): DispatchJob {
        try {
            jdbc.update(
                """
                INSERT INTO mypet.dispatch_job(
                    id, order_id, outlet_id, origin_latitude, origin_longitude, status,
                    assigned_captain_id, attempt_count, failure_reason, assigned_at,
                    picked_up_at, delivered_at, created_at, updated_at,
                    pickup_pin, delivery_pin, pickup_idempotency_key, pickup_fingerprint,
                    pickup_proof_payload, delivery_idempotency_key, delivery_fingerprint, delivery_proof_payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                job.id,
                job.orderId,
                job.outletId,
                job.originLatitude,
                job.originLongitude,
                job.status.name,
                job.assignedCaptainId,
                job.attemptCount,
                job.failureReason,
                job.assignedAt?.let(Timestamp::from),
                job.pickedUpAt?.let(Timestamp::from),
                job.deliveredAt?.let(Timestamp::from),
                Timestamp.from(job.createdAt),
                Timestamp.from(job.updatedAt),
                job.pickupPin,
                job.deliveryPin,
                job.pickupIdempotencyKey,
                job.pickupFingerprint,
                job.pickupProofPayload,
                job.deliveryIdempotencyKey,
                job.deliveryFingerprint,
                job.deliveryProofPayload,
            )
            return job
        } catch (duplicate: DuplicateKeyException) {
            return findJobByOrder(job.orderId) ?: throw duplicate
        }
    }

    override fun saveJob(job: DispatchJob): DispatchJob {
        val updated = jdbc.update(
            """
            UPDATE mypet.dispatch_job
            SET status = ?, assigned_captain_id = ?, attempt_count = ?, failure_reason = ?,
                assigned_at = ?, picked_up_at = ?, delivered_at = ?, updated_at = ?,
                pickup_pin = ?, delivery_pin = ?, pickup_idempotency_key = ?, pickup_fingerprint = ?,
                pickup_proof_payload = ?, delivery_idempotency_key = ?, delivery_fingerprint = ?, delivery_proof_payload = ?
            WHERE id = ?
            """.trimIndent(),
            job.status.name,
            job.assignedCaptainId,
            job.attemptCount,
            job.failureReason,
            job.assignedAt?.let(Timestamp::from),
            job.pickedUpAt?.let(Timestamp::from),
            job.deliveredAt?.let(Timestamp::from),
            Timestamp.from(job.updatedAt),
            job.pickupPin,
            job.deliveryPin,
            job.pickupIdempotencyKey,
            job.pickupFingerprint,
            job.pickupProofPayload,
            job.deliveryIdempotencyKey,
            job.deliveryFingerprint,
            job.deliveryProofPayload,
            job.id,
        )
        if (updated != 1) unavailable()
        return job
    }

    override fun activeJobs(): List<DispatchJob> = jdbc.query(
        """
        SELECT id, order_id, outlet_id, origin_latitude, origin_longitude, status,
               assigned_captain_id, attempt_count, failure_reason, assigned_at,
               picked_up_at, delivered_at, created_at, updated_at,
               pickup_pin, delivery_pin, pickup_idempotency_key, pickup_fingerprint,
               pickup_proof_payload, delivery_idempotency_key, delivery_fingerprint, delivery_proof_payload
        FROM mypet.dispatch_job
        WHERE status IN ('SEARCHING', 'OFFERED')
        ORDER BY updated_at, id
        """.trimIndent(),
        { result, _ -> job(result) },
    )

    override fun offers(jobId: UUID): List<DispatchOffer> = jdbc.query(
        """
        SELECT id, job_id, captain_id, offer_rank, status, offered_at, expires_at, responded_at
        FROM mypet.dispatch_offer
        WHERE job_id = ?
        ORDER BY offer_rank, id
        """.trimIndent(),
        { result, _ -> offer(result) },
        jobId,
    )

    override fun pendingOffers(captainId: UUID): List<DispatchOffer> = jdbc.query(
        """
        SELECT o.id, o.job_id, o.captain_id, o.offer_rank, o.status,
               o.offered_at, o.expires_at, o.responded_at
        FROM mypet.dispatch_offer o
        JOIN mypet.dispatch_job j ON j.id = o.job_id
        WHERE o.captain_id = ? AND o.status = 'PENDING' AND j.status = 'OFFERED'
        ORDER BY o.offered_at, o.id
        """.trimIndent(),
        { result, _ -> offer(result) },
        captainId,
    )

    override fun getOffer(offerId: UUID): DispatchOffer? = jdbc.query(
        """
        SELECT id, job_id, captain_id, offer_rank, status, offered_at, expires_at, responded_at
        FROM mypet.dispatch_offer
        WHERE id = ?
        FOR UPDATE
        """.trimIndent(),
        { result, _ -> offer(result) },
        offerId,
    ).singleOrNull()

    override fun createOffer(offer: DispatchOffer): DispatchOffer {
        jdbc.update(
            """
            INSERT INTO mypet.dispatch_offer(
                id, job_id, captain_id, offer_rank, status, offered_at, expires_at, responded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            offer.id,
            offer.jobId,
            offer.captainId,
            offer.rank,
            offer.status.name,
            Timestamp.from(offer.offeredAt),
            Timestamp.from(offer.expiresAt),
            offer.respondedAt?.let(Timestamp::from),
        )
        return offer
    }

    override fun saveOffer(offer: DispatchOffer): DispatchOffer {
        val updated = jdbc.update(
            """
            UPDATE mypet.dispatch_offer
            SET status = ?, responded_at = ?
            WHERE id = ?
            """.trimIndent(),
            offer.status.name,
            offer.respondedAt?.let(Timestamp::from),
            offer.id,
        )
        if (updated != 1) unavailable()
        return offer
    }

    private fun requireCaptainAccount(captainId: UUID) {
        val count = jdbc.queryForObject(
            """
            SELECT COUNT(*)
            FROM mypet.identity_account
            WHERE id = ? AND role = 'CAPTAIN' AND status = 'ACTIVE'
            """.trimIndent(),
            Int::class.java,
            captainId,
        ) ?: 0
        if (count != 1) unavailable()
    }

    private fun captain(result: ResultSet): CaptainDeliveryState = CaptainDeliveryState(
        captainId = result.getObject("captain_id", UUID::class.java),
        approved = result.getBoolean("approved"),
        online = result.getBoolean("online"),
        busy = result.getBoolean("busy"),
        lastLocationAt = result.getTimestamp("last_location_at")?.toInstant(),
    )

    private fun job(result: ResultSet): DispatchJob = DispatchJob(
        id = result.getObject("id", UUID::class.java),
        orderId = result.getObject("order_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        originLatitude = result.getDouble("origin_latitude"),
        originLongitude = result.getDouble("origin_longitude"),
        status = DispatchStatus.valueOf(result.getString("status")),
        assignedCaptainId = result.getObject("assigned_captain_id", UUID::class.java),
        attemptCount = result.getInt("attempt_count"),
        failureReason = result.getString("failure_reason"),
        assignedAt = result.getTimestamp("assigned_at")?.toInstant(),
        pickedUpAt = result.getTimestamp("picked_up_at")?.toInstant(),
        deliveredAt = result.getTimestamp("delivered_at")?.toInstant(),
        createdAt = result.getTimestamp("created_at").toInstant(),
        updatedAt = result.getTimestamp("updated_at").toInstant(),
        pickupPin = result.getString("pickup_pin") ?: "1234",
        deliveryPin = result.getString("delivery_pin") ?: "5678",
        pickupIdempotencyKey = result.getString("pickup_idempotency_key"),
        pickupFingerprint = result.getString("pickup_fingerprint"),
        pickupProofPayload = result.getString("pickup_proof_payload"),
        deliveryIdempotencyKey = result.getString("delivery_idempotency_key"),
        deliveryFingerprint = result.getString("delivery_fingerprint"),
        deliveryProofPayload = result.getString("delivery_proof_payload"),
    )

    private fun offer(result: ResultSet): DispatchOffer = DispatchOffer(
        id = result.getObject("id", UUID::class.java),
        jobId = result.getObject("job_id", UUID::class.java),
        captainId = result.getObject("captain_id", UUID::class.java),
        rank = result.getInt("offer_rank"),
        status = DispatchOfferStatus.valueOf(result.getString("status")),
        offeredAt = result.getTimestamp("offered_at").toInstant(),
        expiresAt = result.getTimestamp("expires_at").toInstant(),
        respondedAt = result.getTimestamp("responded_at")?.toInstant(),
    )

    private fun unavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )
}
