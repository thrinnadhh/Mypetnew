package `in`.mypetnew.payment.domain

import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.PaymentMethods
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class PaymentReferenceType { PRODUCT_ORDER, APPOINTMENT }
enum class PaymentProvider { CASHFREE }
enum class PaymentStatus { PENDING, AUTHORIZED, CAPTURED, FAILED, EXPIRED }
enum class ProviderCommandState { PREPARED, CREATED, UNKNOWN, REJECTED }

data class Payment(
    val id: UUID,
    val referenceType: PaymentReferenceType,
    val referenceId: UUID,
    val customerId: UUID,
    val provider: PaymentProvider,
    val status: PaymentStatus,
    val amountPaise: Long,
    val currency: String,
    val providerOrderReference: String,
    val providerSessionId: String?,
    val providerIdempotencyKey: String,
    val commandState: ProviderCommandState,
    val expiresAt: Instant,
    val reconciliationRequired: Boolean = false,
)

data class PreparePaymentResult(val payment: Payment, val callProvider: Boolean)

sealed interface CreateProviderOrderResult {
    data class Created(val paymentSessionId: String) : CreateProviderOrderResult
    data class Rejected(val safeErrorCode: String) : CreateProviderOrderResult
    data object Unknown : CreateProviderOrderResult
}

data class CreateProviderOrderCommand(
    val paymentId: UUID,
    val providerOrderReference: String,
    val providerIdempotencyKey: String,
    val amountPaise: Long,
    val currency: String,
    val expiresAt: Instant,
)

interface PaymentGateway {
    fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult
}

interface PaymentPersistence {
    fun prepare(
        customerId: UUID,
        referenceType: PaymentReferenceType,
        referenceId: UUID,
        provider: PaymentProvider,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): PreparePaymentResult

    fun completeProviderOrder(paymentId: UUID, result: CreateProviderOrderResult, now: Instant): Payment
    fun getOwned(paymentId: UUID, customerId: UUID): Payment
}

