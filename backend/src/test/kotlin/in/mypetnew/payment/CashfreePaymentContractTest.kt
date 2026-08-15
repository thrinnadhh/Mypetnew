package `in`.mypetnew.payment

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.CreateProviderOrderCommand
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.ProviderCustomer
import `in`.mypetnew.payment.infrastructure.CashfreeHttpRequest
import `in`.mypetnew.payment.infrastructure.CashfreeHttpResponse
import `in`.mypetnew.payment.infrastructure.CashfreePaymentGateway
import `in`.mypetnew.payment.infrastructure.CashfreeProperties
import `in`.mypetnew.payment.infrastructure.CashfreeTransport
import `in`.mypetnew.payment.infrastructure.CashfreeWebhookVerifier
import `in`.mypetnew.payment.infrastructure.MoneyBoundary
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import tools.jackson.databind.ObjectMapper
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class CashfreePaymentContractTest {
    private val secret = "0123456789abcdef0123456789abcdef"
    private val properties = CashfreeProperties(
        enabled = true,
        clientId = "test-client",
        clientSecret = secret,
        apiVersion = "2026-01-01",
        webhookVersion = "2026-01-01",
        baseUrl = "https://sandbox.cashfree.com/pg",
        returnUrl = "https://staging.example.com/payments/cashfree/return",
        notifyUrl = "https://api-staging.example.com/api/v1/webhooks/cashfree/payments",
    )
    private val json = ObjectMapper()

    @Test
    fun `money conversion is exact integer paise and rejects sub-paise values`() {
        assertEquals("123.45", MoneyBoundary.toProvider(12_345).toPlainString())
        assertEquals(12_345L, MoneyBoundary.fromProvider("123.45"))
        assertEquals(100L, MoneyBoundary.fromProvider("1"))
        assertThrows(ArithmeticException::class.java) { MoneyBoundary.fromProvider("1.001") }
        assertThrows(IllegalArgumentException::class.java) { MoneyBoundary.toProvider(-1) }
    }

    @Test
    fun `create order sends deterministic server amount identity version idempotency and callback metadata`() {
        var observed: CashfreeHttpRequest? = null
        val transport = CashfreeTransport { request ->
            observed = request
            CashfreeHttpResponse(
                200,
                """{"order_id":"mp_12345678901234567890123456789012","order_amount":135.00,"order_currency":"INR","payment_session_id":"session-safe"}""",
            )
        }
        val gateway = CashfreePaymentGateway(properties, transport, json)
        val command = CreateProviderOrderCommand(
            paymentId = UUID.randomUUID(),
            providerOrderReference = "mp_12345678901234567890123456789012",
            providerIdempotencyKey = UUID.randomUUID().toString(),
            amountPaise = 13_500,
            currency = "INR",
            expiresAt = Instant.parse("2026-08-15T12:15:00Z"),
            customer = ProviderCustomer("mypet_customer", "+919876543210"),
        )

        val result = gateway.createOrder(command)
        assertTrue(result is CreateProviderOrderResult.Created)
        assertEquals("2026-01-01", observed?.headers?.get("x-api-version"))
        assertEquals(command.providerIdempotencyKey, observed?.headers?.get("x-idempotency-key"))
        assertTrue(observed?.body.orEmpty().contains("\"order_amount\":135.00"))
        assertTrue(observed?.body.orEmpty().contains("\"customer_phone\":\"9876543210\""))
        assertTrue(observed?.body.orEmpty().contains("\"return_url\":\"https://staging.example.com/payments/cashfree/return\""))
        assertTrue(observed?.body.orEmpty().contains("\"notify_url\":\"https://api-staging.example.com/api/v1/webhooks/cashfree/payments\""))
        assertFalse(observed?.body.orEmpty().contains(secret))
    }

    @Test
    fun `webhook verifies exact raw body before normalizing safe payment facts`() {
        val verifier = CashfreeWebhookVerifier(properties, json)
        val timestamp = "1786796100000"
        val body = """
            {"type":"PAYMENT_SUCCESS_WEBHOOK","event_time":"2026-08-15T12:15:00Z","data":{"order":{"order_id":"mp_12345678901234567890123456789012","order_amount":135.00,"order_currency":"INR"},"payment":{"cf_payment_id":"987654321","payment_status":"SUCCESS","payment_amount":135.00,"payment_currency":"INR","payment_time":"2026-08-15T12:14:59+00:00"}}}
        """.trimIndent().toByteArray(StandardCharsets.UTF_8)
        val signature = sign(timestamp, body)

        val event = verifier.verifyAndNormalize(body, signature, timestamp, "2026-01-01", "delivery-1")

        assertEquals("delivery-1", event.deliveryIdentity)
        assertEquals("mp_12345678901234567890123456789012", event.providerOrderReference)
        assertEquals("987654321", event.providerPaymentId)
        assertEquals(PaymentAttemptOutcome.SUCCESS, event.attemptOutcome)
        assertEquals(13_500L, event.orderAmountPaise)
        assertEquals(13_500L, event.paymentAmountPaise)
        assertEquals("INR", event.orderCurrency)
        assertEquals("INR", event.paymentCurrency)
        assertEquals(64, event.payloadSha256.length)
    }

    @Test
    fun `bad signature wrong version and missing delivery identity fail closed`() {
        val verifier = CashfreeWebhookVerifier(properties, json)
        val timestamp = "1786796100000"
        val body = "{}".toByteArray(StandardCharsets.UTF_8)
        val signature = sign(timestamp, body)

        assertEquals("PAYMENT_WEBHOOK_SIGNATURE_INVALID", assertThrows(DomainException::class.java) {
            verifier.verifyAndNormalize(body, Base64.getEncoder().encodeToString(ByteArray(32)), timestamp, "2026-01-01", "delivery")
        }.code)
        assertEquals("PAYMENT_WEBHOOK_VERSION_INVALID", assertThrows(DomainException::class.java) {
            verifier.verifyAndNormalize(body, signature, timestamp, "2025-01-01", "delivery")
        }.code)
        assertEquals("PAYMENT_WEBHOOK_INVALID", assertThrows(DomainException::class.java) {
            verifier.verifyAndNormalize(body, signature, timestamp, "2026-01-01", null)
        }.code)
    }

    @Test
    fun `enabled provider configuration fails closed for unsupported version host or callback urls`() {
        assertThrows(IllegalArgumentException::class.java) {
            CashfreeProperties(enabled = true, clientId = "", clientSecret = secret)
        }
        assertThrows(IllegalArgumentException::class.java) {
            CashfreeProperties(
                enabled = true,
                clientId = "id",
                clientSecret = secret,
                apiVersion = "2025-01-01",
                returnUrl = properties.returnUrl,
                notifyUrl = properties.notifyUrl,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            CashfreeProperties(
                enabled = true,
                clientId = "id",
                clientSecret = secret,
                baseUrl = "https://payments.example.com/pg",
                returnUrl = properties.returnUrl,
                notifyUrl = properties.notifyUrl,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            CashfreeProperties(
                enabled = true,
                clientId = "id",
                clientSecret = secret,
                returnUrl = "http://localhost:8080/payment-return",
                notifyUrl = properties.notifyUrl,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            CashfreeProperties(
                enabled = true,
                clientId = "id",
                clientSecret = secret,
                returnUrl = properties.returnUrl,
                notifyUrl = "https://api-staging.example.com/wrong-webhook",
            )
        }
        assertFalse(properties.toString().contains(secret))
    }

    private fun sign(timestamp: String, body: ByteArray): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        mac.update(timestamp.toByteArray(StandardCharsets.UTF_8))
        return Base64.getEncoder().encodeToString(mac.doFinal(body))
    }
}
