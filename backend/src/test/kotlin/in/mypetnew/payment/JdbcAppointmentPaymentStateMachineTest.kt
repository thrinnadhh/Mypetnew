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
import org.springframework.dao.CannotAcquireLockException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors

class JdbcAppointmentPaymentStateMachineTest {
    private val baseNow = Instant.parse("2026-08-19T06:00:00Z")

    @Test
    fun `initiation is server priced customer owned and idempotent`() {
        val f = fixture()
        val appointmentA = f.appointment(f.customerA, 79_900)
        val appointmentB = f.appointment(f.customerA, 10_000)

        val first = f.service.initiate(f.customerA, appointmentA, "CASHFREE", "command-a")
        val replay = f.service.initiate(f.customerA, appointmentA, "CASHFREE", "command-a")
        val secondKey = f.service.initiate(f.customerA, appointmentA, "CASHFREE", "command-b")

        assertEquals(first.id, replay.id)
        assertEquals(first.id, secondKey.id)
        assertEquals(79_900, first.amountPaise)
        assertEquals("INR", first.currency)
        assertTrue(first.providerOrderReference.startsWith("ma_"))
        assertEquals(1, f.count("mypet.payment"))
        assertEquals(2, f.count("mypet.payment_initiation_command"))

        val conflict = assertThrows(DomainException::class.java) {
            f.service.initiate(f.customerA, appointmentB, "CASHFREE", "command-a")
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", conflict.code)

        val foreign = assertThrows(DomainException::class.java) {
            f.service.initiate(f.customerB, appointmentA, "CASHFREE", "foreign-command")
        }
        assertEquals("RESOURCE_NOT_FOUND", foreign.code)
        assertNull(f.service.getOwnedOrNull(first.id, f.customerB))
        assertEquals(first.id, f.service.getOwnedOrNull(first.id, f.customerA)?.id)
    }

    @Test
    fun `verified webhook persists against released inbox shape and capture only books pending provider`() {
        val f = fixture()
        val appointmentId = f.appointment(f.customerA, 54_500)
        val payment = f.service.initiate(f.customerA, appointmentId, "CASHFREE", "capture-command")
        val event = f.successWebhook(payment.providerOrderReference, payment.amountPaise, "capture-delivery")
            .copy(eventType = "PAYMENT_SUCCESS_" + "X".repeat(100))

        assertTrue(f.service.ingestWebhook(event))
        assertEquals(false, f.service.ingestWebhook(event))

        assertEquals("BOOKED", f.appointmentColumn(appointmentId, "status"))
        assertEquals("PAID", f.appointmentColumn(appointmentId, "payment_state"))
        assertEquals(PaymentStatus.CAPTURED, f.service.getOwnedOrNull(payment.id, f.customerA)?.status)
        assertEquals(1, f.countWhere("mypet.appointment_history", "status = 'BOOKED'"))
        assertEquals(0, f.countWhere("mypet.appointment_history", "status = 'CONFIRMED'"))
        assertEquals(1, f.count("mypet.payment_attempt"))
        assertEquals(1, f.countWhere("mypet.payment_webhook_inbox", "processing_status = 'PROCESSED' AND processed_at IS NOT NULL"))
        assertEquals(80, f.jdbc.queryForObject("SELECT LENGTH(event_type) FROM mypet.payment_webhook_inbox", Int::class.java))
    }

    @Test
    fun `independent initiation instances converge on one durable provider identity after transient lock retry`() {
        val f = fixture()
        val appointmentId = f.appointment(f.customerA, 31_000)
        val other = JdbcAppointmentOnlinePaymentService(f.jdbc, f.transactions, f.gateway, f.clock)
        val barrier = CyclicBarrier(2)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val outcomes = executor.invokeAll(listOf(
                Callable {
                    barrier.await()
                    try {
                        RaceOutcome(f.service.initiate(f.customerA, appointmentId, "CASHFREE", "race-a").id)
                    } catch (_: CannotAcquireLockException) {
                        RaceOutcome(null)
                    }
                },
                Callable {
                    barrier.await()
                    try {
                        RaceOutcome(other.initiate(f.customerA, appointmentId, "CASHFREE", "race-b").id)
                    } catch (_: CannotAcquireLockException) {
                        RaceOutcome(null)
                    }
                },
            )).map { it.get() }

            val resolved = outcomes.mapIndexed { index, outcome ->
                outcome.paymentId ?: when (index) {
                    0 -> f.service.initiate(f.customerA, appointmentId, "CASHFREE", "race-a").id
                    else -> other.initiate(f.customerA, appointmentId, "CASHFREE", "race-b").id
                }
            }

            assertTrue(outcomes.any { it.paymentId != null })
            assertEquals(1, resolved.toSet().size)
            assertEquals(1, f.count("mypet.payment"))
            assertEquals(2, f.count("mypet.payment_initiation_command"))
            assertEquals(1, f.gateway.orders.map { it.providerOrderReference }.toSet().size)
            assertEquals(1, f.gateway.orders.map { it.providerIdempotencyKey }.toSet().size)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `capture versus expiry race never resurrects hold and refund remains idempotent`() {
        val f = fixture()
        val appointmentId = f.appointment(f.customerA, 28_000, baseNow.plusSeconds(30))
        val payment = f.service.initiate(f.customerA, appointmentId, "CASHFREE", "capture-expiry")
        f.clock.current = baseNow.plusSeconds(60)
        val other = JdbcAppointmentOnlinePaymentService(f.jdbc, f.transactions, f.gateway, f.clock)
        val event = f.successWebhook(payment.providerOrderReference, payment.amountPaise, "capture-expiry-delivery")
        val barrier = CyclicBarrier(2)
        val executor = Executors.newFixedThreadPool(2)

        try {
            executor.invokeAll(listOf(
                Callable {
                    barrier.await()
                    f.service.expirePendingBatch()
                },
                Callable {
                    barrier.await()
                    if (other.ingestWebhook(event)) 1 else 0
                },
            )).forEach { it.get() }
        } finally {
            executor.shutdownNow()
        }

        assertEquals(PaymentStatus.CAPTURED, f.service.getOwnedOrNull(payment.id, f.customerA)?.status)
        assertEquals("HOLD_EXPIRED", f.appointmentColumn(appointmentId, "status"))
        assertEquals("REFUND_PENDING", f.appointmentColumn(appointmentId, "payment_state"))
        assertEquals(1, f.count("mypet.appointment_payment_refund"))
        assertEquals(0, f.countWhere("mypet.appointment_history", "status = 'BOOKED'"))

        assertEquals("REFUND_PENDING", f.service.projectTerminalAppointment(appointmentId, "LATE_CAPTURE", f.clock.instant()))
        assertEquals(1, f.count("mypet.appointment_payment_refund"))
        assertEquals(1, f.service.processRefundBatch())
        assertEquals("REFUNDED", f.appointmentColumn(appointmentId, "payment_state"))
        assertEquals(1, f.countWhere("mypet.appointment_payment_refund", "status = 'SUCCESS'"))
    }

    private fun fixture(): Fixture {
        val ds = DriverManagerDataSource(
            "jdbc:h2:mem:p13_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
            "sa",
            "",
        )
        val jdbc = JdbcTemplate(ds)
        jdbc.execute("CREATE SCHEMA mypet")
        schema(jdbc)
        val tx = TransactionTemplate(DataSourceTransactionManager(ds))
        val clock = MutableClock(baseNow)
        val gateway = RecordingGateway()
        val customerA = UUID.randomUUID()
        val customerB = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.identity_account(id,mobile_e164,status) VALUES (?,?,'ACTIVE')", customerA, "+919900000001")
        jdbc.update("INSERT INTO mypet.identity_account(id,mobile_e164,status) VALUES (?,?,'ACTIVE')", customerB, "+919900000002")
        return Fixture(jdbc, tx, clock, gateway, JdbcAppointmentOnlinePaymentService(jdbc, tx, gateway, clock), customerA, customerB)
    }

    private fun schema(j: JdbcTemplate) {
        j.execute("CREATE TABLE mypet.identity_account(id UUID PRIMARY KEY,mobile_e164 VARCHAR(20) NOT NULL,status VARCHAR(24) NOT NULL)")
        j.execute("""CREATE TABLE mypet.appointment(
            id UUID PRIMARY KEY,customer_id UUID NOT NULL,status VARCHAR(32) NOT NULL,payment_mode VARCHAR(32) NOT NULL,
            payment_state VARCHAR(32) NOT NULL,price_paise BIGINT NOT NULL,currency VARCHAR(3) NOT NULL,
            hold_expires_at TIMESTAMP WITH TIME ZONE,updated_at TIMESTAMP WITH TIME ZONE NOT NULL)""")
        j.execute("""CREATE TABLE mypet.payment(
            id UUID PRIMARY KEY,reference_type VARCHAR(32) NOT NULL,reference_id UUID NOT NULL,customer_id UUID NOT NULL,
            provider VARCHAR(24) NOT NULL,status VARCHAR(24) NOT NULL,amount_paise BIGINT NOT NULL,currency VARCHAR(3) NOT NULL,
            provider_order_reference VARCHAR(45) NOT NULL,provider_session_id VARCHAR(512),provider_idempotency_key VARCHAR(64) NOT NULL,
            provider_command_state VARCHAR(24) NOT NULL,expires_at TIMESTAMP WITH TIME ZONE NOT NULL,reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
            next_reconciliation_at TIMESTAMP WITH TIME ZONE,version BIGINT NOT NULL DEFAULT 0,created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL,UNIQUE(reference_type,reference_id,provider),UNIQUE(provider,provider_order_reference),
            UNIQUE(provider,provider_idempotency_key))""")
        j.execute("""CREATE TABLE mypet.payment_initiation_command(
            customer_id UUID NOT NULL,idempotency_key VARCHAR(128) NOT NULL,request_fingerprint VARCHAR(64) NOT NULL,
            payment_id UUID NOT NULL,created_at TIMESTAMP WITH TIME ZONE NOT NULL,PRIMARY KEY(customer_id,idempotency_key))""")
        j.execute("""CREATE TABLE mypet.payment_history(
            id UUID PRIMARY KEY,payment_id UUID NOT NULL,from_status VARCHAR(24),to_status VARCHAR(24) NOT NULL,
            reason_code VARCHAR(64) NOT NULL,source_identity VARCHAR(160) NOT NULL,occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
            UNIQUE(payment_id,source_identity))""")
        j.execute("""CREATE TABLE mypet.payment_attempt(
            id UUID PRIMARY KEY,payment_id UUID NOT NULL,provider VARCHAR(24) NOT NULL,provider_payment_id VARCHAR(96) NOT NULL,
            outcome VARCHAR(24) NOT NULL,payment_amount_paise BIGINT NOT NULL,payment_currency VARCHAR(3) NOT NULL,
            provider_payment_time TIMESTAMP WITH TIME ZONE,safe_error_code VARCHAR(64),safe_error_reason VARCHAR(240),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,updated_at TIMESTAMP WITH TIME ZONE NOT NULL,UNIQUE(provider,provider_payment_id))""")
        // Deliberately mirrors released V16. There is no next_attempt_at or created_at here.
        j.execute("""CREATE TABLE mypet.payment_webhook_inbox(
            id UUID PRIMARY KEY,provider VARCHAR(24) NOT NULL,delivery_identity VARCHAR(160) NOT NULL,webhook_version VARCHAR(24) NOT NULL,
            event_type VARCHAR(80) NOT NULL,provider_order_reference VARCHAR(45) NOT NULL,provider_payment_id VARCHAR(96),attempt_status VARCHAR(24),
            order_amount_paise BIGINT NOT NULL,order_currency VARCHAR(3) NOT NULL,payment_amount_paise BIGINT,payment_currency VARCHAR(3),
            provider_payment_time TIMESTAMP WITH TIME ZONE,provider_event_time TIMESTAMP WITH TIME ZONE,payload_sha256 VARCHAR(64) NOT NULL,
            safe_error_code VARCHAR(64),safe_error_reason VARCHAR(240),processing_status VARCHAR(24) NOT NULL,retry_count INTEGER NOT NULL DEFAULT 0,
            last_safe_error VARCHAR(240),received_at TIMESTAMP WITH TIME ZONE NOT NULL,claim_started_at TIMESTAMP WITH TIME ZONE,
            lease_expires_at TIMESTAMP WITH TIME ZONE,processed_at TIMESTAMP WITH TIME ZONE,updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
            UNIQUE(provider,delivery_identity))""")
        j.execute("""CREATE TABLE mypet.appointment_payment_refund(
            id UUID PRIMARY KEY,payment_id UUID NOT NULL UNIQUE,appointment_id UUID NOT NULL,status VARCHAR(16) NOT NULL,
            amount_paise BIGINT NOT NULL,currency VARCHAR(3) NOT NULL,provider_refund_id VARCHAR(64) NOT NULL UNIQUE,
            provider_idempotency_key VARCHAR(64) NOT NULL UNIQUE,execution_state VARCHAR(16) NOT NULL,next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,safe_error_code VARCHAR(64),created_at TIMESTAMP WITH TIME ZONE NOT NULL,updated_at TIMESTAMP WITH TIME ZONE NOT NULL)""")
        j.execute("""CREATE TABLE mypet.appointment_history(
            id UUID PRIMARY KEY,appointment_id UUID NOT NULL,status VARCHAR(32) NOT NULL,actor_id UUID NOT NULL,note VARCHAR(500),
            occurred_at TIMESTAMP WITH TIME ZONE NOT NULL)""")
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
        fun appointment(customer: UUID, price: Long, expires: Instant = clock.instant().plusSeconds(600)): UUID {
            val id = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO mypet.appointment(id,customer_id,status,payment_mode,payment_state,price_paise,currency,hold_expires_at,updated_at) VALUES (?,?,'HOLD','ONLINE_PAYMENT','PENDING',?,'INR',?,?)",
                id, customer, price, Timestamp.from(expires), Timestamp.from(clock.instant()),
            )
            return id
        }

        fun successWebhook(orderRef: String, amount: Long, delivery: String) = PaymentWebhookEvent(
            provider = PaymentProvider.CASHFREE,
            deliveryIdentity = delivery,
            webhookVersion = "2025-01-01",
            eventType = "PAYMENT_SUCCESS_WEBHOOK",
            providerOrderReference = orderRef,
            providerPaymentId = "cf_${UUID.randomUUID().toString().replace("-", "")}",
            attemptOutcome = PaymentAttemptOutcome.SUCCESS,
            orderAmountPaise = amount,
            orderCurrency = "INR",
            paymentAmountPaise = amount,
            paymentCurrency = "INR",
            providerPaymentTime = clock.instant(),
            providerEventTime = clock.instant(),
            payloadSha256 = "a".repeat(64),
        )

        fun appointmentColumn(id: UUID, column: String): String =
            requireNotNull(jdbc.queryForObject("SELECT $column FROM mypet.appointment WHERE id = ?", String::class.java, id))
        fun count(table: String) = jdbc.queryForObject("SELECT COUNT(*) FROM $table", Int::class.java) ?: 0
        fun countWhere(table: String, predicate: String) = jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE $predicate", Int::class.java) ?: 0
    }

    private class RecordingGateway : PaymentGateway {
        override val available = true
        val orders = CopyOnWriteArrayList<CreateProviderOrderCommand>()
        override fun createOrder(command: CreateProviderOrderCommand): CreateProviderOrderResult {
            orders += command
            return CreateProviderOrderResult.Created("session_${command.providerOrderReference}")
        }
        override fun paymentsForOrder(providerOrderReference: String) = ProviderPaymentsResult.Unknown("NOT_NEEDED")
        override fun createRefund(command: CreateRefundCommand): RefundProviderResult = RefundProviderResult.Found(
            RefundProviderSnapshot(command.providerRefundId, RefundStatus.SUCCESS, "SUCCESS", command.amountPaise, command.currency),
        )
        override fun getRefund(providerOrderReference: String, providerRefundId: String): RefundProviderResult = RefundProviderResult.NotFound
    }

    private data class RaceOutcome(val paymentId: UUID?)

    private class MutableClock(var current: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = current
    }
}
