package `in`.mypetnew.appointment.infrastructure

import `in`.mypetnew.appointment.domain.Appointment
import `in`.mypetnew.appointment.domain.AppointmentPersistence
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.domain.ServiceOffering
import `in`.mypetnew.appointment.domain.ServiceOfferingStatus
import `in`.mypetnew.appointment.domain.ServiceSlot
import `in`.mypetnew.common.error.DomainException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID

class JdbcAppointmentPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : AppointmentPersistence {
    override fun createOffering(offering: ServiceOffering): ServiceOffering {
        jdbc.update(
            """
            INSERT INTO mypet.service_offering
                (id, outlet_id, name, description, price_paise, duration_minutes, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            offering.id,
            offering.outletId,
            offering.name,
            offering.description,
            offering.pricePaise,
            offering.durationMinutes,
            offering.status.name,
            java.sql.Timestamp.from(offering.createdAt),
            java.sql.Timestamp.from(offering.updatedAt),
        )
        return offering
    }

    override fun getOffering(offeringId: UUID): ServiceOffering? = jdbc.query(
        """
        SELECT id, outlet_id, name, description, price_paise, duration_minutes, status, created_at, updated_at
        FROM mypet.service_offering
        WHERE id = ?
        """.trimIndent(),
        ::mapOffering,
        offeringId,
    ).firstOrNull()

    override fun listOfferings(outletId: UUID): List<ServiceOffering> = jdbc.query(
        """
        SELECT id, outlet_id, name, description, price_paise, duration_minutes, status, created_at, updated_at
        FROM mypet.service_offering
        WHERE outlet_id = ? AND status = 'ACTIVE'
        ORDER BY LOWER(name), id
        """.trimIndent(),
        ::mapOffering,
        outletId,
    )

    override fun createSlot(slot: ServiceSlot): ServiceSlot {
        try {
            jdbc.update(
                """
                INSERT INTO mypet.service_slot (id, offering_id, slot_start, slot_end, created_at)
                VALUES (?, ?, ?, ?, ?)
                """.trimIndent(),
                slot.id,
                slot.offeringId,
                java.sql.Timestamp.from(slot.slotStart),
                java.sql.Timestamp.from(slot.slotEnd),
                java.sql.Timestamp.from(slot.createdAt),
            )
        } catch (error: org.springframework.dao.DuplicateKeyException) {
            throw DomainException("SLOT_ALREADY_EXISTS", "A slot already exists at this time")
        }
        return slot
    }

    override fun getSlot(slotId: UUID): ServiceSlot? = jdbc.query(
        """
        SELECT id, offering_id, slot_start, slot_end, created_at
        FROM mypet.service_slot
        WHERE id = ?
        """.trimIndent(),
        ::mapSlot,
        slotId,
    ).firstOrNull()

    override fun listSlots(offeringId: UUID, now: Instant): List<ServiceSlot> = transactions.execute {
        expireHolds(now)
        jdbc.query(
            """
            SELECT s.id, s.offering_id, s.slot_start, s.slot_end, s.created_at
            FROM mypet.service_slot s
            WHERE s.offering_id = ?
              AND s.slot_start > ?
              AND NOT EXISTS (
                SELECT 1 FROM mypet.appointment a
                WHERE a.active_slot_id = s.id
              )
            ORDER BY s.slot_start
            """.trimIndent(),
            ::mapSlot,
            offeringId,
            java.sql.Timestamp.from(now),
        )
    }

    override fun hold(appointment: Appointment, now: Instant): Appointment = transactions.execute {
        val offering = jdbc.query(
            """
            SELECT id, outlet_id, name, description, price_paise, duration_minutes, status, created_at, updated_at
            FROM mypet.service_offering WHERE id = ? FOR UPDATE
            """.trimIndent(),
            ::mapOffering,
            appointment.offeringId,
        ).firstOrNull() ?: unavailable()
        val slot = jdbc.query(
            """
            SELECT id, offering_id, slot_start, slot_end, created_at
            FROM mypet.service_slot WHERE id = ? FOR UPDATE
            """.trimIndent(),
            ::mapSlot,
            appointment.slotId,
        ).firstOrNull() ?: unavailable()
        if (
            offering.status != ServiceOfferingStatus.ACTIVE ||
            offering.outletId != appointment.providerId ||
            slot.offeringId != offering.id ||
            !slot.slotStart.isAfter(now)
        ) unavailable()

        expireHolds(now)
        val occupied = jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.appointment WHERE active_slot_id = ?",
            Long::class.java,
            appointment.slotId,
        ) ?: 0L
        if (occupied > 0) throw DomainException("SLOT_UNAVAILABLE", "This slot was just taken")

        try {
            jdbc.update(
                """
                INSERT INTO mypet.appointment
                    (id, customer_id, provider_id, offering_id, slot_id, active_slot_id, pet_id, price_paise, status,
                     pay_at_clinic, payment_id, hold_expires_at, booked_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                appointment.id,
                appointment.customerId,
                appointment.providerId,
                appointment.offeringId,
                appointment.slotId,
                appointment.slotId,
                appointment.petId,
                appointment.pricePaise,
                appointment.status.name,
                appointment.payAtClinic,
                appointment.paymentId,
                appointment.holdExpiresAt?.let(java.sql.Timestamp::from),
                appointment.bookedAt?.let(java.sql.Timestamp::from),
                java.sql.Timestamp.from(appointment.createdAt),
                java.sql.Timestamp.from(appointment.updatedAt),
            )
        } catch (error: org.springframework.dao.DuplicateKeyException) {
            throw DomainException("SLOT_UNAVAILABLE", "This slot was just taken")
        }
        appendHistory(appointment.id, null, AppointmentStatus.HOLD, appointment.customerId, "Slot held", now)
        appointment
    }

