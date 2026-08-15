package `in`.mypetnew.payment.domain

import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.PaymentMethods
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

enum class PaymentReferenceType { PRODUCT_ORDER, APPOINTMENT }
enum class PaymentProvider { CASHFREE }
enum class PaymentStatus { PENDING, AUTHORIZED, CAPTURED, FAILED, EXPIRED }
enum class ProviderCommandState { PREPARED, CREATED, UNKNOWN, REJECTED }
enum class PaymentAttemptOutcome { SUCCESS, FAILED, USER_DROPPED }
enum class RefundStatus { PENDING, SUCCESS, FAILED }
enum class RefundExecutionState { PREPARED, SUBMITTED, UNKNOWN, TERMINAL }
enum class WebhookProcessingStatus { RECEIVED, PROCESSING, PROCESSED, FAILED }

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
    val refundStatus: RefundStatus? = null,
)

data class ProviderCustomer(
    val customerReference: String,
    val mobileE164: String,
)

data class PreparePaymentResult(
    val payment: Payment,
    val callProvider: Boolean,
    val providerCustomer: ProviderCustomer,
)

sealed interface CreateProviderOrderResult {
    data class Created(val paymentSessionId: String) : CreateProviderOrderResult
    data class Rejected(val safeErrorCode: String) : CreateProviderOrderResult
    data class Unknown(val safeErrorCode: String = "PROVIDER_CREATE_UNKNOWN") : CreateProviderOrderResult
}

data class CreateProviderOrderCommand(
    val paymentId: UUID,
    val providerOrderReference: String,
    val providerIdempotencyKey: String,
    val amountPaise: Long,
    val currency: String,
    val expiresAt: Instant,
    val customer: ProviderCustomer,
)

data class ProviderPaymentSnapshot(
    val providerOrderReference: String,
    val providerPaymentId: String,
    val outcome: PaymentAttemptOutcome?,
    val orderAmountPaise: Long,
    val orderCurrency: String,
    val paymentAmountPaise: Long,
    val paymentCurrency: String,
    val providerPaymentTime: Instant?,
    val safeErrorCode: String? = null,
    val safeErrorReason: String? = null,
)

sealed interface ProviderPaymentsResult {
    data class Found(val attempts: List<ProviderPaymentSnapshot>) : ProviderPaymentsResult
    data class Unknown(val safeErrorCode: String = "PROVIDER_STATUS_UNKNOWN") : ProviderPaymentsResult
}

data class PaymentWebhookEvent(
    val provider: PaymentProvider,
    val deliveryIdentity: String,
    val webhookVersion: String,
    val eventType: String,
    val providerOrderReference: String,
    val providerPaymentId: String?,
    val attemptOutcome: PaymentAttemptOutcome?,
    val orderAmountPaise: Long,
    val orderCurrency: String,
    val paymentAmountPaise: Long?,
    val paymentCurrency: String?,
    val providerPaymentTime: Instant?,
    val providerEventTime: Instant?,
    val payloadSha256: String,
    val safeErrorCode: String? = null,
    val safeErrorReason: String? = null,
)

data class WebhookInboxItem(
    val id: UUID,
    val event: PaymentWebhookEvent,
    val retryCount: Int,
)

data class PaymentRefund(
    val id: UUID,
    val paymentId: UUID,
    val providerOrderReference: String,
    val status: RefundStatus,
    val amountPaise: Long,
    val currency: String,
    val providerRefundId: String,
    val providerIdempotencyKey: String,
    val executionState: RefundExecutionState,
    val reconciliationRequired: Boolean,
)

data class RefundProviderSnapshot(
    val providerRefundId: String,
    val status: RefundStatus,
    val providerStatus: String,
    val amountPaise: Long,
    val currency: String,
)

sealed interface RefundProviderResult {
    data class Found(val refund: RefundProviderSnapshot) : RefundProviderResult
    data object NotFound : RefundProviderResult
    data class Unknown(val safeErrorCode: String = "PROVIDER_REFUND_UNKNOWN") : RefundProviderResult
}

