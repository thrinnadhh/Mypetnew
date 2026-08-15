package `in`.mypetnew.payment

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.PaymentMethods
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.CreateProviderOrderCommand
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.CreateRefundCommand
import `in`.mypetnew.payment.domain.FakePaymentGateway
import `in`.mypetnew.payment.domain.InMemoryPaymentPersistence
import `in`.mypetnew.payment.domain.Payment
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.PaymentGateway
import `in`.mypetnew.payment.domain.PaymentPersistence
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentReferenceType
import `in`.mypetnew.payment.domain.PaymentRefund
import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.payment.domain.PaymentStatus
import `in`.mypetnew.payment.domain.PaymentWebhookEvent
import `in`.mypetnew.payment.domain.PreparePaymentResult
import `in`.mypetnew.payment.domain.ProviderCommandState
import `in`.mypetnew.payment.domain.ProviderCustomer
import `in`.mypetnew.payment.domain.ProviderPaymentSnapshot
import `in`.mypetnew.payment.domain.ProviderPaymentsResult
import `in`.mypetnew.payment.domain.RefundExecutionState
import `in`.mypetnew.payment.domain.RefundProviderResult
import `in`.mypetnew.payment.domain.RefundProviderSnapshot
import `in`.mypetnew.payment.domain.RefundStatus
import `in`.mypetnew.payment.domain.WebhookInboxItem
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class PaymentServiceLifecycleTest {
    private val now = Instant.parse("2026-08-15T12:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)

    @Test
    fun `different initiation keys converge on one payment and each key replays after cancellation`() {
        val fixture = onlineOrderFixture()
        val persistence = InMemoryPaymentPersistence(fixture.orders)
        val service = PaymentService(persistence, FakePaymentGateway(), clock)

        val first = service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "key-one")
        val second = service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "key-two")
        assertEquals(first.id, second.id)

        fixture.orders.transition(
            fixture.orderId,
            OrderStatus.CANCELLED,
            "cancel-after-initiation",
            actorId = fixture.customerId,
            actorRole = Role.CUSTOMER,
            reason = "Changed my mind",
            traceId = "test-cancel",
        )

        assertEquals(first.id, service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "key-one").id)
        assertEquals(first.id, service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "key-two").id)
    }

    @Test
    fun `ambiguous provider transport is stored as unknown and stays reconcilable`() {
        val fixture = onlineOrderFixture()
        val persistence = InMemoryPaymentPersistence(fixture.orders)
        val gateway = object : PaymentGateway by FakePaymentGateway() {
            override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult {
                throw IllegalStateException("socket reset")
            }
        }
        val service = PaymentService(persistence, gateway, clock)

        val payment = service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "transport-unknown")

        assertEquals(ProviderCommandState.UNKNOWN, payment.commandState)
        assertEquals(PaymentStatus.PENDING, payment.status)
        assertTrue(payment.reconciliationRequired)
        assertTrue(payment.providerOrderReference.startsWith("mp_"))
        assertEquals(payment.id.toString(), payment.providerIdempotencyKey)
    }

    @Test
    fun `rejected provider order is not misreported as captured`() {
        val fixture = onlineOrderFixture()
        val persistence = InMemoryPaymentPersistence(fixture.orders)
        val gateway = object : PaymentGateway by FakePaymentGateway() {
            override fun createOrder(command: CreateProviderOrderCommand) =
                CreateProviderOrderResult.Rejected("INVALID_REQUEST")
        }
        val payment = PaymentService(persistence, gateway, clock)
            .initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "provider-rejected")

        assertEquals(PaymentStatus.FAILED, payment.status)
        assertEquals(ProviderCommandState.REJECTED, payment.commandState)
        assertFalse(payment.reconciliationRequired)
    }

    @Test
    fun `payment request validation fails closed before unsupported runtime probing`() {
        val fixture = onlineOrderFixture()
        val service = PaymentService(InMemoryPaymentPersistence(fixture.orders), FakePaymentGateway(), clock)

        assertEquals("PAYMENT_REFERENCE_UNSUPPORTED", assertThrows(DomainException::class.java) {
            service.initiate(fixture.customerId, "APPOINTMENT", UUID.randomUUID(), "CASHFREE", "appointment")
        }.code)
        assertEquals("PAYMENT_PROVIDER_INVALID", assertThrows(DomainException::class.java) {
            service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "OTHER", "provider")
        }.code)
        assertEquals("IDEMPOTENCY_KEY_INVALID", assertThrows(DomainException::class.java) {
            service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "bad key with spaces")
        }.code)

        val disabledGateway = object : PaymentGateway by FakePaymentGateway() {
            override val available = false
        }
        assertEquals("PAYMENT_PROVIDER_UNAVAILABLE", assertThrows(DomainException::class.java) {
            PaymentService(InMemoryPaymentPersistence(fixture.orders), disabledGateway, clock)
                .initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "disabled")
        }.code)
    }

    @Test
    fun `webhook batch acknowledges successful application and retries failed business application`() {
        val payment = payment()
        val valid = webhook(payment, "delivery-success", "cf-success", PaymentAttemptOutcome.SUCCESS)
        val invalid = webhook(payment, "delivery-fail", "cf-fail", PaymentAttemptOutcome.FAILED)
        val persistence = RecordingPersistence(payment).apply {
            webhookClaims += WebhookInboxItem(UUID.randomUUID(), valid, 1)
            webhookClaims += WebhookInboxItem(UUID.randomUUID(), invalid, 2)
            failProviderPaymentIds += "cf-fail"
        }
        val service = PaymentService(persistence, RecordingGateway(), clock)

        assertEquals(2, service.processWebhookBatch())
        assertEquals(1, persistence.appliedPayments.size)
        assertEquals("cf-success", persistence.appliedPayments.single().providerPaymentId)
        assertEquals(1, persistence.processedWebhookIds.size)
        assertEquals(1, persistence.failedWebhookIds.size)
        assertEquals("PAYMENT_PROCESSING_FAILED", persistence.failedWebhookIds.single().second)
    }

    @Test
    fun `reconciliation applies provider attempts and reschedules unresolved payments`() {
        val first = payment(id = UUID.randomUUID(), providerOrderReference = "mp_first")
        val second = payment(id = UUID.randomUUID(), providerOrderReference = "mp_second")
        val persistence = RecordingPersistence(first).apply {
            reconciliationClaims += first
            reconciliationClaims += second
        }
        val gateway = RecordingGateway().apply {
            paymentResults["mp_first"] = ProviderPaymentsResult.Found(
                listOf(providerSnapshot(first, "cf-reconcile", PaymentAttemptOutcome.FAILED)),
            )
            paymentResults["mp_second"] = ProviderPaymentsResult.Unknown("STATUS_TIMEOUT")
        }
        val service = PaymentService(persistence, gateway, clock)

        assertEquals(2, service.reconcilePaymentBatch())
        assertEquals("cf-reconcile", persistence.appliedPayments.single().providerPaymentId)
        assertEquals(2, persistence.reconciliationSchedules.size)
        assertTrue(persistence.reconciliationSchedules.any { it.first == first.id })
        assertTrue(persistence.reconciliationSchedules.any { it.first == second.id && it.second == "STATUS_TIMEOUT" })
    }

    @Test
    fun `successful reconciliation capture stops further scheduling`() {
        val candidate = payment(providerOrderReference = "mp_capture")
        val persistence = RecordingPersistence(candidate).apply { reconciliationClaims += candidate }
        val gateway = RecordingGateway().apply {
            paymentResults[candidate.providerOrderReference] = ProviderPaymentsResult.Found(
                listOf(providerSnapshot(candidate, "cf-captured", PaymentAttemptOutcome.SUCCESS)),
            )
        }
        val service = PaymentService(persistence, gateway, clock)

        service.reconcilePaymentBatch()

        assertEquals(PaymentStatus.CAPTURED, persistence.current.status)
        assertTrue(persistence.reconciliationSchedules.isEmpty())
    }

    @Test
    fun `refund worker creates prepared refund and reconciles unknown refund before retry`() {
        val payment = payment(status = PaymentStatus.CAPTURED)
        val prepared = refund(payment, UUID.randomUUID(), RefundExecutionState.PREPARED)
        val unknown = refund(payment, UUID.randomUUID(), RefundExecutionState.UNKNOWN)
        val persistence = RecordingPersistence(payment).apply {
            refundClaims += prepared
            refundClaims += unknown
        }
        val gateway = RecordingGateway().apply {
            createRefundResults[prepared.providerRefundId] = RefundProviderResult.Found(
                RefundProviderSnapshot(prepared.providerRefundId, RefundStatus.SUCCESS, "SUCCESS", prepared.amountPaise, "INR"),
            )
            getRefundResults[unknown.providerRefundId] = RefundProviderResult.NotFound
            createRefundResults[unknown.providerRefundId] = RefundProviderResult.Unknown("REFUND_RETRY_UNKNOWN")
        }
        val service = PaymentService(persistence, gateway, clock)

        assertEquals(2, service.processRefundBatch())
        assertEquals(listOf(prepared.providerRefundId, unknown.providerRefundId), gateway.createdRefundIds)
        assertEquals(listOf(unknown.providerRefundId), gateway.lookedUpRefundIds)
        assertEquals(2, persistence.completedRefundResults.size)
        assertTrue(persistence.completedRefundResults.any { it.second is RefundProviderResult.Found })
        assertTrue(persistence.completedRefundResults.any { it.second is RefundProviderResult.Unknown })
    }

    @Test
    fun `webhook inbox duplicate is rejected and terminal attempt validates exact amount`() {
        val fixture = onlineOrderFixture()
        val persistence = InMemoryPaymentPersistence(fixture.orders)
        val service = PaymentService(persistence, FakePaymentGateway(), clock)
        val payment = service.initiate(fixture.customerId, "PRODUCT_ORDER", fixture.orderId, "CASHFREE", "webhook-init")
        val event = webhook(payment, "same-delivery", "cf-one", PaymentAttemptOutcome.SUCCESS)

        assertTrue(service.ingestWebhook(event))
        assertFalse(service.ingestWebhook(event))
        assertEquals(1, service.processWebhookBatch())
        assertEquals(PaymentStatus.CAPTURED, service.get(payment.id, fixture.customerId).status)

        val mismatch = providerSnapshot(payment, "cf-two", PaymentAttemptOutcome.SUCCESS).copy(paymentAmountPaise = payment.amountPaise - 1)
        assertEquals("PAYMENT_PROVIDER_AMOUNT_MISMATCH", assertThrows(DomainException::class.java) {
            persistence.applyProviderPayment(mismatch, "test:mismatch", now)
        }.code)
    }

    private fun onlineOrderFixture(): Fixture {
        val inventory = InventoryService()
        val orders = OrderService(inventory, clock = clock)
        val listing = UUID.randomUUID()
        val customer = UUID.randomUUID()
        val outlet = UUID.randomUUID()
        inventory.adjust(listing, 2, StockReason.RECEIPT, "payment-test-stock")
        val quote = QuoteService(clock).createPickupQuote(
            customer,
            outlet,
            mapOf(listing to Pair(1, 12_500L)),
            PaymentMethods.ONLINE_PAYMENT,
        )
        val order = orders.checkout(
            quote,
            UUID.randomUUID(),
            mapOf(listing to "Dog food"),
            "payment-test-checkout",
            customer,
            "payment-test-trace",
        )
        return Fixture(customer, order.id, orders)
    }

    private fun payment(
        id: UUID = UUID.randomUUID(),
        providerOrderReference: String = "mp_${UUID.randomUUID().toString().replace("-", "")}",
        status: PaymentStatus = PaymentStatus.PENDING,
    ) = Payment(
        id = id,
        referenceType = PaymentReferenceType.PRODUCT_ORDER,
        referenceId = UUID.randomUUID(),
        customerId = UUID.randomUUID(),
        provider = PaymentProvider.CASHFREE,
        status = status,
        amountPaise = 13_500,
        currency = "INR",
        providerOrderReference = providerOrderReference,
        providerSessionId = "session-$id",
        providerIdempotencyKey = id.toString(),
        commandState = ProviderCommandState.CREATED,
        expiresAt = now.plusSeconds(900),
        reconciliationRequired = true,
    )

    private fun providerSnapshot(payment: Payment, providerPaymentId: String, outcome: PaymentAttemptOutcome?) =
        ProviderPaymentSnapshot(
            providerOrderReference = payment.providerOrderReference,
            providerPaymentId = providerPaymentId,
            outcome = outcome,
            orderAmountPaise = payment.amountPaise,
            orderCurrency = payment.currency,
            paymentAmountPaise = payment.amountPaise,
            paymentCurrency = payment.currency,
            providerPaymentTime = now,
        )

    private fun webhook(
        payment: Payment,
        delivery: String,
        providerPaymentId: String,
        outcome: PaymentAttemptOutcome?,
    ) = PaymentWebhookEvent(
        provider = PaymentProvider.CASHFREE,
        deliveryIdentity = delivery,
        webhookVersion = "2026-01-01",
        eventType = "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderReference = payment.providerOrderReference,
        providerPaymentId = providerPaymentId,
        attemptOutcome = outcome,
        orderAmountPaise = payment.amountPaise,
        orderCurrency = payment.currency,
        paymentAmountPaise = payment.amountPaise,
        paymentCurrency = payment.currency,
        providerPaymentTime = now,
        providerEventTime = now,
        payloadSha256 = "a".repeat(64),
    )

    private fun refund(payment: Payment, id: UUID, state: RefundExecutionState) = PaymentRefund(
        id = id,
        paymentId = payment.id,
        providerOrderReference = payment.providerOrderReference,
        status = RefundStatus.PENDING,
        amountPaise = payment.amountPaise,
        currency = payment.currency,
        providerRefundId = "mpr_${id.toString().replace("-", "").take(32)}",
        providerIdempotencyKey = id.toString(),
        executionState = state,
        reconciliationRequired = true,
    )

    private data class Fixture(val customerId: UUID, val orderId: UUID, val orders: OrderService)

    private class RecordingGateway : PaymentGateway {
        override val available = true
        val paymentResults = mutableMapOf<String, ProviderPaymentsResult>()
        val createRefundResults = mutableMapOf<String, RefundProviderResult>()
        val getRefundResults = mutableMapOf<String, RefundProviderResult>()
        val createdRefundIds = mutableListOf<String>()
        val lookedUpRefundIds = mutableListOf<String>()

        override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult =
            CreateProviderOrderResult.Created("session-${command.paymentId}")

        override fun paymentsForOrder(providerOrderReference: String): ProviderPaymentsResult =
            paymentResults[providerOrderReference] ?: ProviderPaymentsResult.Found(emptyList())

        override fun createRefund(command: CreateRefundCommand): RefundProviderResult {
            createdRefundIds += command.providerRefundId
            return createRefundResults[command.providerRefundId] ?: RefundProviderResult.Unknown()
        }

        override fun getRefund(providerOrderReference: String, providerRefundId: String): RefundProviderResult {
            lookedUpRefundIds += providerRefundId
            return getRefundResults[providerRefundId] ?: RefundProviderResult.NotFound
        }
    }

    private class RecordingPersistence(initial: Payment) : PaymentPersistence {
        var current = initial
        val webhookClaims = mutableListOf<WebhookInboxItem>()
        val processedWebhookIds = mutableListOf<UUID>()
        val failedWebhookIds = mutableListOf<Pair<UUID, String>>()
        val failProviderPaymentIds = mutableSetOf<String>()
        val appliedPayments = mutableListOf<ProviderPaymentSnapshot>()
        val reconciliationClaims = mutableListOf<Payment>()
        val reconciliationSchedules = mutableListOf<Triple<UUID, String?, Instant>>()
        val refundClaims = mutableListOf<PaymentRefund>()
        val completedRefundResults = mutableListOf<Pair<UUID, RefundProviderResult>>()

        override fun prepare(
            customerId: UUID,
            referenceType: PaymentReferenceType,
            referenceId: UUID,
            provider: PaymentProvider,
            idempotencyKey: String,
            requestFingerprint: String,
            now: Instant,
        ) = PreparePaymentResult(current, false, ProviderCustomer("customer", "+919999999999"))

        override fun completeProviderOrder(paymentId: UUID, result: CreateProviderOrderResult, now: Instant) = current

        override fun getOwned(paymentId: UUID, customerId: UUID): Payment = current

        override fun saveWebhook(event: PaymentWebhookEvent, now: Instant) = true

        override fun claimWebhooks(limit: Int, now: Instant, lease: Duration): List<WebhookInboxItem> =
            webhookClaims.take(limit).also { webhookClaims.removeAll(it.toSet()) }

        override fun applyProviderPayment(snapshot: ProviderPaymentSnapshot, sourceIdentity: String, now: Instant): Payment {
            if (snapshot.providerPaymentId in failProviderPaymentIds) error("simulated processor failure")
            appliedPayments += snapshot
            if (snapshot.outcome == PaymentAttemptOutcome.SUCCESS) {
                current = current.copy(status = PaymentStatus.CAPTURED, reconciliationRequired = false)
            }
            return current
        }

        override fun markWebhookProcessed(inboxId: UUID, now: Instant) {
            processedWebhookIds += inboxId
        }

        override fun markWebhookFailed(inboxId: UUID, safeError: String, now: Instant) {
            failedWebhookIds += inboxId to safeError
        }

        override fun claimPaymentReconciliation(limit: Int, now: Instant, lease: Duration): List<Payment> =
            reconciliationClaims.take(limit).also { reconciliationClaims.removeAll(it.toSet()) }

        override fun schedulePaymentReconciliation(
            paymentId: UUID,
            safeErrorCode: String?,
            nextAttemptAt: Instant,
            now: Instant,
        ) {
            reconciliationSchedules += Triple(paymentId, safeErrorCode, nextAttemptAt)
        }

        override fun expiredOrderIds(limit: Int, now: Instant): List<UUID> = listOf(UUID.randomUUID()).take(limit)

        override fun claimRefunds(limit: Int, now: Instant, lease: Duration): List<PaymentRefund> =
            refundClaims.take(limit).also { refundClaims.removeAll(it.toSet()) }

        override fun completeRefund(refundId: UUID, result: RefundProviderResult, now: Instant): PaymentRefund {
            completedRefundResults += refundId to result
            return refundClaims.firstOrNull { it.id == refundId } ?: PaymentRefund(
                id = refundId,
                paymentId = current.id,
                providerOrderReference = current.providerOrderReference,
                status = RefundStatus.PENDING,
                amountPaise = current.amountPaise,
                currency = current.currency,
                providerRefundId = "mpr_${refundId.toString().replace("-", "").take(32)}",
                providerIdempotencyKey = refundId.toString(),
                executionState = RefundExecutionState.UNKNOWN,
                reconciliationRequired = true,
            )
        }
    }
}