    override fun getAppointment(appointmentId: UUID): Appointment? = jdbc.query(
        appointmentSelect + " WHERE id = ?",
        ::mapAppointment,
        appointmentId,
    ).firstOrNull()

    override fun confirm(appointmentId: UUID, customerId: UUID, paymentId: UUID?, now: Instant): Appointment =
        transactions.execute {
            expireHolds(now)
            val current = jdbc.query(
                appointmentSelect + " WHERE id = ? FOR UPDATE",
                ::mapAppointment,
                appointmentId,
            ).firstOrNull()?.takeIf { it.customerId == customerId } ?: unavailable()
            if (current.status == AppointmentStatus.HOLD_EXPIRED) {
                throw DomainException("SLOT_HOLD_EXPIRED", "The slot hold expired; choose a fresh slot")
            }
            if (current.status == AppointmentStatus.BOOKED) return@execute current
            if (current.status != AppointmentStatus.HOLD) {
                throw DomainException("APPOINTMENT_STATE_INVALID", "The appointment cannot be confirmed from its current state")
            }
            if (!current.payAtClinic) {
                throw DomainException("APPOINTMENT_ONLINE_PAYMENT_UNAVAILABLE", "Online appointment payment is not enabled yet")
            }
            if (paymentId != null) {
                throw DomainException("APPOINTMENT_PAYMENT_NOT_ACCEPTED", "A client-supplied payment reference cannot confirm this appointment")
            }
            jdbc.update(
                """
                UPDATE mypet.appointment
                SET status = 'BOOKED', payment_id = NULL, booked_at = ?, hold_expires_at = NULL, updated_at = ?
                WHERE id = ? AND status = 'HOLD'
                """.trimIndent(),
                java.sql.Timestamp.from(now),
                java.sql.Timestamp.from(now),
                appointmentId,
            )
            appendHistory(appointmentId, AppointmentStatus.HOLD, AppointmentStatus.BOOKED, customerId, "Customer confirmed pay-at-clinic booking", now)
            current.copy(status = AppointmentStatus.BOOKED, paymentId = null, bookedAt = now, holdExpiresAt = null, updatedAt = now)
        }