data class CreateRefundCommand(
    val refundId: UUID,
    val providerOrderReference: String,
    val providerRefundId: String,
    val providerIdempotencyKey: String,
    val amountPaise: Long,
    val currency: String,
)

interface PaymentGateway {
    val available: Boolean
    fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult
    fun paymentsForOrder(providerOrderReference: String): ProviderPaymentsResult
    fun createRefund(command: CreateRefundCommand): RefundProviderResult
    fun getRefund(providerOrderReference: String, providerRefundId: String): RefundProviderResult
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

    fun saveWebhook(event: PaymentWebhookEvent, now: Instant): Boolean
    fun claimWebhooks(limit: Int, now: Instant, lease: Duration): List<WebhookInboxItem>
    fun applyProviderPayment(snapshot: ProviderPaymentSnapshot, sourceIdentity: String, now: Instant): Payment
    fun markWebhookProcessed(inboxId: UUID, now: Instant)
    fun markWebhookFailed(inboxId: UUID, safeError: String, now: Instant)

    fun claimPaymentReconciliation(limit: Int, now: Instant, lease: Duration): List<Payment>
    fun schedulePaymentReconciliation(paymentId: UUID, safeErrorCode: String?, nextAttemptAt: Instant, now: Instant)

    fun expiredOrderIds(limit: Int, now: Instant): List<UUID>

    fun claimRefunds(limit: Int, now: Instant, lease: Duration): List<PaymentRefund>
    fun completeRefund(refundId: UUID, result: RefundProviderResult, now: Instant): PaymentRefund
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
        if (!gateway.available) {
            throw DomainException("PAYMENT_PROVIDER_UNAVAILABLE", "Online payment is temporarily unavailable")
        }
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
        val result = runCatching {
            gateway.createOrder(
                CreateProviderOrderCommand(
                    paymentId = payment.id,
                    providerOrderReference = payment.providerOrderReference,
                    providerIdempotencyKey = payment.providerIdempotencyKey,
                    amountPaise = payment.amountPaise,
                    currency = payment.currency,
                    expiresAt = payment.expiresAt,
                    customer = prepared.providerCustomer,
                ),
            )
        }.getOrElse { CreateProviderOrderResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
        return persistence.completeProviderOrder(payment.id, result, clock.instant())
    }

    fun get(paymentId: UUID, customerId: UUID): Payment = persistence.getOwned(paymentId, customerId)

    fun ingestWebhook(event: PaymentWebhookEvent): Boolean = persistence.saveWebhook(event, clock.instant())

    fun processWebhookBatch(limit: Int = 50): Int {
        val now = clock.instant()
        val items = persistence.claimWebhooks(limit.coerceIn(1, 200), now, Duration.ofMinutes(5))
        items.forEach { item ->
            runCatching {
                val event = item.event
                val providerPaymentId = event.providerPaymentId
                val paymentAmount = event.paymentAmountPaise
                val paymentCurrency = event.paymentCurrency
                if (providerPaymentId != null && paymentAmount != null && paymentCurrency != null) {
                    persistence.applyProviderPayment(
                        ProviderPaymentSnapshot(
                            providerOrderReference = event.providerOrderReference,
                            providerPaymentId = providerPaymentId,
                            outcome = event.attemptOutcome,
                            orderAmountPaise = event.orderAmountPaise,
                            orderCurrency = event.orderCurrency,
                            paymentAmountPaise = paymentAmount,
                            paymentCurrency = paymentCurrency,
                            providerPaymentTime = event.providerPaymentTime,
                            safeErrorCode = event.safeErrorCode,
                            safeErrorReason = event.safeErrorReason,
                        ),
                        sourceIdentity = "webhook:${event.deliveryIdentity}",
                        now = clock.instant(),
                    )
                }
                persistence.markWebhookProcessed(item.id, clock.instant())
            }.onFailure {
                persistence.markWebhookFailed(item.id, safeFailureCode(it), clock.instant())
            }
        }
        return items.size
    }

