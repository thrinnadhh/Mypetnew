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
import `in`.mypetnew.payment.domain.TerminalAppointmentPaymentProjection
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Instant
import java.util.UUID

/**
 * Compatibility wrapper around the V17 appointment persistence.
 *
 * V17's original payment_method/payment_status columns are deliberately left
 * untouched because released Flyway history is immutable. V18 adds payment_mode
 * and payment_state as the canonical appointment payment projection. This wrapper
 * keeps the mature slot/appointment locking implementation and overlays those V18
 * values on every CustomerAppointment returned to the application.
 */
class OnlineAwareJdbcAppointmentPersistence(
    private val delegate: JdbcAppointmentPersistence,
    private val jdbc: JdbcClient,
    private val terminalPayments: TerminalAppointmentPaymentProjection,
) : AppointmentPersistence {
    override fun saveOffering(offering: ServiceOffering): ServiceOffering = delegate.saveOffering(offering)
    override fun saveSlot(slot: ServiceSlot): ServiceSlot = delegate.saveSlot(slot)
    override fun getOffering(serviceId: UUID): ServiceOffering? = delegate.getOffering(serviceId)
    override fun getSlot(slotId: UUID): ServiceSlot? = delegate.getSlot(slotId)
    override fun listOfferings(capability: ServiceCapability?, outletId: UUID?): List<ServiceOffering> =
        delegate.listOfferings(capability, outletId)

    override fun availableSlots(serviceId: UUID, from: Instant, to: Instant, now: Instant): List<ServiceSlot> =
        delegate.availableSlots(serviceId, from, to, now)

    override fun hold(
        appointment: CustomerAppointment,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): CustomerAppointment {
        // The immutable V17 legacy columns accept only PAY_AT_PROVIDER/NOT_REQUIRED.
        // Use them strictly as compatibility storage; payment_mode/payment_state are
        // the canonical V18 values returned by this wrapper.
        val stored = delegate.hold(
            appointment.copy(
                paymentMethod = AppointmentPaymentMethod.PAY_AT_PROVIDER,
                paymentStatus = AppointmentPaymentStatus.NOT_REQUIRED,
            ),
            idempotencyKey,
            requestFingerprint,
            now,
        )
        val requestedStatus = when (appointment.paymentMethod) {
            AppointmentPaymentMethod.PAY_AT_PROVIDER -> AppointmentPaymentStatus.NOT_REQUIRED
            AppointmentPaymentMethod.ONLINE_PAYMENT -> AppointmentPaymentStatus.PENDING
        }
        jdbc.sql(
            """
            UPDATE mypet.appointment
            SET payment_mode = :payment_mode, payment_state = :payment_state
            WHERE id = :id
            """.trimIndent(),
        ).param("payment_mode", appointment.paymentMethod.name)
            .param("payment_state", requestedStatus.name)
            .param("id", stored.id)
            .update()
        return enrich(stored)
    }

    override fun confirm(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment? {
        val current = delegate.get(customerId, appointmentId, now)?.let(::enrich) ?: return null
        if (current.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT) {
            if (current.status == AppointmentStatus.BOOKED || current.status == AppointmentStatus.CONFIRMED) return current
            throw DomainException(
                "APPOINTMENT_PAYMENT_REQUIRED",
                "Online appointment payment must be captured before the booking request is submitted to the provider",
            )
        }
        return delegate.confirm(customerId, appointmentId, now)?.let(::enrich)
    }

    override fun cancel(customerId: UUID, appointmentId: UUID, reason: String?, now: Instant): CustomerAppointment? {
        val result = delegate.cancel(customerId, appointmentId, reason, now)?.let(::enrich) ?: return null
        if (result.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT) {
            terminalPayments.projectTerminalAppointment(result.id, reason ?: "CUSTOMER_CANCEL", now)
            return delegate.get(customerId, appointmentId, now)?.let(::enrich) ?: result
        }
        return result
    }

    override fun merchantTransition(
        outletId: UUID,
        appointmentId: UUID,
        allowedFrom: Set<AppointmentStatus>,
        target: AppointmentStatus,
        actorId: UUID,
        now: Instant,
    ): CustomerAppointment? {
        val result = delegate.merchantTransition(outletId, appointmentId, allowedFrom, target, actorId, now)
            ?.let(::enrich) ?: return null
        if (
            result.paymentMethod == AppointmentPaymentMethod.ONLINE_PAYMENT &&
            target in setOf(AppointmentStatus.REJECTED, AppointmentStatus.CANCELLED)
        ) {
            terminalPayments.projectTerminalAppointment(result.id, "MERCHANT_${target.name}", now)
            return enrich(result)
        }
        return result
    }

    override fun get(customerId: UUID, appointmentId: UUID, now: Instant): CustomerAppointment? =
        delegate.get(customerId, appointmentId, now)?.let(::enrich)

    override fun list(customerId: UUID, page: Int, pageSize: Int, now: Instant): AppointmentPage {
        val pageResult = delegate.list(customerId, page, pageSize, now)
        return pageResult.copy(items = pageResult.items.map(::enrich))
    }

    private fun enrich(appointment: CustomerAppointment): CustomerAppointment {
        val projection = jdbc.sql(
            "SELECT payment_mode, payment_state FROM mypet.appointment WHERE id = :id",
        ).param("id", appointment.id)
            .query { row, _ ->
                AppointmentPaymentMethod.valueOf(row.getString("payment_mode")) to
                    AppointmentPaymentStatus.valueOf(row.getString("payment_state"))
            }
            .optional()
            .orElse(null) ?: return appointment
        return appointment.copy(paymentMethod = projection.first, paymentStatus = projection.second)
    }
}
