package `in`.mypetnew.payment.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.CreateProviderOrderCommand
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.CreateRefundCommand
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.PaymentGateway
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentWebhookEvent
import `in`.mypetnew.payment.domain.ProviderPaymentSnapshot
import `in`.mypetnew.payment.domain.ProviderPaymentsResult
import `in`.mypetnew.payment.domain.RefundProviderResult
import `in`.mypetnew.payment.domain.RefundProviderSnapshot
import `in`.mypetnew.payment.domain.RefundStatus
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

@ConfigurationProperties("mypet.cashfree")
data class CashfreeProperties(
    val enabled: Boolean = false,
    val clientId: String = "",
    val clientSecret: String = "",
    val apiVersion: String = SUPPORTED_VERSION,
    val webhookVersion: String = SUPPORTED_VERSION,
    val baseUrl: String = "https://sandbox.cashfree.com/pg",
    val returnUrl: String = "",
    val notifyUrl: String = "",
) {
    init {
        require(apiVersion == SUPPORTED_VERSION) { "CASHFREE_API_VERSION is unsupported" }
        require(webhookVersion == SUPPORTED_VERSION) { "CASHFREE_WEBHOOK_VERSION is unsupported" }
        require(baseUrl.startsWith("https://")) { "CASHFREE_BASE_URL must use HTTPS" }
        if (enabled) {
            require(clientId.isNotBlank()) { "CASHFREE_CLIENT_ID is required when online payments are enabled" }
            require(clientSecret.length >= 16) { "CASHFREE_CLIENT_SECRET is invalid" }
        }
    }

    override fun toString(): String =
        "CashfreeProperties(enabled=$enabled, clientId=[REDACTED], clientSecret=[REDACTED], apiVersion=$apiVersion, webhookVersion=$webhookVersion, baseUrl=$baseUrl)"

    companion object {
        const val SUPPORTED_VERSION = "2026-01-01"
    }
}

data class CashfreeHttpResponse(val status: Int, val body: String)

fun interface CashfreeTransport {
    fun send(request: CashfreeHttpRequest): CashfreeHttpResponse
}

data class CashfreeHttpRequest(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
    val body: String? = null,
)

class JavaCashfreeTransport(
    private val baseUrl: String,
    private val http: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
) : CashfreeTransport {
    override fun send(request: CashfreeHttpRequest): CashfreeHttpResponse {
        val builder = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl.trimEnd('/') + request.path))
            .timeout(Duration.ofSeconds(20))
        request.headers.forEach(builder::header)
        when (request.method) {
            "GET" -> builder.GET()
            "POST" -> builder.POST(HttpRequest.BodyPublishers.ofString(request.body.orEmpty(), StandardCharsets.UTF_8))
            else -> throw IllegalArgumentException("Unsupported Cashfree HTTP method")
        }
        val response = try {
            http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        } catch (interrupted: InterruptedException) {
            Thread.currentThread().interrupt()
            throw interrupted
        }
        return CashfreeHttpResponse(response.statusCode(), response.body())
    }
}