    fun reconcilePaymentBatch(limit: Int = 25): Int {
        val now = clock.instant()
        val candidates = persistence.claimPaymentReconciliation(limit.coerceIn(1, 100), now, Duration.ofMinutes(2))
        candidates.forEach { payment ->
            val result = runCatching { gateway.paymentsForOrder(payment.providerOrderReference) }
                .getOrElse { ProviderPaymentsResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
            when (result) {
                is ProviderPaymentsResult.Found -> {
                    result.attempts.forEach { attempt ->
                        runCatching {
                            persistence.applyProviderPayment(
                                attempt,
                                "reconcile:${payment.id}:${attempt.providerPaymentId}",
                                clock.instant(),
                            )
                        }
                    }
                    val captured = runCatching { persistence.getOwned(payment.id, payment.customerId).status == PaymentStatus.CAPTURED }
                        .getOrDefault(false)
                    if (!captured) {
                        persistence.schedulePaymentReconciliation(
                            payment.id,
                            null,
                            clock.instant().plusSeconds(30),
                            clock.instant(),
                        )
                    }
                }
                is ProviderPaymentsResult.Unknown -> persistence.schedulePaymentReconciliation(
                    payment.id,
                    result.safeErrorCode,
                    clock.instant().plusSeconds(30),
                    clock.instant(),
                )
            }
        }
        return candidates.size
    }

    fun expiredOrderIds(limit: Int = 50): List<UUID> =
        persistence.expiredOrderIds(limit.coerceIn(1, 200), clock.instant())

    fun processRefundBatch(limit: Int = 25): Int {
        val now = clock.instant()
        val refunds = persistence.claimRefunds(limit.coerceIn(1, 100), now, Duration.ofMinutes(2))
        refunds.forEach { refund ->
            val result = if (refund.executionState == RefundExecutionState.PREPARED) {
                runCatching {
                    gateway.createRefund(
                        CreateRefundCommand(
                            refundId = refund.id,
                            providerOrderReference = refund.providerOrderReference,
                            providerRefundId = refund.providerRefundId,
                            providerIdempotencyKey = refund.providerIdempotencyKey,
                            amountPaise = refund.amountPaise,
                            currency = refund.currency,
                        ),
                    )
                }.getOrElse { RefundProviderResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
            } else {
                runCatching { gateway.getRefund(refund.providerOrderReference, refund.providerRefundId) }
                    .getOrElse { RefundProviderResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
            }
            val resolved = if (result == RefundProviderResult.NotFound && refund.executionState == RefundExecutionState.UNKNOWN) {
                runCatching {
                    gateway.createRefund(
                        CreateRefundCommand(
                            refundId = refund.id,
                            providerOrderReference = refund.providerOrderReference,
                            providerRefundId = refund.providerRefundId,
                            providerIdempotencyKey = refund.providerIdempotencyKey,
                            amountPaise = refund.amountPaise,
                            currency = refund.currency,
                        ),
                    )
                }.getOrElse { RefundProviderResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
            } else {
                result
            }
            persistence.completeRefund(refund.id, resolved, clock.instant())
        }
        return refunds.size
    }

    private inline fun <reified T : Enum<T>> enumValue(value: String, code: String): T =
        enumValues<T>().firstOrNull { it.name == value }
            ?: throw DomainException(code, "The payment request contains an unsupported value")

    private fun validateIdempotencyKey(value: String) {
        if (!value.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun safeFailureCode(error: Throwable): String = when (error) {
        is DomainException -> error.code.take(64)
        else -> "PAYMENT_PROCESSING_FAILED"
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

class InMemoryPaymentPersistence(private val orders: OrderService) : PaymentPersistence {
    private data class Stored(val payment: Payment)
    private data class Command(val fingerprint: String, val paymentId: UUID)
    private data class StoredWebhook(
        val id: UUID,
        val event: PaymentWebhookEvent,
        var status: WebhookProcessingStatus,
        var retryCount: Int,
    )

    private val monitor = Any()
    private val byId = mutableMapOf<UUID, Stored>()
    private val byReference = mutableMapOf<Triple<PaymentReferenceType, UUID, PaymentProvider>, UUID>()
    private val byCommand = mutableMapOf<Pair<UUID, String>, Command>()
    private val webhooks = mutableMapOf<Pair<PaymentProvider, String>, StoredWebhook>()

    override fun prepare(
        customerId: UUID,
        referenceType: PaymentReferenceType,
        referenceId: UUID,
        provider: PaymentProvider,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): PreparePaymentResult = synchronized(monitor) {
        val order = ownedOrder(referenceId, customerId)
        val commandKey = customerId to idempotencyKey
        byCommand[commandKey]?.let { command ->
            if (command.fingerprint != requestFingerprint) mismatch()
            val existing = requireNotNull(byId[command.paymentId]).payment
            return@synchronized PreparePaymentResult(existing, shouldCall(existing), providerCustomer(customerId))
        }
        validatePayable(order, now)
        val referenceKey = Triple(referenceType, referenceId, provider)
        byReference[referenceKey]?.let { paymentId ->
            val existing = requireNotNull(byId[paymentId]).payment
            byCommand[commandKey] = Command(requestFingerprint, paymentId)
            return@synchronized PreparePaymentResult(existing, shouldCall(existing), providerCustomer(customerId))
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
            reconciliationRequired = true,
        )
        byId[paymentId] = Stored(payment)
        byReference[referenceKey] = paymentId
        byCommand[commandKey] = Command(requestFingerprint, paymentId)
        PreparePaymentResult(payment, true, providerCustomer(customerId))
    }

    override fun completeProviderOrder(paymentId: UUID, result: CreateProviderOrderResult, now: Instant): Payment =
        synchronized(monitor) {
            val stored = byId[paymentId] ?: notFound()
            val updated = when (result) {
                is CreateProviderOrderResult.Created -> stored.payment.copy(
                    providerSessionId = result.paymentSessionId,
                    commandState = ProviderCommandState.CREATED,
                    reconciliationRequired = true,
                )
                is CreateProviderOrderResult.Rejected -> stored.payment.copy(
                    status = PaymentStatus.FAILED,
                    commandState = ProviderCommandState.REJECTED,
                    reconciliationRequired = false,
                )
                is CreateProviderOrderResult.Unknown -> stored.payment.copy(
                    commandState = ProviderCommandState.UNKNOWN,
                    reconciliationRequired = true,
                )
            }
            byId[paymentId] = Stored(updated)
            updated
        }

    override fun getOwned(paymentId: UUID, customerId: UUID): Payment = synchronized(monitor) {
        byId[paymentId]?.payment?.takeIf { it.customerId == customerId } ?: notFound()
    }

    override fun saveWebhook(event: PaymentWebhookEvent, now: Instant): Boolean = synchronized(monitor) {
        val key = event.provider to event.deliveryIdentity
        if (webhooks.containsKey(key)) return@synchronized false
        webhooks[key] = StoredWebhook(UUID.randomUUID(), event, WebhookProcessingStatus.RECEIVED, 0)
        true
    }

    override fun claimWebhooks(limit: Int, now: Instant, lease: Duration): List<WebhookInboxItem> = synchronized(monitor) {
        webhooks.values
            .filter { it.status == WebhookProcessingStatus.RECEIVED || it.status == WebhookProcessingStatus.FAILED }
            .take(limit)
            .map {
                it.status = WebhookProcessingStatus.PROCESSING
                it.retryCount += 1
                WebhookInboxItem(it.id, it.event, it.retryCount)
            }
    }

    override fun applyProviderPayment(snapshot: ProviderPaymentSnapshot, sourceIdentity: String, now: Instant): Payment =
        synchronized(monitor) {
            val entry = byId.entries.firstOrNull { it.value.payment.providerOrderReference == snapshot.providerOrderReference }
                ?: notFound()
            val payment = entry.value.payment
            if (
                snapshot.orderAmountPaise != payment.amountPaise || snapshot.orderCurrency != payment.currency ||
                snapshot.paymentAmountPaise != payment.amountPaise || snapshot.paymentCurrency != payment.currency
            ) {
                throw DomainException("PAYMENT_PROVIDER_AMOUNT_MISMATCH", "Provider payment amount does not match the order")
            }
            val updated = if (snapshot.outcome == PaymentAttemptOutcome.SUCCESS) {
                payment.copy(status = PaymentStatus.CAPTURED, reconciliationRequired = false)
            } else {
                payment
            }
            byId[entry.key] = Stored(updated)
            updated
        }

    override fun markWebhookProcessed(inboxId: UUID, now: Instant) = synchronized(monitor) {
        webhooks.values.firstOrNull { it.id == inboxId }?.status = WebhookProcessingStatus.PROCESSED
        Unit
    }

    override fun markWebhookFailed(inboxId: UUID, safeError: String, now: Instant) = synchronized(monitor) {
        webhooks.values.firstOrNull { it.id == inboxId }?.status = WebhookProcessingStatus.FAILED
        Unit
    }

    override fun claimPaymentReconciliation(limit: Int, now: Instant, lease: Duration): List<Payment> = synchronized(monitor) {
        byId.values.map { it.payment }.filter { it.reconciliationRequired }.take(limit)
    }

    override fun schedulePaymentReconciliation(
        paymentId: UUID,
        safeErrorCode: String?,
        nextAttemptAt: Instant,
        now: Instant,
    ) = synchronized(monitor) {
        val stored = byId[paymentId] ?: notFound()
        byId[paymentId] = Stored(stored.payment.copy(reconciliationRequired = true))
        Unit
    }

    override fun expiredOrderIds(limit: Int, now: Instant): List<UUID> = emptyList()

    override fun claimRefunds(limit: Int, now: Instant, lease: Duration): List<PaymentRefund> = emptyList()

    override fun completeRefund(refundId: UUID, result: RefundProviderResult, now: Instant): PaymentRefund =
        throw DomainException("RESOURCE_NOT_FOUND", "The requested refund is unavailable")

    private fun ownedOrder(id: UUID, customerId: UUID): ProductOrder = try {
        orders.get(id).takeIf { it.customerId == customerId } ?: notFound()
    } catch (_: DomainException) {
        notFound()
    }

    private fun validatePayable(order: ProductOrder, now: Instant) {
        if (
            order.paymentMethod != PaymentMethods.ONLINE_PAYMENT ||
            order.status != OrderStatus.PLACED ||
            order.paymentStatus != "PENDING_ONLINE_PAYMENT"
        ) {
            throw DomainException("ORDER_NOT_PAYABLE", "The order is not payable online")
        }
        val expiresAt = order.paymentHoldExpiresAt
        if (expiresAt == null || !now.isBefore(expiresAt)) {
            throw DomainException("ORDER_PAYMENT_EXPIRED", "The online payment hold expired")
        }
    }

    private fun shouldCall(payment: Payment): Boolean =
        payment.providerSessionId == null && payment.commandState != ProviderCommandState.REJECTED

    private fun providerCustomer(customerId: UUID): ProviderCustomer =
        ProviderCustomer("mypet_${customerId.toString().replace("-", "")}", "+919999999999")

    private fun mismatch(): Nothing = throw DomainException(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        "The idempotency key was already used for another request",
    )

    private fun notFound(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    companion object {
        fun providerOrderReference(paymentId: UUID): String = "mp_${paymentId.toString().replace("-", "")}"
    }
}

class FakePaymentGateway : PaymentGateway {
    override val available: Boolean = true

    override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult =
        CreateProviderOrderResult.Created("test_session_${command.paymentId}")

    override fun paymentsForOrder(providerOrderReference: String): ProviderPaymentsResult =
        ProviderPaymentsResult.Found(emptyList())

    override fun createRefund(command: CreateRefundCommand): RefundProviderResult = RefundProviderResult.Found(
        RefundProviderSnapshot(command.providerRefundId, RefundStatus.SUCCESS, "SUCCESS", command.amountPaise, command.currency),
    )

    override fun getRefund(providerOrderReference: String, providerRefundId: String): RefundProviderResult =
        RefundProviderResult.NotFound
}
