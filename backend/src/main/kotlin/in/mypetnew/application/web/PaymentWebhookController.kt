package `in`.mypetnew.application.web

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.payment.infrastructure.CashfreeWebhookVerifier
import `in`.mypetnew.payment.infrastructure.JdbcAppointmentOnlinePaymentService
import org.springframework.beans.factory.ObjectProvider
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RestController

@RestController
class PaymentWebhookController(
    private val verifiers: ObjectProvider<CashfreeWebhookVerifier>,
    private val payments: PaymentService,
    private val appointmentPaymentProvider: ObjectProvider<JdbcAppointmentOnlinePaymentService>,
) {
    @PostMapping("/api/v1/webhooks/cashfree/payments")
    fun cashfreePayment(
        @RequestBody rawBody: ByteArray,
        @RequestHeader("x-webhook-signature", required = false) signature: String?,
        @RequestHeader("x-webhook-timestamp", required = false) timestamp: String?,
        @RequestHeader("x-webhook-version", required = false) webhookVersion: String?,
        @RequestHeader("x-idempotency-key", required = false) deliveryIdentity: String?,
    ): ResponseEntity<Map<String, Boolean>> {
        val verifier = verifiers.getIfAvailable()
            ?: throw DomainException("PAYMENT_PROVIDER_UNAVAILABLE", "Online payment webhook processing is unavailable")
        val event = verifier.verifyAndNormalize(rawBody, signature, timestamp, webhookVersion, deliveryIdentity)
        val appointmentPayments = appointmentPaymentProvider.getIfAvailable()
        if (appointmentPayments != null && appointmentPayments.isAppointmentProviderOrder(event.providerOrderReference)) {
            appointmentPayments.ingestWebhook(event)
        } else {
            payments.ingestWebhook(event)
        }
        // Duplicate verified deliveries are intentionally acknowledged. A first
        // delivery is acknowledged only after its durable write/projection commits.
        return ResponseEntity.ok(mapOf("accepted" to true))
    }
}