class CashfreePaymentGateway(
    private val properties: CashfreeProperties,
    private val transport: CashfreeTransport,
    private val json: ObjectMapper,
) : PaymentGateway {
    override val available: Boolean = properties.enabled

    override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult {
        if (!available) return CreateProviderOrderResult.Rejected("CASHFREE_DISABLED")
        if (!validProviderOrderId(command.providerOrderReference)) {
            return CreateProviderOrderResult.Rejected("CASHFREE_ORDER_ID_INVALID")
        }
        if (command.currency != "INR" || command.amountPaise < 0) {
            return CreateProviderOrderResult.Rejected("CASHFREE_ORDER_AMOUNT_INVALID")
        }
        val phone = indianPhone(command.customer.mobileE164)
            ?: return CreateProviderOrderResult.Rejected("CASHFREE_CUSTOMER_PHONE_INVALID")
        val body = linkedMapOf<String, Any>(
            "order_id" to command.providerOrderReference,
            "order_amount" to MoneyBoundary.toProvider(command.amountPaise),
            "order_currency" to command.currency,
            "customer_details" to mapOf(
                "customer_id" to command.customer.customerReference.take(45),
                "customer_phone" to phone,
            ),
            "order_expiry_time" to command.expiresAt.toString(),
            "order_note" to "MyPet product order",
        )
        val meta = linkedMapOf<String, String>()
        properties.returnUrl.takeIf(String::isNotBlank)?.let { meta["return_url"] = it }
        properties.notifyUrl.takeIf(String::isNotBlank)?.let { meta["notify_url"] = it }
        if (meta.isNotEmpty()) body["order_meta"] = meta

        val response = runCatching {
            transport.send(
                CashfreeHttpRequest(
                    method = "POST",
                    path = "/orders",
                    headers = authenticatedHeaders(command.providerIdempotencyKey),
                    body = json.writeValueAsString(body),
                ),
            )
        }.getOrElse { return CreateProviderOrderResult.Unknown("CASHFREE_TRANSPORT_UNKNOWN") }

        if (response.status !in 200..299) {
            return if (response.status == 400 || response.status == 422) {
                CreateProviderOrderResult.Rejected("CASHFREE_HTTP_${response.status}")
            } else {
                CreateProviderOrderResult.Unknown("CASHFREE_HTTP_${response.status}")
            }
        }
        return runCatching {
            val root = json.readTree(response.body)
            val orderId = requiredText(root, "order_id")
            val currency = requiredText(root, "order_currency")
            val amount = MoneyBoundary.fromProvider(root.path("order_amount").asText())
            val sessionId = requiredText(root, "payment_session_id")
            if (orderId != command.providerOrderReference || currency != command.currency || amount != command.amountPaise) {
                CreateProviderOrderResult.Unknown("CASHFREE_ORDER_RESPONSE_MISMATCH")
            } else {
                CreateProviderOrderResult.Created(sessionId)
            }
        }.getOrElse { CreateProviderOrderResult.Unknown("CASHFREE_ORDER_RESPONSE_INVALID") }
    }

    override fun paymentsForOrder(providerOrderReference: String): ProviderPaymentsResult {
        if (!available || !validProviderOrderId(providerOrderReference)) {
            return ProviderPaymentsResult.Unknown("CASHFREE_STATUS_UNAVAILABLE")
        }
        val response = runCatching {
            transport.send(
                CashfreeHttpRequest(
                    method = "GET",
                    path = "/orders/$providerOrderReference/payments",
                    headers = authenticatedHeaders(null),
                ),
            )
        }.getOrElse { return ProviderPaymentsResult.Unknown("CASHFREE_TRANSPORT_UNKNOWN") }
        if (response.status !in 200..299) return ProviderPaymentsResult.Unknown("CASHFREE_HTTP_${response.status}")
        return runCatching {
            val root = json.readTree(response.body)
            if (!root.isArray) return@runCatching ProviderPaymentsResult.Unknown("CASHFREE_PAYMENTS_RESPONSE_INVALID")
            val attempts = mutableListOf<ProviderPaymentSnapshot>()
            val iterator = root.iterator()
            while (iterator.hasNext()) {
                attempts += paymentSnapshot(iterator.next(), providerOrderReference)
            }
            ProviderPaymentsResult.Found(attempts)
        }.getOrElse { ProviderPaymentsResult.Unknown("CASHFREE_PAYMENTS_RESPONSE_INVALID") }
    }

    override fun createRefund(command: CreateRefundCommand): RefundProviderResult {
        if (!available) return RefundProviderResult.Unknown("CASHFREE_DISABLED")
        if (!validProviderOrderId(command.providerOrderReference) || !command.providerRefundId.matches(Regex("[A-Za-z0-9_-]{3,40}"))) {
            return RefundProviderResult.Unknown("CASHFREE_REFUND_ID_INVALID")
        }
        val body = mapOf(
            "refund_amount" to MoneyBoundary.toProvider(command.amountPaise),
            "refund_id" to command.providerRefundId,
            "refund_note" to "MyPet full order refund",
            "refund_speed" to "STANDARD",
        )
        val response = runCatching {
            transport.send(
                CashfreeHttpRequest(
                    method = "POST",
                    path = "/orders/${command.providerOrderReference}/refunds",
                    headers = authenticatedHeaders(command.providerIdempotencyKey),
                    body = json.writeValueAsString(body),
                ),
            )
        }.getOrElse { return RefundProviderResult.Unknown("CASHFREE_TRANSPORT_UNKNOWN") }
        if (response.status !in 200..299) return RefundProviderResult.Unknown("CASHFREE_HTTP_${response.status}")
        return parseRefund(response.body)
    }

    override fun getRefund(providerOrderReference: String, providerRefundId: String): RefundProviderResult {
        if (!available) return RefundProviderResult.Unknown("CASHFREE_DISABLED")
        val response = runCatching {
            transport.send(
                CashfreeHttpRequest(
                    method = "GET",
                    path = "/orders/$providerOrderReference/refunds/$providerRefundId",
                    headers = authenticatedHeaders(null),
                ),
            )
        }.getOrElse { return RefundProviderResult.Unknown("CASHFREE_TRANSPORT_UNKNOWN") }
        if (response.status == 404) return RefundProviderResult.NotFound
        if (response.status !in 200..299) return RefundProviderResult.Unknown("CASHFREE_HTTP_${response.status}")
        return parseRefund(response.body)
    }

    private fun parseRefund(body: String): RefundProviderResult = runCatching {
        val root = json.readTree(body)
        val node = if (root.isArray) {
            val iterator = root.iterator()
            if (!iterator.hasNext()) return@runCatching RefundProviderResult.Unknown("CASHFREE_REFUND_RESPONSE_INVALID")
            iterator.next()
        } else {
            root
        }
        val providerStatus = requiredText(node, "refund_status").uppercase()
        val status = when (providerStatus) {
            "SUCCESS" -> RefundStatus.SUCCESS
            "PENDING", "ONHOLD" -> RefundStatus.PENDING
            "FAILED", "CANCELLED" -> RefundStatus.FAILED
            else -> return@runCatching RefundProviderResult.Unknown("CASHFREE_REFUND_STATUS_UNKNOWN")
        }
        RefundProviderResult.Found(
            RefundProviderSnapshot(
                providerRefundId = requiredText(node, "refund_id"),
                status = status,
                providerStatus = providerStatus,
                amountPaise = MoneyBoundary.fromProvider(node.path("refund_amount").asText()),
                currency = requiredText(node, "refund_currency"),
            ),
        )
    }.getOrElse { RefundProviderResult.Unknown("CASHFREE_REFUND_RESPONSE_INVALID") }

    private fun paymentSnapshot(node: JsonNode, expectedOrderReference: String): ProviderPaymentSnapshot {
        val orderId = requiredText(node, "order_id")
        if (orderId != expectedOrderReference) throw IllegalArgumentException("Cashfree order mismatch")
        val status = requiredText(node, "payment_status").uppercase()
        val outcome = when (status) {
            "SUCCESS" -> PaymentAttemptOutcome.SUCCESS
            "FAILED" -> PaymentAttemptOutcome.FAILED
            "USER_DROPPED" -> PaymentAttemptOutcome.USER_DROPPED
            else -> null
        }
        val errorCode = node.path("error_details").path("error_code").asString().takeIf(String::isNotBlank)?.take(64)
        return ProviderPaymentSnapshot(
            providerOrderReference = orderId,
            providerPaymentId = requiredText(node, "cf_payment_id"),
            outcome = outcome,
            orderAmountPaise = MoneyBoundary.fromProvider(node.path("order_amount").asText()),
            orderCurrency = requiredText(node, "order_currency"),
            paymentAmountPaise = MoneyBoundary.fromProvider(node.path("payment_amount").asText()),
            paymentCurrency = requiredText(node, "payment_currency"),
            providerPaymentTime = parseInstant(node.path("payment_time").asString()),
            safeErrorCode = errorCode,
        )
    }

    private fun authenticatedHeaders(idempotencyKey: String?): Map<String, String> = buildMap {
        put("Content-Type", "application/json; charset=utf-8")
        put("Accept", "application/json")
        put("x-api-version", properties.apiVersion)
        put("x-client-id", properties.clientId)
        put("x-client-secret", properties.clientSecret)
        idempotencyKey?.let { put("x-idempotency-key", it) }
    }

    private fun indianPhone(value: String): String? {
        val digits = value.filter(Char::isDigit)
        val phone = if (digits.length > 10) digits.takeLast(10) else digits
        return phone.takeIf { it.matches(Regex("[6-9][0-9]{9}")) }
    }

    private fun validProviderOrderId(value: String): Boolean = value.matches(Regex("[A-Za-z0-9_-]{3,45}"))
}