class PaymentService(
    private val persistence: PaymentPersistence,
    private val gateway: PaymentGateway,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun initiate(
        customerId: UUID,
        referenceTypeValue: String,
        referenceId: UUID,
        providerValue: String,
        idempotencyKey: String,
    ): Payment {
        validateIdempotencyKey(idempotencyKey)
        val referenceType = enumValue<PaymentReferenceType>(referenceTypeValue, "PAYMENT_REFERENCE_INVALID")
        if (referenceType != PaymentReferenceType.PRODUCT_ORDER) {
            throw DomainException("PAYMENT_REFERENCE_UNSUPPORTED", "The payment reference is unsupported")
        }
        val provider = enumValue<PaymentProvider>(providerValue, "PAYMENT_PROVIDER_INVALID")
        val fingerprint = sha256("${referenceType.name}:$referenceId:${provider.name}")
        val prepared = persistence.prepare(
            customerId,
            referenceType,
            referenceId,
            provider,
            idempotencyKey,
            fingerprint,
            clock.instant(),
        )
        if (!prepared.callProvider) return prepared.payment

        val payment = prepared.payment
        val result = gateway.createOrder(
            CreateProviderOrderCommand(
                payment.id,
                payment.providerOrderReference,
                payment.providerIdempotencyKey,
                payment.amountPaise,
                payment.currency,
                payment.expiresAt,
            ),
        )
        return persistence.completeProviderOrder(payment.id, result, clock.instant())
    }

    fun get(paymentId: UUID, customerId: UUID): Payment = persistence.getOwned(paymentId, customerId)

    private inline fun <reified T : Enum<T>> enumValue(value: String, code: String): T =
        enumValues<T>().firstOrNull { it.name == value }
            ?: throw DomainException(code, "The payment request contains an unsupported value")

    private fun validateIdempotencyKey(value: String) {
        if (!value.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

class InMemoryPaymentPersistence(private val orders: OrderService) : PaymentPersistence {
    private data class Stored(
        val fingerprint: String,
        val initiationKey: String,
        val payment: Payment,
    )

    private val monitor = Any()
    private val byId = mutableMapOf<UUID, Stored>()
    private val byReference = mutableMapOf<Triple<PaymentReferenceType, UUID, PaymentProvider>, UUID>()
    private val byCommand = mutableMapOf<Pair<UUID, String>, UUID>()

    override fun prepare(
        customerId: UUID,
        referenceType: PaymentReferenceType,
        referenceId: UUID,
        provider: PaymentProvider,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): PreparePaymentResult = synchronized(monitor) {
        val commandKey = customerId to idempotencyKey
        byCommand[commandKey]?.let { paymentId ->
            val existing = requireNotNull(byId[paymentId])
            if (existing.fingerprint != requestFingerprint) mismatch()
            return@synchronized PreparePaymentResult(existing.payment, shouldCall(existing.payment))
        }
        val order = ownedOrder(referenceId, customerId)
        validatePayable(order, now)
        val referenceKey = Triple(referenceType, referenceId, provider)
        byReference[referenceKey]?.let { paymentId ->
            val existing = requireNotNull(byId[paymentId])
            byCommand[commandKey] = paymentId
            return@synchronized PreparePaymentResult(existing.payment, shouldCall(existing.payment))
        }
        val paymentId = UUID.randomUUID()
        val payment = Payment(
            id = paymentId,
            referenceType = referenceType,
            referenceId = referenceId,
            customerId = customerId,
            provider = provider,
            status = PaymentStatus.PENDING,
            amountPaise = order.grandTotalPaise,
            currency = "INR",
            providerOrderReference = providerOrderReference(paymentId),
            providerSessionId = null,
            providerIdempotencyKey = paymentId.toString(),
            commandState = ProviderCommandState.PREPARED,
            expiresAt = requireNotNull(order.paymentHoldExpiresAt),
        )
        byId[paymentId] = Stored(requestFingerprint, idempotencyKey, payment)
        byReference[referenceKey] = paymentId
        byCommand[commandKey] = paymentId
        PreparePaymentResult(payment, true)
    }

    override fun completeProviderOrder(paymentId: UUID, result: CreateProviderOrderResult, now: Instant): Payment =
        synchronized(monitor) {
            val stored = byId[paymentId] ?: notFound()
            val updated = when (result) {
                is CreateProviderOrderResult.Created -> stored.payment.copy(
                    providerSessionId = result.paymentSessionId,
                    commandState = ProviderCommandState.CREATED,
                )
                is CreateProviderOrderResult.Rejected -> stored.payment.copy(
                    status = PaymentStatus.FAILED,
                    commandState = ProviderCommandState.REJECTED,
                )
                CreateProviderOrderResult.Unknown -> stored.payment.copy(
                    commandState = ProviderCommandState.UNKNOWN,
                    reconciliationRequired = true,
                )
            }
            byId[paymentId] = stored.copy(payment = updated)
            updated
        }

    override fun getOwned(paymentId: UUID, customerId: UUID): Payment = synchronized(monitor) {
        byId[paymentId]?.payment?.takeIf { it.customerId == customerId } ?: notFound()
    }

    private fun ownedOrder(id: UUID, customerId: UUID): ProductOrder = try {
        orders.get(id).takeIf { it.customerId == customerId } ?: notFound()
    } catch (_: DomainException) {
        notFound()
    }

    private fun validatePayable(order: ProductOrder, now: Instant) {
        if (order.paymentMethod != PaymentMethods.ONLINE_PAYMENT || order.status != OrderStatus.PLACED) {
            throw DomainException("ORDER_NOT_PAYABLE", "The order is not payable online")
        }
        val expiresAt = order.paymentHoldExpiresAt
        if (expiresAt == null || !now.isBefore(expiresAt)) {
            throw DomainException("ORDER_PAYMENT_EXPIRED", "The online payment hold expired")
        }
    }

    private fun shouldCall(payment: Payment): Boolean =
        payment.providerSessionId == null && payment.commandState != ProviderCommandState.REJECTED

    private fun mismatch(): Nothing = throw DomainException(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        "The idempotency key was already used for another request",
    )

    private fun notFound(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    companion object {
        fun providerOrderReference(paymentId: UUID): String = "mypet_${paymentId.toString().replace("-", "")}"
    }
}

class FakePaymentGateway : PaymentGateway {
    override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult =
        CreateProviderOrderResult.Created("test_session_${command.paymentId}")
}
