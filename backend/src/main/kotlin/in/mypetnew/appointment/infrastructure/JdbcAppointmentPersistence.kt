package `in`.mypetnew.appointment.infrastructure

import `in`.mypetnew.appointment.domain.AppointmentPage
import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentPaymentStatus
import `in`.mypetnew.appointment.domain.AppointmentPersistence
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.domain.CustomerAppointment
import `in`.mypetnew.appointment.domain.ServiceCapability
import `in`.mypetnew.appointment.domain.ServiceOffering
import `in`.mypetnew.appointment.domain.ServiceSlot
import `in`.mypetnew.common.error.DomainException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

class JdbcAppointmentPersistence(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
) : AppointmentPersistence {
    override fun saveOffering(offering: ServiceOffering): ServiceOffering {
        jdbc.sql(
            """
            INSERT INTO mypet.service_offering(
                id, organization_id, outlet_id, capability, name, description,
                duration_minutes, price_paise, active, created_at, updated_at
            ) VALUES (
                :id, :organization_id, :outlet_id, :capability, :name, :description,
                :duration_minutes, :price_paise, :active, :created_at, :created_at
            )
            """.trimIndent(),
        ).param("id", offering.id)
            .param("organization_id", offering.organizationId)
            .param("outlet_id", offering.outletId)
            .param("capability", offering.capability.name)
            .param("name", offering.name)
            .param("description", offering.description)
            .param("duration_minutes", offering.durationMinutes)
            .param("price_paise", offering.pricePaise)
            .param("active", offering.active)
            .param("created_at", offering.createdAt.jdbcTimestamp())
            .update()
        return offering
    }

    override fun saveSlot(slot: ServiceSlot): ServiceSlot {
        try {
            jdbc.sql(
                """
                INSERT INTO mypet.service_slot(id, service_id, starts_at, ends_at, active, created_at)
                VALUES (:id, :service_id, :starts_at, :ends_at, :active, CURRENT_TIMESTAMP)
                """.trimIndent(),
            ).param("id", slot.id)
                .param("service_id", slot.serviceId)
                .param("starts_at", slot.startsAt.jdbcTimestamp())
                .param("ends_at", slot.endsAt.jdbcTimestamp())
                .param("active", slot.active)
                .update()
        } catch (_: DuplicateKeyException) {
            throw DomainException("SERVICE_SLOT_CONFLICT", "A service slot already exists at this time")
        }
        return slot
    }

    override fun getOffering(serviceId: UUID): ServiceOffering? = jdbc.sql(
        """
        SELECT id, organization_id, outlet_id, capability, name, description,
               duration_minutes, price_paise, active, created_at
        FROM mypet.service_offering WHERE id = :id
        """.trimIndent(),
    ).param("id", serviceId).query(::mapOffering).optional().orElse(null)

    override fun getSlot(slotId: UUID): ServiceSlot? = jdbc.sql(
        "SELECT id, service_id, starts_at, ends_at, active FROM mypet.service_slot WHERE id = :id",
    ).param("id", slotId).query(::mapSlot).optional().orElse(null)

    override fun listOfferings(capability: ServiceCapability?, outletId: UUID?): List<ServiceOffering> = jdbc.sql(
        """
        SELECT id, organization_id, outlet_id, capability, name, description,
               duration_minutes, price_paise, active, created_at
        FROM mypet.service_offering
        WHERE active = TRUE
          AND (:capability IS NULL OR capability = :capability)
          AND (:outlet_id IS NULL OR outlet_id = :outlet_id)
        ORDER BY LOWER(name), id
        """.trimIndent(),
    ).param("capability", capability?.name)
        .param("outlet_id", outletId)
        .query(::mapOffering)
        .list()

    override fun availableSlots(serviceId: UUID, from: Instant, to: Instant, now: Instant): List<ServiceSlot> = jdbc.sql(
        """
        SELECT s.id, s.service_id, s.starts_at, s.ends_at, s.active
        FROM mypet.service_slot s
        WHERE s.service_id = :service_id
          AND s.active = TRUE
          AND s.starts_at >= :from_time
          AND s.starts_at < :to_time
          AND s.starts_at > :now
          AND NOT EXISTS (
              SELECT 1 FROM mypet.appointment a
              WHERE a.slot_id = s.id
                AND (
                    a.status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE')
                    OR (a.status = 'HOLD' AND a.hold_expires_at > :now)
                )
          )
        ORDER BY s.starts_at, s.id
        """.trimIndent(),
    ).param("service_id", serviceId)
        .param("from_time", from.jdbcTimestamp())
        .param("to_time", to.jdbcTimestamp())
        .param("now", now.jdbcTimestamp())
        .query(::mapSlot)
        .list()

    override fun hold(
        appointment: CustomerAppointment,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): CustomerAppointment {
        findByIdempotency(appointment.customerId, idempotencyKey)?.let { existing ->
            if (existing.second != requestFingerprint) idempotencyMismatch()
            return existing.first
        }

        try {
            return transaction.execute {
                jdbc.sql(
                    """
                    UPDATE mypet.appointment
                    SET status = 'HOLD_EXPIRED', updated_at = :now
                    WHERE slot_id = :slot_id AND status = 'HOLD' AND hold_expires_at <= :now
                    """.trimIndent(),
                ).param("now", now.jdbcTimestamp())
                    .param("slot_id", appointment.slotId)
                    .update()

                // Lock the canonical slot row first. Every hold for this slot follows
                // this path, so concurrent transactions serialize before occupancy is
                // checked and a second customer cannot create another active hold.
                val slotAvailable = jdbc.sql(
                    """
                    SELECT id FROM mypet.service_slot
                    WHERE id = :slot_id AND service_id = :service_id AND active = TRUE AND starts_at > :now
                    FOR UPDATE
                    """.trimIndent(),
                ).param("slot_id", appointment.slotId)
                    .param("service_id", appointment.serviceId)
                    .param("now", now.jdbcTimestamp())
                    .query(UUID::class.java)
                    .optional()
                    .isPresent
                if (!slotAvailable) slotUnavailable()

                // Ignore the exact same customer's exact same idempotency attempt here.
                // If a concurrent duplicate already committed, the insert below hits the
                // customer/idempotency unique key and the catch block replays that result.
                // Different customers/keys still observe the active slot as occupied.
                val slotOccupied = jdbc.sql(
                    """
                    SELECT id FROM mypet.appointment
                    WHERE slot_id = :slot_id
                      AND status IN ('HOLD','BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE')
                      AND NOT (customer_id = :customer_id AND idempotency_key = :idempotency_key)
                    LIMIT 1
                    """.trimIndent(),
                ).param("slot_id", appointment.slotId)
                    .param("customer_id", appointment.customerId)
                    .param("idempotency_key", idempotencyKey)
                    .query(UUID::class.java)
                    .optional()
                    .isPresent
                if (slotOccupied) slotUnavailable()

                insertAppointment(appointment, idempotencyKey, requestFingerprint)
                appendHistory(
                    appointment.id,
                    AppointmentStatus.HOLD,
                    appointment.customerId,
                    now,
                    "CUSTOMER_HOLD",
                )
                appointment
            }
        } catch (_: DuplicateKeyException) {
            findByIdempotency(appointment.customerId, idempotencyKey)?.let { existing ->
                if (existing.second != requestFingerprint) idempotencyMismatch()
                return existing.first
            }
            slotUnavailable()
        }
    }

    override fun confirm(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment? = transaction.execute {
        val current = lockOwned(customerId, appointmentId) ?: return@execute null
        if (current.status == AppointmentStatus.BOOKED || current.status == AppointmentStatus.CONFIRMED) {
            return@execute current
        }
        if (current.status == AppointmentStatus.HOLD_EXPIRED) holdExpired()
        if (current.status != AppointmentStatus.HOLD) invalidState()
        if (current.holdExpiresAt == null || !current.holdExpiresAt.isAfter(now)) holdExpired()

        jdbc.sql(
            "UPDATE mypet.appointment SET status = 'BOOKED', hold_expires_at = NULL, updated_at = :now WHERE id = :id",
        ).param("now", now.jdbcTimestamp())
            .param("id", appointmentId)
            .update()
        appendHistory(appointmentId, AppointmentStatus.BOOKED, customerId, now, "CUSTOMER_CONFIRM")
        getOwned(customerId, appointmentId)
    }

    override fun cancel(customerId: UUID, appointmentId: UUID, reason: String?, now: Instant): CustomerAppointment? = transaction.execute {
        val current = lockOwned(customerId, appointmentId) ?: return@execute null
        if (current.status == AppointmentStatus.CANCELLED) return@execute current
        if (current.status == AppointmentStatus.HOLD_EXPIRED) holdExpired()
        if (
            current.status == AppointmentStatus.HOLD &&
            (current.holdExpiresAt == null || !current.holdExpiresAt.isAfter(now))
        ) {
            holdExpired()
        }
        if (current.status !in setOf(AppointmentStatus.HOLD, AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED)) {
            invalidState()
        }

        jdbc.sql(
            """
            UPDATE mypet.appointment
            SET status = 'CANCELLED', hold_expires_at = NULL,
                notes = COALESCE(:reason, notes), updated_at = :now
            WHERE id = :id
            """.trimIndent(),
        ).param("reason", reason?.trim()?.takeIf { it.isNotEmpty() })
            .param("now", now.jdbcTimestamp())
            .param("id", appointmentId)
            .update()
        appendHistory(
            appointmentId,
            AppointmentStatus.CANCELLED,
            customerId,
            now,
            reason ?: "CUSTOMER_CANCEL",
        )
        getOwned(customerId, appointmentId)
    }

    override fun merchantTransition(
        outletId: UUID,
        appointmentId: UUID,
        allowedFrom: Set<AppointmentStatus>,
        target: AppointmentStatus,
        actorId: UUID,
        reason: String?,
        now: Instant,
    ): CustomerAppointment? = transaction.execute {
        val current = jdbc.sql(
            """
            SELECT id, customer_id, pet_id, organization_id, outlet_id, service_id, slot_id,
                   service_name, outlet_name, pet_name, starts_at, ends_at, status, payment_method,
                   payment_status, price_paise, notes, hold_expires_at, created_at, updated_at
            FROM mypet.appointment
            WHERE id = :id AND outlet_id = :outlet_id
            FOR UPDATE
            """.trimIndent(),
        ).param("id", appointmentId)
            .param("outlet_id", outletId)
            .query(::mapAppointment)
            .optional()
            .orElse(null) ?: return@execute null

        if (current.status == target) return@execute current
        if (current.status !in allowedFrom) invalidState()

        jdbc.sql(
            "UPDATE mypet.appointment SET status = :status, hold_expires_at = NULL, updated_at = :now WHERE id = :id",
        ).param("status", target.name)
            .param("now", now.jdbcTimestamp())
            .param("id", appointmentId)
            .update()
        appendHistory(appointmentId, target, actorId, now, reason ?: "MERCHANT_STATUS")
        current.copy(status = target, holdExpiresAt = null, updatedAt = now)
    }

    override fun get(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment? {
        expireOwnedHold(customerId, appointmentId, now)
        return getOwned(customerId, appointmentId)
    }

    override fun list(customerId: UUID, page: Int, pageSize: Int, now: Instant): AppointmentPage {
        jdbc.sql(
            """
            UPDATE mypet.appointment
            SET status = 'HOLD_EXPIRED', updated_at = :now
            WHERE customer_id = :customer_id AND status = 'HOLD' AND hold_expires_at <= :now
            """.trimIndent(),
        ).param("now", now.jdbcTimestamp())
            .param("customer_id", customerId)
            .update()

        val rows = jdbc.sql(
            """
            SELECT id, customer_id, pet_id, organization_id, outlet_id, service_id, slot_id,
                   service_name, outlet_name, pet_name, starts_at, ends_at, status, payment_method,
                   payment_status, price_paise, notes, hold_expires_at, created_at, updated_at
            FROM mypet.appointment
            WHERE customer_id = :customer_id
            ORDER BY starts_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("customer_id", customerId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::mapAppointment)
            .list()
        return AppointmentPage(rows.take(pageSize), rows.size > pageSize)
    }

    private fun insertAppointment(
        appointment: CustomerAppointment,
        idempotencyKey: String,
        fingerprint: String,
    ) {
        jdbc.sql(
            """
            INSERT INTO mypet.appointment(
                id, customer_id, pet_id, organization_id, outlet_id, service_id, slot_id,
                service_name, outlet_name, pet_name, starts_at, ends_at, status,
                payment_method, payment_status, price_paise, currency, notes, hold_expires_at,
                idempotency_key, request_fingerprint, created_at, updated_at
            ) VALUES (
                :id, :customer_id, :pet_id, :organization_id, :outlet_id, :service_id, :slot_id,
                :service_name, :outlet_name, :pet_name, :starts_at, :ends_at, :status,
                :payment_method, :payment_status, :price_paise, 'INR', :notes, :hold_expires_at,
                :idempotency_key, :request_fingerprint, :created_at, :updated_at
            )
            """.trimIndent(),
        ).param("id", appointment.id)
            .param("customer_id", appointment.customerId)
            .param("pet_id", appointment.petId)
            .param("organization_id", appointment.organizationId)
            .param("outlet_id", appointment.outletId)
            .param("service_id", appointment.serviceId)
            .param("slot_id", appointment.slotId)
            .param("service_name", appointment.serviceName)
            .param("outlet_name", appointment.outletName)
            .param("pet_name", appointment.petName)
            .param("starts_at", appointment.startsAt.jdbcTimestamp())
            .param("ends_at", appointment.endsAt.jdbcTimestamp())
            .param("status", appointment.status.name)
            .param("payment_method", appointment.paymentMethod.name)
            .param("payment_status", appointment.paymentStatus.name)
            .param("price_paise", appointment.pricePaise)
            .param("notes", appointment.notes)
            .param("hold_expires_at", appointment.holdExpiresAt?.jdbcTimestamp())
            .param("idempotency_key", idempotencyKey)
            .param("request_fingerprint", fingerprint)
            .param("created_at", appointment.createdAt.jdbcTimestamp())
            .param("updated_at", appointment.updatedAt.jdbcTimestamp())
            .update()
    }

    private fun findByIdempotency(customerId: UUID, key: String): Pair<CustomerAppointment, String>? = jdbc.sql(
        """
        SELECT id, customer_id, pet_id, organization_id, outlet_id, service_id, slot_id,
               service_name, outlet_name, pet_name, starts_at, ends_at, status, payment_method,
               payment_status, price_paise, notes, hold_expires_at, created_at, updated_at, request_fingerprint
        FROM mypet.appointment
        WHERE customer_id = :customer_id AND idempotency_key = :key
        """.trimIndent(),
    ).param("customer_id", customerId)
        .param("key", key)
        .query { row, index ->
            require(index >= 0)
            mapAppointment(row, index) to row.getString("request_fingerprint")
        }.optional()
        .orElse(null)

    private fun lockOwned(customerId: UUID, appointmentId: UUID): CustomerAppointment? = jdbc.sql(
        """
        SELECT id, customer_id, pet_id, organization_id, outlet_id, service_id, slot_id,
               service_name, outlet_name, pet_name, starts_at, ends_at, status, payment_method,
               payment_status, price_paise, notes, hold_expires_at, created_at, updated_at
        FROM mypet.appointment
        WHERE id = :id AND customer_id = :customer_id
        FOR UPDATE
        """.trimIndent(),
    ).param("id", appointmentId)
        .param("customer_id", customerId)
        .query(::mapAppointment)
        .optional()
        .orElse(null)

    private fun getOwned(customerId: UUID, appointmentId: UUID): CustomerAppointment? = jdbc.sql(
        """
        SELECT id, customer_id, pet_id, organization_id, outlet_id, service_id, slot_id,
               service_name, outlet_name, pet_name, starts_at, ends_at, status, payment_method,
               payment_status, price_paise, notes, hold_expires_at, created_at, updated_at
        FROM mypet.appointment
        WHERE id = :id AND customer_id = :customer_id
        """.trimIndent(),
    ).param("id", appointmentId)
        .param("customer_id", customerId)
        .query(::mapAppointment)
        .optional()
        .orElse(null)

    private fun expireOwnedHold(customerId: UUID, appointmentId: UUID, now: Instant) {
        jdbc.sql(
            """
            UPDATE mypet.appointment
            SET status = 'HOLD_EXPIRED', updated_at = :now
            WHERE id = :id
              AND customer_id = :customer_id
              AND status = 'HOLD'
              AND hold_expires_at <= :now
            """.trimIndent(),
        ).param("now", now.jdbcTimestamp())
            .param("id", appointmentId)
            .param("customer_id", customerId)
            .update()
    }

    private fun appendHistory(
        appointmentId: UUID,
        status: AppointmentStatus,
        actorId: UUID,
        at: Instant,
        note: String,
    ) {
        jdbc.sql(
            """
            INSERT INTO mypet.appointment_history(id, appointment_id, status, actor_id, note, occurred_at)
            VALUES (:id, :appointment_id, :status, :actor_id, :note, :occurred_at)
            """.trimIndent(),
        ).param("id", UUID.randomUUID())
            .param("appointment_id", appointmentId)
            .param("status", status.name)
            .param("actor_id", actorId)
            .param("note", note.take(500))
            .param("occurred_at", at.jdbcTimestamp())
            .update()
    }

    private fun mapOffering(row: ResultSet, index: Int): ServiceOffering {
        require(index >= 0)
        return ServiceOffering(
            id = row.getObject("id", UUID::class.java),
            organizationId = row.getObject("organization_id", UUID::class.java),
            outletId = row.getObject("outlet_id", UUID::class.java),
            capability = ServiceCapability.valueOf(row.getString("capability")),
            name = row.getString("name"),
            description = row.getString("description"),
            durationMinutes = row.getInt("duration_minutes"),
            pricePaise = row.getLong("price_paise"),
            active = row.getBoolean("active"),
            createdAt = row.getTimestamp("created_at").toInstant(),
        )
    }

    private fun mapSlot(row: ResultSet, index: Int): ServiceSlot {
        require(index >= 0)
        return ServiceSlot(
            id = row.getObject("id", UUID::class.java),
            serviceId = row.getObject("service_id", UUID::class.java),
            startsAt = row.getTimestamp("starts_at").toInstant(),
            endsAt = row.getTimestamp("ends_at").toInstant(),
            active = row.getBoolean("active"),
        )
    }

    private fun mapAppointment(row: ResultSet, index: Int): CustomerAppointment {
        require(index >= 0)
        return CustomerAppointment(
            id = row.getObject("id", UUID::class.java),
            customerId = row.getObject("customer_id", UUID::class.java),
            petId = row.getObject("pet_id", UUID::class.java),
            organizationId = row.getObject("organization_id", UUID::class.java),
            outletId = row.getObject("outlet_id", UUID::class.java),
            serviceId = row.getObject("service_id", UUID::class.java),
            slotId = row.getObject("slot_id", UUID::class.java),
            serviceName = row.getString("service_name"),
            outletName = row.getString("outlet_name"),
            petName = row.getString("pet_name"),
            startsAt = row.getTimestamp("starts_at").toInstant(),
            endsAt = row.getTimestamp("ends_at").toInstant(),
            status = AppointmentStatus.valueOf(row.getString("status")),
            paymentMethod = AppointmentPaymentMethod.valueOf(row.getString("payment_method")),
            paymentStatus = AppointmentPaymentStatus.valueOf(row.getString("payment_status")),
            pricePaise = row.getLong("price_paise"),
            notes = row.getString("notes"),
            holdExpiresAt = row.getTimestamp("hold_expires_at")?.toInstant(),
            createdAt = row.getTimestamp("created_at").toInstant(),
            updatedAt = row.getTimestamp("updated_at").toInstant(),
        )
    }

    private fun slotUnavailable(): Nothing =
        throw DomainException("APPOINTMENT_SLOT_UNAVAILABLE", "This appointment slot is no longer available")

    private fun invalidState(): Nothing =
        throw DomainException("APPOINTMENT_STATE_INVALID", "The appointment cannot be changed from its current state")

    private fun holdExpired(): Nothing =
        throw DomainException("APPOINTMENT_HOLD_EXPIRED", "The appointment hold has expired")

    private fun idempotencyMismatch(): Nothing =
        throw DomainException(
            "IDEMPOTENCY_FINGERPRINT_MISMATCH",
            "The idempotency key was already used for another request",
        )
}

private fun Instant.jdbcTimestamp(): Timestamp = Timestamp.from(this)