class CashfreeWebhookVerifier(
    private val properties: CashfreeProperties,
    private val json: ObjectMapper,
) {
    fun verifyAndNormalize(
        rawBody: ByteArray,
        signature: String?,
        timestamp: String?,
        webhookVersion: String?,
        deliveryIdentity: String?,
    ): PaymentWebhookEvent {
        if (!properties.enabled) throw DomainException("PAYMENT_PROVIDER_UNAVAILABLE", "Online payment is unavailable")
        val requiredSignature = signature?.takeIf(String::isNotBlank) ?: invalidWebhook()
        val requiredTimestamp = timestamp?.takeIf { it.matches(Regex("[0-9]{10,20}")) } ?: invalidWebhook()
        val requiredVersion = webhookVersion?.takeIf { it == properties.webhookVersion }
            ?: throw DomainException("PAYMENT_WEBHOOK_VERSION_INVALID", "The payment webhook version is unsupported")
        val requiredDelivery = deliveryIdentity?.takeIf { it.length in 1..160 } ?: invalidWebhook()
        verifyHmac(requiredTimestamp, rawBody, requiredSignature)

        val root = runCatching { json.readTree(rawBody) }.getOrElse { invalidWebhook() }
        val data = root.path("data")
        val order = data.path("order")
        val payment = data.path("payment")
        val eventType = requiredText(root, "type").takeIf { it.matches(Regex("[A-Z0-9_-]{1,80}")) } ?: invalidWebhook()
        val providerOrderReference = requiredText(order, "order_id").takeIf { it.matches(Regex("[A-Za-z0-9_-]{3,45}")) }
            ?: invalidWebhook()
        val providerPaymentId = payment.path("cf_payment_id").asString().takeIf(String::isNotBlank)?.take(96)
        val paymentStatus = payment.path("payment_status").asString().uppercase()
        val outcome = when (paymentStatus) {
            "SUCCESS" -> PaymentAttemptOutcome.SUCCESS
            "FAILED" -> PaymentAttemptOutcome.FAILED
            "USER_DROPPED" -> PaymentAttemptOutcome.USER_DROPPED
            else -> null
        }
        val orderAmount = exactMoney(order.path("order_amount"))
        val orderCurrency = requiredText(order, "order_currency")
        val paymentAmount = payment.path("payment_amount").takeUnless { it.isMissingNode || it.isNull }?.let(::exactMoney)
        val paymentCurrency = payment.path("payment_currency").asString().takeIf(String::isNotBlank)
        val safeErrorCode = data.path("error_details").path("error_code").asString().takeIf(String::isNotBlank)?.take(64)

        return PaymentWebhookEvent(
            provider = PaymentProvider.CASHFREE,
            deliveryIdentity = requiredDelivery,
            webhookVersion = requiredVersion,
            eventType = eventType,
            providerOrderReference = providerOrderReference,
            providerPaymentId = providerPaymentId,
            attemptOutcome = outcome,
            orderAmountPaise = orderAmount,
            orderCurrency = orderCurrency,
            paymentAmountPaise = paymentAmount,
            paymentCurrency = paymentCurrency,
            providerPaymentTime = parseInstant(payment.path("payment_time").asString()),
            providerEventTime = parseInstant(root.path("event_time").asString()),
            payloadSha256 = sha256(rawBody),
            safeErrorCode = safeErrorCode,
        )
    }

    private fun verifyHmac(timestamp: String, rawBody: ByteArray, signature: String) {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(properties.clientSecret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        mac.update(timestamp.toByteArray(StandardCharsets.UTF_8))
        val expected = mac.doFinal(rawBody)
        val supplied = runCatching { Base64.getDecoder().decode(signature) }.getOrElse { invalidWebhook() }
        if (!MessageDigest.isEqual(expected, supplied)) {
            throw DomainException("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "The payment webhook signature is invalid")
        }
    }

    private fun exactMoney(node: JsonNode): Long = runCatching { MoneyBoundary.fromProvider(node.asText()) }
        .getOrElse { invalidWebhook() }

    private fun invalidWebhook(): Nothing =
        throw DomainException("PAYMENT_WEBHOOK_INVALID", "The payment webhook is invalid")
}

object MoneyBoundary {
    fun toProvider(amountPaise: Long): BigDecimal {
        require(amountPaise >= 0) { "Money cannot be negative" }
        return BigDecimal.valueOf(amountPaise, 2)
    }

    fun fromProvider(value: String): Long = BigDecimal(value)
        .setScale(2, RoundingMode.UNNECESSARY)
        .movePointRight(2)
        .longValueExact()
        .also { require(it >= 0) { "Money cannot be negative" } }
}

@Configuration
@Profile("!test & !development")
@EnableConfigurationProperties(CashfreeProperties::class)
class CashfreePaymentConfiguration {
    @Bean
    fun cashfreeTransport(properties: CashfreeProperties): CashfreeTransport = JavaCashfreeTransport(properties.baseUrl)

    @Bean
    fun paymentGateway(
        properties: CashfreeProperties,
        transport: CashfreeTransport,
        json: ObjectMapper,
    ): PaymentGateway = CashfreePaymentGateway(properties, transport, json)

    @Bean
    fun cashfreeWebhookVerifier(properties: CashfreeProperties, json: ObjectMapper): CashfreeWebhookVerifier =
        CashfreeWebhookVerifier(properties, json)
}

private fun requiredText(node: JsonNode, field: String): String =
    node.path(field).asString().takeIf(String::isNotBlank) ?: throw IllegalArgumentException("Missing provider field")

private fun parseInstant(value: String): Instant? = value.takeIf(String::isNotBlank)?.let { text ->
    runCatching { OffsetDateTime.parse(text).toInstant() }
        .recoverCatching { Instant.parse(text) }
        .getOrNull()
}

private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes)
    .joinToString("") { "%02x".format(it) }
