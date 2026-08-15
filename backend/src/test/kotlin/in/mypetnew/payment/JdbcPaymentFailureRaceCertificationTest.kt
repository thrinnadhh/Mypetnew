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
import `in`.mypetnew.payment.domain.CreateProviderOrderCommand
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.CreateRefundCommand
import `in`.mypetnew.payment.domain.Payment
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.PaymentGateway
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentService
import `in`.mypetnew.payment.domain.PaymentStatus
import `in`.mypetnew.payment.domain.PaymentWebhookEvent
import `in`.mypetnew.payment.domain.ProviderPaymentSnapshot
import `in`.mypetnew.payment.domain.ProviderPaymentsResult
import `in`.mypetnew.payment.domain.RefundProviderResult
import `in`.mypetnew.payment.domain.RefundProviderSnapshot
import `in`.mypetnew.payment.domain.RefundStatus
import `in`.mypetnew.payment.domain.TerminalOrderPaymentProjection
import `in`.mypetnew.payment.infrastructure.JdbcPaymentPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
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
        val databaseName = "p5_race_${UUID.randomUUID().toString().replace("-", "")}"
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:$databaseName;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
            "sa",
            "",
        )
        val jdbc = JdbcTemplate(dataSource)
        jdbc.execute("CREATE SCHEMA mypet")
        createSchema(jdbc)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
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
            organizationId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
            initialStock = initialStock,
        )
    }

    private fun createSchema(jdbc: JdbcTemplate) {
        jdbc.execute(
            """
            CREATE TABLE mypet.identity_account (
                id UUID PRIMARY KEY,
                mobile_e164 VARCHAR(20) NOT NULL,
                status VARCHAR(24) NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.catalog_listing (
                id UUID PRIMARY KEY,
                outlet_id UUID NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_balance (
                listing_id UUID PRIMARY KEY,
                on_hand INTEGER NOT NULL DEFAULT 0,
                reserved INTEGER NOT NULL DEFAULT 0,
                version BIGINT NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (on_hand >= 0),
                CHECK (reserved >= 0),
                CHECK (on_hand >= reserved)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_movement (
                id UUID PRIMARY KEY,
                listing_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                reason VARCHAR(40) NOT NULL,
                quantity_delta INTEGER NOT NULL,
                resulting_on_hand INTEGER NOT NULL,
                resulting_reserved INTEGER NOT NULL,
                source_type VARCHAR(40) NOT NULL,
                source_reference VARCHAR(160) NOT NULL,
                actor_id UUID NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                operation_scope VARCHAR(40) NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_inventory_movement_idempotency UNIQUE (outlet_id, idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order (
                id UUID PRIMARY KEY,
                order_number VARCHAR(32) NOT NULL UNIQUE,
                customer_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                quote_id UUID NOT NULL,
                status VARCHAR(32) NOT NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                payment_method VARCHAR(40) NOT NULL,
                payment_status VARCHAR(40) NOT NULL,
                grand_total_paise BIGINT NOT NULL,
                platform_fee_paise BIGINT NOT NULL,
                merchant_commission_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL DEFAULT 'INR',
                payment_hold_expires_at TIMESTAMP WITH TIME ZONE,
                version BIGINT NOT NULL DEFAULT 0,
                checkout_idempotency_key VARCHAR(128),
                checkout_request_fingerprint VARCHAR(64),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_order_checkout UNIQUE (customer_id, checkout_idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order_line (
                order_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                listing_name VARCHAR(160) NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price_paise BIGINT NOT NULL,
                PRIMARY KEY (order_id, listing_id)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order_history (
                id UUID PRIMARY KEY,
                order_id UUID NOT NULL,
                from_status VARCHAR(32),
                to_status VARCHAR(32) NOT NULL,
                actor_id UUID NOT NULL,
                actor_role VARCHAR(32) NOT NULL,
                reason VARCHAR(240),
                idempotency_key VARCHAR(128) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_order_history_command UNIQUE (order_id, idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_reservation (
                id UUID PRIMARY KEY,
                order_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                quantity INTEGER NOT NULL,
                status VARCHAR(24) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_order_listing_reservation UNIQUE (order_id, listing_id)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.payment (
                id UUID PRIMARY KEY,
                reference_type VARCHAR(32) NOT NULL,
                reference_id UUID NOT NULL,
                customer_id UUID NOT NULL,
                provider VARCHAR(24) NOT NULL,
                status VARCHAR(24) NOT NULL,
                amount_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL,
                provider_order_reference VARCHAR(45) NOT NULL,
                provider_session_id VARCHAR(512),
                provider_idempotency_key VARCHAR(64) NOT NULL,
                provider_command_state VARCHAR(24) NOT NULL,
                last_provider_error_code VARCHAR(64),
                reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
                next_reconciliation_at TIMESTAMP WITH TIME ZONE,
                reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
                captured_at TIMESTAMP WITH TIME ZONE,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                version BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_payment_reference_provider UNIQUE (reference_type, reference_id, provider),
                CONSTRAINT uq_payment_provider_order UNIQUE (provider, provider_order_reference),
                CONSTRAINT uq_payment_provider_idempotency UNIQUE (provider, provider_idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.payment_initiation_command (
                customer_id UUID NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL,
                payment_id UUID NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (customer_id, idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.payment_history (
                id UUID PRIMARY KEY,
                payment_id UUID NOT NULL,
                from_status VARCHAR(24),
                to_status VARCHAR(24) NOT NULL,
                reason_code VARCHAR(64) NOT NULL,
                source_identity VARCHAR(160) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_payment_history_source UNIQUE (payment_id, source_identity)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.payment_attempt (
                id UUID PRIMARY KEY,
                payment_id UUID NOT NULL,
                provider VARCHAR(24) NOT NULL,
                provider_payment_id VARCHAR(96) NOT NULL,
                outcome VARCHAR(24) NOT NULL,
                payment_amount_paise BIGINT NOT NULL,
                payment_currency VARCHAR(3) NOT NULL,
                provider_payment_time TIMESTAMP WITH TIME ZONE,
                safe_error_code VARCHAR(64),
                safe_error_reason VARCHAR(240),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_payment_attempt_provider_id UNIQUE (provider, provider_payment_id)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.payment_webhook_inbox (
                id UUID PRIMARY KEY,
                provider VARCHAR(24) NOT NULL,
                delivery_identity VARCHAR(160) NOT NULL,
                webhook_version VARCHAR(24) NOT NULL,
                event_type VARCHAR(80) NOT NULL,
                provider_order_reference VARCHAR(45) NOT NULL,
                provider_payment_id VARCHAR(96),
                attempt_status VARCHAR(24),
                order_amount_paise BIGINT NOT NULL,
                order_currency VARCHAR(3) NOT NULL,
                payment_amount_paise BIGINT,
                payment_currency VARCHAR(3),
                provider_payment_time TIMESTAMP WITH TIME ZONE,
                provider_event_time TIMESTAMP WITH TIME ZONE,
                payload_sha256 VARCHAR(64) NOT NULL,
                safe_error_code VARCHAR(64),
                safe_error_reason VARCHAR(240),
                processing_status VARCHAR(24) NOT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_safe_error VARCHAR(240),
                received_at TIMESTAMP WITH TIME ZONE NOT NULL,
                claim_started_at TIMESTAMP WITH TIME ZONE,
                lease_expires_at TIMESTAMP WITH TIME ZONE,
                processed_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_payment_webhook_delivery UNIQUE (provider, delivery_identity)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.payment_refund (
                id UUID PRIMARY KEY,
                payment_id UUID NOT NULL,
                status VARCHAR(24) NOT NULL,
                amount_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL,
                provider_refund_id VARCHAR(40) NOT NULL,
                provider_idempotency_key VARCHAR(64) NOT NULL,
                execution_state VARCHAR(24) NOT NULL,
                reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
                next_reconciliation_at TIMESTAMP WITH TIME ZONE,
                reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
                claim_started_at TIMESTAMP WITH TIME ZONE,
                lease_expires_at TIMESTAMP WITH TIME ZONE,
                last_provider_status VARCHAR(24),
                last_safe_error_code VARCHAR(64),
                version BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP WITH TIME ZONE,
                CONSTRAINT uq_payment_refund_payment UNIQUE (payment_id),
                CONSTRAINT uq_payment_refund_provider_id UNIQUE (provider_refund_id),
                CONSTRAINT uq_payment_refund_provider_idempotency UNIQUE (provider_idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.payment_refund_history (
                id UUID PRIMARY KEY,
                refund_id UUID NOT NULL,
                from_status VARCHAR(24),
                to_status VARCHAR(24) NOT NULL,
                reason_code VARCHAR(64) NOT NULL,
                source_identity VARCHAR(160) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_refund_history_source UNIQUE (refund_id, source_identity)
            )
            """.trimIndent(),
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
            jdbc.update("INSERT INTO mypet.catalog_listing (id, outlet_id) VALUES (?, ?)", listingId, outletId)
            jdbc.update(
                "INSERT INTO mypet.identity_account (id, mobile_e164, status) VALUES (?, ?, 'ACTIVE')",
                customerId,
                "+919876543210",
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
                    referenceType = `in`.mypetnew.payment.domain.PaymentReferenceType.PRODUCT_ORDER,
                    referenceId = order.id,
                    customerId = customerId,
                    provider = PaymentProvider.CASHFREE,
                    status = PaymentStatus.PENDING,
                    amountPaise = order.grandTotalPaise,
                    currency = "INR",
                    providerOrderReference = "not-created",
                    providerSessionId = null,
                    providerIdempotencyKey = "not-created",
                    commandState = `in`.mypetnew.payment.domain.ProviderCommandState.PREPARED,
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
