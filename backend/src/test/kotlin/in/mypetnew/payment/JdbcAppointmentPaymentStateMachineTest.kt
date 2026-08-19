package `in`.mypetnew.payment

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.CreateProviderOrderCommand
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.CreateRefundCommand
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.PaymentGateway
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentStatus
import `in`.mypetnew.payment.domain.PaymentWebhookEvent
import `in`.mypetnew.payment.domain.ProviderPaymentsResult
import `in`.mypetnew.payment.domain.RefundProviderResult
import `in`.mypetnew.payment.domain.RefundProviderSnapshot
import `in`.mypetnew.payment.domain.RefundStatus
import `in`.mypetnew.payment.infrastructure.JdbcAppointmentOnlinePaymentService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

class JdbcAppointmentPaymentStateMachineTest {
    private val baseNow = Instant.parse("2026-08-19T06:00:00Z")

    @Test
    fun `appointment initiation is server priced customer owned and command idempotent`() {
        val fixture = fixture()
        val appointmentA = fixture.appointment(fixture.customerA, pricePaise = 79_900)
        val appointmentB = fixture.appointment(fixture.customerA, pricePaise = 10_000)

        val first = fixture.service.initiate(
            fixture.customerA,
            appointmentA,
            "CASHFREE",
            "appointment-command-a",
        )
        val replay = fixture.service.initiate(
            fixture.customerA,
            appointmentA,
            "CASHFREE",
            "appointment-command-a",
        )
        val secondKey = fixture.service.initiate(
            fixture.customerA,
            appointmentA,
            "CASHFREE",
            "appointment-command-b",
        )

        assertEquals(first.id, replay.id)
        assertEquals(first.id, secondKey.id)
        assertEquals(79_900, first.amountPaise)
        assertEquals("INR", first.currency)
        assertTrue(first.providerOrderReference.startsWith("ma_"))
        assertEquals(1, fixture.count("mypet.payment"))
        assertEquals(2, fixture.count("mypet.payment_initiation_command"))

        val changedReference = assertThrows(DomainException::class.java) {
            fixture.service.initiate(
                fixture.customerA,
                appointmentB,
                "CASHFREE",
                "appointment-command-a",
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", changedReference.code)

        val foreign = assertThrows(DomainException::class.java) {
            fixture.service.initiate(
                fixture.customerB,
                appointmentA,
                "CASHFREE",
                "foreign-appointment-payment",
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", foreign.code)
        assertNull(fixture.service.getOwnedOrNull(first.id, fixture.customerB))
        assertEquals(first.id, fixture.service.getOwnedOrNull(first.id, fixture.customerA)?.id)
    }

    @Test
    fun `verified appointment webhook uses released inbox schema and capture only books pending provider`() {
        val fixture = fixture()
        val appointmentId = fixture.appointment(fixture.customerA, pricePaise = 54_500)
        val payment = fixture.service.initiate(
            fixture.customerA,
            appointmentId,
            "CASHFREE",
            "capture-command",
        )
        val event = fixture.successWebhook(payment.providerOrderReference, payment.amountPaise, "capture-delivery")
            .copy(eventType = "PAYMENT_SUCCESS_" + "X".repeat(100))

        assertTrue(fixture.service.ingestWebhook(event))
        assertEquals(false, fixture.service.ingestWebhook(event))

        assertEquals("BOOKED", fixture.appointmentColumn(appointmentId, "status"))
        assertEquals("PAID", fixture.appointmentColumn(appointmentId, "payment_state"))
        assertEquals(PaymentStatus.CAPTURED, fixture.service.getOwnedOrNull(payment.id, fixture.customerA)?.status)
        assertEquals(1, fixture.countWhere("mypet.appointment_history", "status = 'BOOKED'"))
        assertEquals(0, fixture.countWhere("mypet.appointment_history", "status = 'CONFIRMED'"))
        assertEquals(1, fixture.count("mypet.payment_attempt"))
        assertEquals(1, fixture.count("mypet.payment_webhook_inbox"))
        assertEquals(1, fixture.countWhere("mypet.payment_webhook_inbox", "processing_status = 'PROCESSED' AND processed_at IS NOT NULL"))
        assertEquals(
            80,
            fixture.jdbc.queryForObject(
                "SELECT LENGTH(event_type) FROM mypet.payment_webhook_inbox WHERE delivery_identity = ?",
                Int::class.java,
                "capture-delivery",
            ),
        )
    }

    @Test
    fun `late capture after expiry never resurrects hold and creates one refund`() {
        val fixture = fixture()
        val appointmentId = fixture.appointment(
            fixture.customerA,
            pricePaise = 42_000,
            holdExpiresAt = baseNow.plusSeconds(60),
        )
        val payment = fixture.service.initiate(
            fixture.customerA,
            appointmentId,
            "CASHFREE",
            "late-capture-command",
        )

        fixture.clock.current = baseNow.plusSeconds(120)
        assertEquals(1, fixture.service.expirePendingBatch())
        assertEquals("HOLD_EXPIRED", fixture.appointmentColumn(appointmentId, "status"))
        assertEquals("EXPIRED", fixture.appointmentColumn(appointmentId, "payment_state"))

        val late = fixture.successWebhook(payment.providerOrderReference, payment.amountPaise, "late-capture-delivery")
        assertTrue(fixture.service.ingestWebhook(late))
        assertTrue(fixture.service.ingestWebhook(late.copy(deliveryIdentity = "late-capture-replay")))

        assertEquals("HOLD_EXPIRED", fixture.appointmentColumn(appointmentId, "status"))
        assertEquals("REFUND_PENDING", fixture.appointmentColumn(appointmentId, "payment_state"))
        assertEquals(PaymentStatus.CAPTURED, fixture.service.getOwnedOrNull(payment.id, fixture.customerA)?.status)
        assertEquals(1, fixture.count("mypet.appointment_payment_refund"))
        assertEquals(0, fixture.countWhere("mypet.appointment_history", "status = 'BOOKED'"))
    }

    @Test
    fun `concurrent independent initiation instances converge on one provider obligation`() {
        val fixture = fixture()
        val appointmentId = fixture.appointment(fixture.customerA, pricePaise = 31_000)
        val secondService = JdbcAppointmentOnlinePaymentService(
            fixture.jdbc,
            fixture.transactions,
            fixture.gateway,
            fixture.clock,
        )
        val executor = Executors.newFixedThreadPool(2)
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)

        try {
            val results = executor.invokeAll(
                listOf(
                    Callable {
                        ready.countDown()
                        start.await()
                        fixture.service.initiate(fixture.customerA, appointmentId, "CASHFREE", "race-command-a")
                    },
                    Callable {
                        ready.countDown()
                        start.await()
                        secondService.initiate(fixture.customerA, appointmentId, "CASHFREE", "race-command-b")
                    },
                ),
            )
            ready.await()
            start.countDown()
            val payments = results.map { it.get() }

            assertEquals(1, payments.map { it.id }.toSet().size)
            assertEquals(1, fixture.count("mypet.payment"))
            assertEquals(2, fixture.count("mypet.payment_initiation_command"))
            assertEquals(1, fixture.gateway.createOrderCommands.map { it.providerOrderReference }.toSet().size)
            assertEquals(1, fixture.gateway.createOrderCommands.map { it.providerIdempotencyKey }.toSet().size)
        } finally {
            start.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `capture versus expiry race converges on captured refund without slot resurrection`() {
        val fixture = fixture()
        val appointmentId = fixture.appointment(
            fixture.customerA,
            pricePaise = 28_000,
            holdExpiresAt = baseNow.plusSeconds(30),
        )
        val payment = fixture.service.initiate(
            fixture.customerA,
            appointmentId,
            "CASHFREE",
            "capture-expiry-race",
        )
        fixture.clock.current = baseNow.plusSeconds(60)
        val secondService = JdbcAppointmentOnlinePaymentService(
            fixture.jdbc,
            fixture.transactions,
            fixture.gateway,
            fixture.clock,
        )
        val event = fixture.successWebhook(payment.providerOrderReference, payment.amountPaise, "capture-expiry-race-delivery")
        val executor = Executors.newFixedThreadPool(2)
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)

        try {
            val tasks = executor.invokeAll(
                listOf(
                    Callable {
                        ready.countDown()
                        start.await()
                        fixture.service.expirePendingBatch()
                    },
                    Callable {
                        ready.countDown()
                        start.await()
                        if (secondService.ingestWebhook(event)) 1 else 0
                    },
                ),
            )
            ready.await()
            start.countDown()
            tasks.forEach { it.get() }
        } finally {
            start.countDown()
            executor.shutdownNow()
        }

        assertEquals(PaymentStatus.CAPTURED, fixture.service.getOwnedOrNull(payment.id, fixture.customerA)?.status)
        assertEquals("HOLD_EXPIRED", fixture.appointmentColumn(appointmentId, "status"))
        assertEquals("REFUND_PENDING", fixture.appointmentColumn(appointmentId, "payment_state"))
        assertEquals(1, fixture.count("mypet.appointment_payment_refund"))
        assertEquals(0, fixture.countWhere("mypet.appointment_history", "status = 'BOOKED'"))
    }

    @Test
    fun `captured rejection projection is idempotent and refund truth comes from provider result`() {
        val fixture = fixture()
        val appointmentId = fixture.appointment(fixture.customerA, pricePaise = 19_900)
        val payment = fixture.service.initiate(
            fixture.customerA,
            appointmentId,
            "CASHFREE",
            "rejection-refund-command",
        )
        assertTrue(
            fixture.service.ingestWebhook(
                fixture.successWebhook(payment.providerOrderReference, payment.amountPaise, "rejection-capture"),
            ),
        )
        fixture.jdbc.update(
            "UPDATE mypet.appointment SET status = 'REJECTED', updated_at = ? WHERE id = ?",
            java.sql.Timestamp.from(fixture.clock.instant()),
            appointmentId,
        )

        assertEquals("REFUND_PENDING", fixture.service.projectTerminalAppointment(appointmentId, "MERCHANT_REJECTED", fixture.clock.instant()))
        assertEquals("REFUND_PENDING", fixture.service.projectTerminalAppointment(appointmentId, "MERCHANT_REJECTED", fixture.clock.instant()))
        assertEquals(1, fixture.count("mypet.appointment_payment_refund"))
        assertEquals("REFUND_PENDING", fixture.appointmentColumn(appointmentId, "payment_state"))

        assertEquals(1, fixture.service.processRefundBatch())
        assertEquals("REFUNDED", fixture.appointmentColumn(appointmentId, "payment_state"))
        assertEquals(1, fixture.countWhere("mypet.appointment_payment_refund", "status = 'SUCCESS'"))
    }

    private fun fixture(): Fixture {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:p13_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
            "sa",
            "",
        )
        val jdbc = JdbcTemplate(dataSource)
        jdbc.execute("CREATE SCHEMA mypet")
        createSchema(jdbc)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val clock = MutableClock(baseNow)
        val gateway = RecordingGateway()
        val customerA = UUID.randomUUID()
        val customerB = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, status) VALUES (?, ?, 'ACTIVE')", customerA, "+919900000001")
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, status) VALUES (?, ?, 'ACTIVE')", customerB, "+919900000002")
        return Fixture(
            jdbc,
            transactions,
            clock,
            gateway,
            JdbcAppointmentOnlinePaymentService(jdbc, transactions, gateway, clock),
            customerA,
            customerB,
        )
    }

    private fun createSchema(jdbc: JdbcTemplate) {
        jdbc.execute("""
            CREATE TABLE mypet.identity_account (
                id UUID PRIMARY KEY,
                mobile_e164 VARCHAR(20) NOT NULL,
                status VARCHAR(24) NOT NULL
            )
        """.trimIndent())
        jdbc.execute("""
            CREATE TABLE mypet.appointment (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                status VARCHAR(32) NOT NULL,
                payment_mode VARCHAR(32) NOT NULL,
                payment_state VARCHAR(32) NOT NULL,
                price_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL,
                hold_expires_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
        """.trimIndent())
        jdbc.execute("""
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
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
                next_reconciliation_at TIMESTAMP WITH TIME ZONE,
                version BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_p13_payment_reference UNIQUE(reference_type, reference_id, provider),
                CONSTRAINT uq_p13_provider_order UNIQUE(provider, provider_order_reference),
                CONSTRAINT uq_p13_provider_idempotency UNIQUE(provider, provider_idempotency_key)
            )
        """.trimIndent())
        jdbc.execute("""
            CREATE TABLE mypet.payment_initiation_command (
                customer_id UUID NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL,
                payment_id UUID NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                PRIMARY KEY(customer_id, idempotency_key)
            )
        """.trimIndent())
        jdbc.execute("""
            CREATE TABLE mypet.payment_history (
                id UUID PRIMARY KEY,
                payment_id UUID NOT NULL,
                from_status VARCHAR(24),
                to_status VARCHAR(24) NOT NULL,
                reason_code VARCHAR(64) NOT NULL,
                source_identity VARCHAR(160) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_p13_payment_history UNIQUE(payment_id, source_identity)
            )
        """.trimIndent())
        jdbc.execute("""
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
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_p13_payment_attempt UNIQUE(provider, provider_payment_id)
            )
        """.trimIndent())
        // Match the released V16 inbox shape exactly for the columns used by the
        // appointment adapter. The regression fails if the adapter invents
        // next_attempt_at/created_at instead of supplying received_at.
        jdbc.execute("""
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
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_p13_webhook_delivery UNIQUE(provider, delivery_identity)
            )
        """.trimIndent())
        jdbc.execute("""
            CREATE TABLE mypet.appointment_payment_refund (
                id UUID PRIMARY KEY,
                payment_id UUID NOT NULL UNIQUE,
                appointment_id UUID NOT NULL,
                status VARCHAR(16) NOT NULL,
                amount_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL,
                provider_refund_id VARCHAR(64) NOT NULL UNIQUE,
                provider_idempotency_key VARCHAR(64) NOT NULL UNIQUE,
                execution_state VARCHAR(16) NOT NULL,
                next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                safe_error_code VARCHAR(64),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
        """.trimIndent())
        jdbc.execute("""
            CREATE TABLE mypet.appointment_history (
                id UUID PRIMARY KEY,
                appointment_id UUID NOT NULL,
                status VARCHAR(32) NOT NULL,
                actor_id UUID NOT NULL,
                note VARCHAR(500),
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
        """.trimIndent())
    }

    private data class Fixture(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val clock: MutableClock,
        val gateway: RecordingGateway,
        val service: JdbcAppointmentOnlinePaymentService,
        val customerA: UUID,
        val customerB: UUID,
    ) {
        fun appointment(
            customerId: UUID,
            pricePaise: Long,
            holdExpiresAt: Instant = clock.instant().plusSeconds(600),
        ): UUID {
            val id = UUID.randomUUID()
            jdbc.update(
                """
                INSERT INTO mypet.appointment(
                    id, customer_id, status, payment_mode, payment_state,
                    price_paise, currency, hold_expires_at, updated_at
                ) VALUES (?, ?, 'HOLD', 'ONLINE_PAYMENT', 'PENDING', ?, 'INR', ?, ?)
                """.trimIndent(),
                id,
                customerId,
                pricePaise,
                java.sql.Timestamp.from(holdExpiresAt),
                java.sql.Timestamp.from(clock.instant()),
            )
            return id
        }

        fun successWebhook(providerOrderReference: String, amountPaise: Long, delivery: String) = PaymentWebhookEvent(
            provider = PaymentProvider.CASHFREE,
            deliveryIdentity = delivery,
            webhookVersion = "2025-01-01",
            eventType = "PAYMENT_SUCCESS_WEBHOOK",
            providerOrderReference = providerOrderReference,
            providerPaymentId = "cf_${UUID.randomUUID().toString().replace("-", "")}",
            attemptOutcome = PaymentAttemptOutcome.SUCCESS,
            orderAmountPaise = amountPaise,
            orderCurrency = "INR",
            paymentAmountPaise = amountPaise,
            paymentCurrency = "INR",
            providerPaymentTime = clock.instant(),
            providerEventTime = clock.instant(),
            payloadSha256 = "a".repeat(64),
        )

        fun appointmentColumn(appointmentId: UUID, column: String): String =
            jdbc.queryForObject("SELECT $column FROM mypet.appointment WHERE id = ?", String::class.java, appointmentId)
                ?: error("Missing appointment column $column")

        fun count(table: String): Int = jdbc.queryForObject("SELECT COUNT(*) FROM $table", Int::class.java) ?: 0
        fun countWhere(table: String, predicate: String): Int =
            jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE $predicate", Int::class.java) ?: 0
    }

    private class RecordingGateway : PaymentGateway {
        override val available = true
        val createOrderCommands = CopyOnWriteArrayList<CreateProviderOrderCommand>()

        override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult {
            createOrderCommands += command
            return CreateProviderOrderResult.Created("session_${command.providerOrderReference}")
        }

        override fun paymentsForOrder(providerOrderReference: String): ProviderPaymentsResult =
            ProviderPaymentsResult.Unknown("NOT_NEEDED")

        override fun createRefund(command: CreateRefundCommand): RefundProviderResult = RefundProviderResult.Found(
            RefundProviderSnapshot(
                providerRefundId = command.providerRefundId,
                status = RefundStatus.SUCCESS,
                providerStatus = "SUCCESS",
                amountPaise = command.amountPaise,
                currency = command.currency,
            ),
        )

        override fun getRefund(providerOrderReference: String, providerRefundId: String): RefundProviderResult =
            RefundProviderResult.NotFound
    }

    private class MutableClock(var current: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = current
    }
}
