package `in`.mypetnew.application.web

import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.payment.infrastructure.CashfreeWebhookVerifier
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RestController

@RestController
class PaymentWebhookController(
    private val verifier: CashfreeWebhookVerifier,
    private val payments: PaymentService,
) {
    @PostMapping("/api/v1/webhooks/cashfree/payments")
    fun cashfreePayment(
        @RequestBody rawBody: ByteArray,
        @RequestHeader("x-webhook-signature", required = false) signature: String?,
        @RequestHeader("x-webhook-timestamp", required = false) timestamp: String?,
        @RequestHeader("x-webhook-version", required = false) webhookVersion: String?,
        @RequestHeader("x-idempotency-key", required = false) deliveryIdentity: String?,
    ): ResponseEntity<Map<String, Boolean>> {
        val event = verifier.verifyAndNormalize(rawBody, signature, timestamp, webhookVersion, deliveryIdentity)
        payments.ingestWebhook(event)
        // Duplicate verified deliveries are intentionally acknowledged. A first
        // delivery is acknowledged only after its durable inbox INSERT commits.
        return ResponseEntity.ok(mapOf("accepted" to true))
    }
}
