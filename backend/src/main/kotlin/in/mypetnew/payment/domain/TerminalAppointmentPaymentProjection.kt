package `in`.mypetnew.payment.domain

import java.time.Instant
import java.util.UUID

/**
 * Called after a canonical appointment becomes terminal (customer cancellation,
 * provider rejection, hold expiry). Implementations are idempotent and ensure a
 * captured appointment payment is refunded while a still-pending provider
 * payment is expired/reconciled safely.
 */
fun interface TerminalAppointmentPaymentProjection {
    fun projectTerminalAppointment(appointmentId: UUID, reason: String?, now: Instant): String?
}