    override fun cancel(appointmentId: UUID, customerId: UUID, reason: String?, now: Instant): Appointment =
        transactions.execute {
            expireHolds(now)
            val current = jdbc.query(
                appointmentSelect + " WHERE id = ? FOR UPDATE",
                ::mapAppointment,
                appointmentId,
            ).firstOrNull()?.takeIf { it.customerId == customerId } ?: unavailable()
            if (current.status !in setOf(AppointmentStatus.HOLD, AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED)) {
                throw DomainException("APPOINTMENT_STATE_INVALID", "The appointment cannot be cancelled from its current state")
            }
            jdbc.update(
                """
                UPDATE mypet.appointment
                SET status = 'CANCELLED', active_slot_id = NULL, hold_expires_at = NULL, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                java.sql.Timestamp.from(now),
                appointmentId,
            )
            appendHistory(appointmentId, current.status, AppointmentStatus.CANCELLED, customerId, reason ?: "Customer cancelled", now)
            current.copy(status = AppointmentStatus.CANCELLED, holdExpiresAt = null, updatedAt = now)
        }

    override fun listCustomerAppointments(customerId: UUID): List<Appointment> = jdbc.query(
        appointmentSelect + " WHERE customer_id = ? ORDER BY created_at DESC, id DESC",
        ::mapAppointment,
        customerId,
    )

    private fun expireHolds(now: Instant) {
        val expiredIds = jdbc.query(
            """
            SELECT id FROM mypet.appointment
            WHERE status = 'HOLD' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?
            FOR UPDATE
            """.trimIndent(),
            { rs, _ -> rs.getObject("id", UUID::class.java) },
            java.sql.Timestamp.from(now),
        )
        if (expiredIds.isEmpty()) return

        jdbc.update(
            """
            UPDATE mypet.appointment
            SET status = 'HOLD_EXPIRED', active_slot_id = NULL, updated_at = ?
            WHERE status = 'HOLD' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?
            """.trimIndent(),
            java.sql.Timestamp.from(now),
            java.sql.Timestamp.from(now),
        )
        expiredIds.forEach { appointmentId ->
            appendHistory(
                appointmentId = appointmentId,
                from = AppointmentStatus.HOLD,
                to = AppointmentStatus.HOLD_EXPIRED,
                actorId = null,
                reason = "Appointment hold expired",
                now = now,
            )
        }
    }

    private fun appendHistory(
        appointmentId: UUID,
        from: AppointmentStatus?,
        to: AppointmentStatus,
        actorId: UUID?,
        reason: String,
        now: Instant,
    ) {
        val actorRole = if (actorId == null) "SYSTEM" else "CUSTOMER"
        val source = if (actorId == null) "SYSTEM_HOLD_EXPIRY" else "CUSTOMER_API"
        val idempotencyKey = "$appointmentId:${to.name}"
        jdbc.update(
            """
            INSERT INTO mypet.appointment_history
                (id, appointment_id, from_status, to_status, actor_id, actor_role, source,
                 reason, idempotency_key, trace_id, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            appointmentId,
            from?.name,
            to.name,
            actorId,
            actorRole,
            source,
            reason.take(240),
            idempotencyKey,
            UUID.randomUUID(),
            java.sql.Timestamp.from(now),
        )
    }

    private fun mapOffering(rs: ResultSet, row: Int): ServiceOffering = ServiceOffering(
        id = rs.getObject("id", UUID::class.java),
        outletId = rs.getObject("outlet_id", UUID::class.java),
        name = rs.getString("name"),
        description = rs.getString("description"),
        pricePaise = rs.getLong("price_paise"),
        durationMinutes = rs.getInt("duration_minutes"),
        status = ServiceOfferingStatus.valueOf(rs.getString("status")),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    private fun mapSlot(rs: ResultSet, row: Int): ServiceSlot = ServiceSlot(
        id = rs.getObject("id", UUID::class.java),
        offeringId = rs.getObject("offering_id", UUID::class.java),
        slotStart = rs.getTimestamp("slot_start").toInstant(),
        slotEnd = rs.getTimestamp("slot_end").toInstant(),
        createdAt = rs.getTimestamp("created_at").toInstant(),
    )

    private fun mapAppointment(rs: ResultSet, row: Int): Appointment = Appointment(
        id = rs.getObject("id", UUID::class.java),
        customerId = rs.getObject("customer_id", UUID::class.java),
        providerId = rs.getObject("provider_id", UUID::class.java),
        offeringId = rs.getObject("offering_id", UUID::class.java),
        slotId = rs.getObject("slot_id", UUID::class.java),
        petId = rs.getObject("pet_id", UUID::class.java),
        pricePaise = rs.getLong("price_paise"),
        status = AppointmentStatus.valueOf(rs.getString("status")),
        payAtClinic = rs.getBoolean("pay_at_clinic"),
        paymentId = rs.getObject("payment_id", UUID::class.java),
        holdExpiresAt = rs.getTimestamp("hold_expires_at")?.toInstant(),
        bookedAt = rs.getTimestamp("booked_at")?.toInstant(),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    companion object {
        private const val appointmentSelect = """
            SELECT id, customer_id, provider_id, offering_id, slot_id, pet_id, price_paise, status,
                   pay_at_clinic, payment_id, hold_expires_at, booked_at, created_at, updated_at
            FROM mypet.appointment
        """
    }
}

private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
