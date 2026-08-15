package `in`.mypetnew.payment.domain

import java.time.Instant
import java.util.UUID

/**
 * Invoked only while the owning ProductOrder row is already locked by the
 * commerce transaction. Implementations must preserve the global lock order:
 * ProductOrder -> Payment -> Refund -> subordinate rows.
 */
fun interface TerminalOrderPaymentProjection {
    fun projectTerminalOrder(orderId: UUID, reason: String?, now: Instant): String?
}
