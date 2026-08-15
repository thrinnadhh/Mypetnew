package `in`.mypetnew.payment.infrastructure

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.payment.domain.PaymentService
import org.springframework.context.annotation.Profile
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
@Profile("!test & !development")
class PaymentLifecycleWorkers(
    private val payments: PaymentService,
    private val orders: OrderService,
) {
    @Scheduled(fixedDelayString = "\${mypet.payments.webhook-worker-delay-ms:1000}")
    fun processWebhookInbox() {
        payments.processWebhookBatch()
    }

    @Scheduled(fixedDelayString = "\${mypet.payments.reconciliation-delay-ms:15000}")
    fun reconcilePayments() {
        payments.reconcilePaymentBatch()
    }

    @Scheduled(fixedDelayString = "\${mypet.payments.expiry-delay-ms:5000}")
    fun expireUnpaidOrders() {
        payments.expiredOrderIds().forEach { orderId ->
            runCatching {
                orders.transition(
                    orderId = orderId,
                    target = OrderStatus.CANCELLED,
                    idempotencyKey = "payment-expiry-$orderId",
                    actorId = InventoryService.SYSTEM_ACTOR_ID,
                    actorRole = Role.CUSTOMER,
                    reason = "ORDER_PAYMENT_EXPIRED",
                    traceId = "payment-expiry",
                )
            }
        }
    }

    @Scheduled(fixedDelayString = "\${mypet.payments.refund-delay-ms:5000}")
    fun processRefunds() {
        payments.processRefundBatch()
    }
}
