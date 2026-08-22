package `in`.mypetnew.payment

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.PaymentMethods
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.commerce.infrastructure.JdbcOrderPersistence
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.payment.domain.CreateProviderOrderCommand
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.CreateRefundCommand
import `in`.mypetnew.payment.domain.Payment
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.PaymentGateway
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentReferenceType
import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.payment.domain.PaymentStatus
import `in`.mypetnew.payment.domain.PaymentWebhookEvent
import `in`.mypetnew.payment.domain.ProviderCommandState
import `in`.mypetnew.payment.domain.ProviderPaymentSnapshot
import `in`.mypetnew.payment.domain.ProviderPaymentsResult
import `in`.mypetnew.payment.domain.RefundProviderResult
import `in`.mypetnew.payment.domain.RefundProviderSnapshot
import `in`.mypetnew.payment.domain.RefundStatus
import `in`.mypetnew.payment.domain.TerminalOrderPaymentProjection
import `in`.mypetnew.payment.infrastructure.JdbcPaymentPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class JdbcPaymentFailureRaceCertificationTest {
    private val baseNow = Instant.parse("2026-08-15T12:00:00Z")

    @Test
    fun `duplicate webhook deliveries with one provider payment apply business truth once`() {
        val fixture = fixture()
        val scenario = fixture.onlineOrder()
        val first = fixture.webhook(scenario.payment, "delivery-a", "cf-duplicate", PaymentAttemptOutcome.SUCCESS)
        val second = fixture.webhook(scenario.payment, "delivery-b", "cf-duplicate", PaymentAttemptOutcome.SUCCESS)

        assertTrue(fixture.payments.ingestWebhook(first))
        assertTrue(fixture.payments.ingestWebhook(second))
        assertEquals(2, fixture.payments.processWebhookBatch())

        assertEquals(PaymentStatus.CAPTURED, fixture.payments.get(scenario.payment.id, scenario.customerId).status)
        assertEquals("PAID", fixture.orders.get(scenario.orderId).paymentStatus)
        assertEquals(1, fixture.count("mypet.payment_attempt"))
        assertEquals(2, fixture.count("mypet.payment_webhook_inbox"))
        assertEquals(2, fixture.countWhere("mypet.payment_webhook_inbox", "processing_status = 'PROCESSED'"))
        assertEquals(1, fixture.countWhere("mypet.payment_history", "to_status = 'CAPTURED'"))
    }

    @Test
    fun `failed and user dropped attempts never finalize order and later success captures monotonically`() {
        val fixture = fixture()
        val scenario = fixture.onlineOrder()

        fixture.persistence.applyProviderPayment(
            fixture.snapshot(scenario.payment, "cf-failed", PaymentAttemptOutcome.FAILED),
            "test:failed",
            fixture.clock.instant(),
        )
        fixture.persistence.applyProviderPayment(
            fixture.snapshot(scenario.payment, "cf-dropped", PaymentAttemptOutcome.USER_DROPPED),
            "test:dropped",
            fixture.clock.instant(),
        )

        assertEquals(PaymentStatus.PENDING, fixture.payments.get(scenario.payment.id, scenario.customerId).status)
        assertEquals("PENDING_ONLINE_PAYMENT", fixture.orders.get(scenario.orderId).paymentStatus)

        fixture.persistence.applyProviderPayment(
            fixture.snapshot(scenario.payment, "cf-success", PaymentAttemptOutcome.SUCCESS),
            "test:success",
            fixture.clock.instant(),
        )
        fixture.persistence.applyProviderPayment(
            fixture.snapshot(scenario.payment, "cf-late-failed", PaymentAttemptOutcome.FAILED),
            "test:late-failed",
            fixture.clock.instant(),
        )

        assertEquals(PaymentStatus.CAPTURED, fixture.payments.get(scenario.payment.id, scenario.customerId).status)
        assertEquals("PAID", fixture.orders.get(scenario.orderId).paymentStatus)
        assertEquals(4, fixture.count("mypet.payment_attempt"))
        assertEquals(1, fixture.countWhere("mypet.payment_history", "to_status = 'CAPTURED'"))
    }

    @Test
    fun `same provider payment id cannot change terminal attempt outcome`() {
        val fixture = fixture()
        val scenario = fixture.onlineOrder()
        val failed = fixture.snapshot(scenario.payment, "cf-conflict", PaymentAttemptOutcome.FAILED)
        fixture.persistence.applyProviderPayment(failed, "test:failed", fixture.clock.instant())

        val error = assertThrows(DomainException::class.java) {
            fixture.persistence.applyProviderPayment(
                failed.copy(outcome = PaymentAttemptOutcome.SUCCESS),
                "test:conflicting-success",
                fixture.clock.instant(),
            )
        }

        assertEquals("PAYMENT_ATTEMPT_CONFLICT", error.code)
        assertEquals(PaymentStatus.PENDING, fixture.payments.get(scenario.payment.id, scenario.customerId).status)
        assertEquals(1, fixture.count("mypet.payment_attempt"))
    }

    @Test
    fun `merchant cannot accept before capture and can accept after canonical provider success`() {
        val fixture = fixture()
        val scenario = fixture.onlineOrder()

        val blocked = assertThrows(DomainException::class.java) {
            fixture.orders.transition(
                scenario.orderId,
                OrderStatus.ACCEPTED,
                "merchant-accept-before-paid",
                actorRole = Role.MERCHANT,
            )
        }
        assertEquals("ORDER_PAYMENT_REQUIRED", blocked.code)

        fixture.persistence.applyProviderPayment(
            fixture.snapshot(scenario.payment, "cf-merchant-gate", PaymentAttemptOutcome.SUCCESS),
            "test:merchant-gate",
            fixture.clock.instant(),
        )
        val accepted = fixture.orders.transition(
            scenario.orderId,
            OrderStatus.ACCEPTED,
            "merchant-accept-after-paid",
            actorRole = Role.MERCHANT,
        )

        assertEquals(OrderStatus.ACCEPTED, accepted.status)
        assertEquals("PAID", accepted.paymentStatus)
    }

    @Test
    fun `late capture after payment hold expiry cancels order releases stock once and creates one refund`() {
        val fixture = fixture(initialStock = 2)
        val scenario = fixture.onlineOrder()
        fixture.clock.current = baseNow.plusSeconds(16 * 60L)
        val success = fixture.snapshot(scenario.payment, "cf-late-capture", PaymentAttemptOutcome.SUCCESS)

        fixture.persistence.applyProviderPayment(success, "test:late-capture", fixture.clock.instant())
        fixture.persistence.applyProviderPayment(success, "test:late-capture-replay", fixture.clock.instant())

        val order = fixture.orders.get(scenario.orderId)
        assertEquals(OrderStatus.CANCELLED, order.status)
        assertEquals("REFUND_PENDING", order.paymentStatus)
        assertEquals(PaymentStatus.CAPTURED, fixture.payments.get(scenario.payment.id, scenario.customerId).status)
        assertEquals(2, fixture.inventory.available(scenario.listingId))
        assertEquals(0, fixture.inventory.reserved(scenario.listingId))
        assertEquals(1, fixture.count("mypet.payment_refund"))
        assertEquals(1, fixture.countWhere("mypet.inventory_movement", "reason = 'ORDER_RELEASE'"))
        assertEquals(1, fixture.countWhere("mypet.payment_history", "reason_code = 'LATE_PROVIDER_PAYMENT_SUCCESS'"))
    }

    @Test
    fun `customer cancellation before provider success expires payment and late success creates one refund`() {
        val fixture = fixture(initialStock = 2)
        val scenario = fixture.onlineOrder()

        fixture.orders.transition(
            scenario.orderId,
            OrderStatus.CANCELLED,
            "customer-cancel-before-capture",
            actorId = scenario.customerId,
            actorRole = Role.CUSTOMER,
            reason = "Changed my mind",
            traceId = "customer-cancel-before-capture",
        )
        assertEquals(PaymentStatus.EXPIRED, fixture.payments.get(scenario.payment.id, scenario.customerId).status)
        assertEquals(2, fixture.inventory.available(scenario.listingId))

        fixture.persistence.applyProviderPayment(
            fixture.snapshot(scenario.payment, "cf-after-cancel", PaymentAttemptOutcome.SUCCESS),
            "test:after-cancel",
            fixture.clock.instant(),
        )

        assertEquals(PaymentStatus.CAPTURED, fixture.payments.get(scenario.payment.id, scenario.customerId).status)
        assertEquals("REFUND_PENDING", fixture.orders.get(scenario.orderId).paymentStatus)
        assertEquals(1, fixture.count("mypet.payment_refund"))
        assertEquals(1, fixture.countWhere("mypet.inventory_movement", "reason = 'ORDER_RELEASE'"))
    }

    @Test
    fun `captured order cancellation creates deterministic refund and refund worker executes it once`() {
        val fixture = fixture(initialStock = 2)
        val scenario = fixture.onlineOrder()
        fixture.persistence.applyProviderPayment(
            fixture.snapshot(scenario.payment, "cf-before-refund", PaymentAttemptOutcome.SUCCESS),
            "test:before-refund",
            fixture.clock.instant(),
        )
        fixture.orders.transition(
            scenario.orderId,
            OrderStatus.CANCELLED,
            "cancel-paid-order",
            actorId = scenario.customerId,
            actorRole = Role.CUSTOMER,
            reason = "No longer required",
            traceId = "cancel-paid-order",
        )
        fixture.orders.transition(
            scenario.orderId,
            OrderStatus.CANCELLED,
            "cancel-paid-order",
            actorId = scenario.customerId,
            actorRole = Role.CUSTOMER,
            reason = "No longer required",
            traceId = "cancel-paid-order-replay",
        )

        assertEquals(1, fixture.count("mypet.payment_refund"))
        assertEquals("REFUND_PENDING", fixture.orders.get(scenario.orderId).paymentStatus)
        val refundWorker = PaymentService(fixture.persistence, fixture.gateway, Clock.systemUTC())
        assertEquals(1, refundWorker.processRefundBatch())
        assertEquals(0, refundWorker.processRefundBatch())

        assertEquals(1, fixture.gateway.createRefundCalls)
        assertEquals(1, fixture.count("mypet.payment_refund"))
        assertEquals(1, fixture.countWhere("mypet.payment_refund", "status = 'SUCCESS'"))
        assertEquals("REFUNDED", fixture.orders.get(scenario.orderId).paymentStatus)
    }

    @Test
    fun `reconciliation after process restart captures provider success when webhook was lost`() {
        val fixture = fixture()
        val scenario = fixture.onlineOrder()
        fixture.clock.current = baseNow.plusSeconds(31)
        fixture.gateway.paymentResults[scenario.payment.providerOrderReference] = ProviderPaymentsResult.Found(
            listOf(fixture.snapshot(scenario.payment, "cf-reconcile-after-restart", PaymentAttemptOutcome.SUCCESS)),
        )
        val restartedPersistence = JdbcPaymentPersistence(fixture.jdbc, fixture.transactions, fixture.inventory)
        val restarted = PaymentService(restartedPersistence, fixture.gateway, fixture.clock)

        assertEquals(1, restarted.reconcilePaymentBatch())

        assertEquals(PaymentStatus.CAPTURED, restarted.get(scenario.payment.id, scenario.customerId).status)
        assertEquals("PAID", fixture.orders.get(scenario.orderId).paymentStatus)
        assertEquals(1, fixture.count("mypet.payment_attempt"))
        assertEquals(0, fixture.count("mypet.payment_webhook_inbox"))
    }

    @Test
    fun `concurrent initiation keys converge on one canonical payment`() {
        val fixture = fixture()
        val pending = fixture.onlineOrder(initiate = false)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val ids = executor.invokeAll(
                listOf(
                    Callable {
                        fixture.payments.initiate(
                            pending.customerId,
                            "PRODUCT_ORDER",
                            pending.orderId,
                            "CASHFREE",
                            "concurrent-payment-a",
                        ).id
                    },
                    Callable {
                        fixture.payments.initiate(
                            pending.customerId,
                            "PRODUCT_ORDER",
                            pending.orderId,
                            "CASHFREE",
                            "concurrent-payment-b",
                        ).id
                    },
                ),
            ).map { it.get() }

            assertEquals(1, ids.toSet().size)
            assertEquals(1, fixture.count("mypet.payment"))
            assertEquals(2, fixture.count("mypet.payment_initiation_command"))
            assertTrue(fixture.gateway.createOrderCalls in 1..2)
        } finally {
            executor.shutdownNow()
        }
    }

    private fun fixture(initialStock: Int = 3): Fixture {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.merchant_organization(id, name, status) VALUES (?, 'P5 payment race organization', 'ACTIVE')",
            organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'P5 payment race outlet', 'ACTIVE', TRUE)",
            outletId,
            organizationId,
        )

        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
        val clock = MutableClock(baseNow)
        val paymentPersistence = JdbcPaymentPersistence(jdbc, transactions, inventory)
        val terminalProjection = TerminalOrderPaymentProjection { orderId, reason, now ->
            paymentPersistence.projectTerminalOrder(orderId, reason, now)
        }
        val orders = OrderService(
            inventory,
            JdbcOrderPersistence(jdbc, transactions, terminalProjection),
            clock,
        )
        val gateway = RecordingGateway()
        val payments = PaymentService(paymentPersistence, gateway, clock)
        return Fixture(
            jdbc = jdbc,
            transactions = transactions,
            inventory = inventory,
            orders = orders,
            persistence = paymentPersistence,
            payments = payments,
            gateway = gateway,
            clock = clock,
            organizationId = organizationId,
            outletId = outletId,
            initialStock = initialStock,
        )
    }

    private data class Scenario(
        val customerId: UUID,
        val listingId: UUID,
        val orderId: UUID,
        val payment: Payment,
    )

    private data class Fixture(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val inventory: InventoryService,
        val orders: OrderService,
        val persistence: JdbcPaymentPersistence,
        val payments: PaymentService,
        val gateway: RecordingGateway,
        val clock: MutableClock,
        val organizationId: UUID,
        val outletId: UUID,
        val initialStock: Int,
    ) {
        fun onlineOrder(initiate: Boolean = true): Scenario {
            val listingId = UUID.randomUUID()
            val customerId = UUID.randomUUID()
            jdbc.update(
                """
                INSERT INTO mypet.catalog_listing(
                    id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                    listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
                ) VALUES (?, ?, ?, 'INTERNAL', ?, 'P5 payment race product', 'PRODUCT', 'COMMERCE', 15000, 12500, TRUE)
                """.trimIndent(),
                listingId,
                organizationId,
                outletId,
                "P5-${listingId.toString().replace("-", "")}",
            )
            jdbc.update(
                "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'CUSTOMER', 'ACTIVE')",
                customerId,
                "+919${customerId.toString().replace("-", "").take(9)}",
            )
            inventory.adjust(
                listingId,
                initialStock,
                StockReason.RECEIPT,
                "receive-${UUID.randomUUID()}",
                customerId,
                "p5-race-stock",
            )
            val quote = QuoteService(clock).createPickupQuote(
                customerId,
                outletId,
                mapOf(listingId to Pair(1, 12_500L)),
                PaymentMethods.ONLINE_PAYMENT,
            )
            val order = orders.checkout(
                quote,
                organizationId,
                mapOf(listingId to "Dog food"),
                "checkout-${UUID.randomUUID()}",
                customerId,
                "p5-race-checkout",
            )
            val payment = if (initiate) {
                payments.initiate(
                    customerId,
                    "PRODUCT_ORDER",
                    order.id,
                    PaymentProvider.CASHFREE.name,
                    "payment-${UUID.randomUUID()}",
                )
            } else {
                Payment(
                    id = UUID(0L, 0L),
                    referenceType = PaymentReferenceType.PRODUCT_ORDER,
                    referenceId = order.id,
                    customerId = customerId,
                    provider = PaymentProvider.CASHFREE,
                    status = PaymentStatus.PENDING,
                    amountPaise = order.grandTotalPaise,
                    currency = "INR",
                    providerOrderReference = "not-created",
                    providerSessionId = null,
                    providerIdempotencyKey = "not-created",
                    commandState = ProviderCommandState.PREPARED,
                    expiresAt = requireNotNull(order.paymentHoldExpiresAt),
                )
            }
            return Scenario(customerId, listingId, order.id, payment)
        }

        fun snapshot(payment: Payment, providerPaymentId: String, outcome: PaymentAttemptOutcome) = ProviderPaymentSnapshot(
            providerOrderReference = payment.providerOrderReference,
            providerPaymentId = providerPaymentId,
            outcome = outcome,
            orderAmountPaise = payment.amountPaise,
            orderCurrency = payment.currency,
            paymentAmountPaise = payment.amountPaise,
            paymentCurrency = payment.currency,
            providerPaymentTime = clock.instant(),
        )

        fun webhook(
            payment: Payment,
            deliveryIdentity: String,
            providerPaymentId: String,
            outcome: PaymentAttemptOutcome,
        ) = PaymentWebhookEvent(
            provider = PaymentProvider.CASHFREE,
            deliveryIdentity = deliveryIdentity,
            webhookVersion = "2026-01-01",
            eventType = when (outcome) {
                PaymentAttemptOutcome.SUCCESS -> "PAYMENT_SUCCESS_WEBHOOK"
                PaymentAttemptOutcome.FAILED -> "PAYMENT_FAILED_WEBHOOK"
                PaymentAttemptOutcome.USER_DROPPED -> "PAYMENT_USER_DROPPED_WEBHOOK"
            },
            providerOrderReference = payment.providerOrderReference,
            providerPaymentId = providerPaymentId,
            attemptOutcome = outcome,
            orderAmountPaise = payment.amountPaise,
            orderCurrency = payment.currency,
            paymentAmountPaise = payment.amountPaise,
            paymentCurrency = payment.currency,
            providerPaymentTime = clock.instant(),
            providerEventTime = clock.instant(),
            payloadSha256 = "b".repeat(64),
        )

        fun count(table: String): Int = jdbc.queryForObject("SELECT COUNT(*) FROM $table", Int::class.java) ?: 0

        fun countWhere(table: String, predicate: String): Int =
            jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE $predicate", Int::class.java) ?: 0
    }

    private class RecordingGateway : PaymentGateway {
        override val available: Boolean = true
        var createOrderCalls: Int = 0
        var createRefundCalls: Int = 0
        val paymentResults = mutableMapOf<String, ProviderPaymentsResult>()

        override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult {
            createOrderCalls += 1
            return CreateProviderOrderResult.Created("session-${command.paymentId}")
        }

        override fun paymentsForOrder(providerOrderReference: String): ProviderPaymentsResult =
            paymentResults[providerOrderReference] ?: ProviderPaymentsResult.Found(emptyList())

        override fun createRefund(command: CreateRefundCommand): RefundProviderResult {
            createRefundCalls += 1
            return RefundProviderResult.Found(
                RefundProviderSnapshot(
                    providerRefundId = command.providerRefundId,
                    status = RefundStatus.SUCCESS,
                    providerStatus = "SUCCESS",
                    amountPaise = command.amountPaise,
                    currency = command.currency,
                ),
            )
        }

        override fun getRefund(providerOrderReference: String, providerRefundId: String): RefundProviderResult =
            RefundProviderResult.NotFound
    }

    private class MutableClock(var current: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC

        override fun withZone(zone: ZoneId): Clock = this

        override fun instant(): Instant = current
    }
}
