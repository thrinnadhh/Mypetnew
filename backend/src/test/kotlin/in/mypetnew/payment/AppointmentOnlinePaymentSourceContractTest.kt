package `in`.mypetnew.payment

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path

/**
 * Architectural regression guard for the appointment payment vertical slice.
 * Runtime gateway/payment behavior remains covered by CashfreePaymentContractTest;
 * these assertions prevent the appointment adapter from collapsing provider
 * acceptance into payment capture or routing appointment refunds through the
 * product-order refund worker.
 */
class AppointmentOnlinePaymentSourceContractTest {
    private fun source(relativePath: String): String = Files.readString(Path.of(relativePath))

    @Test
    fun `cashfree capture submits paid appointment to provider but never confirms it`() {
        val service = source("src/main/kotlin/in/mypetnew/payment/infrastructure/JdbcAppointmentOnlinePaymentService.kt")

        assertTrue(service.contains("payment_state = 'PAID'"))
        assertTrue(service.contains("status = 'BOOKED'"))
        assertTrue(service.contains("ONLINE_PAYMENT_CAPTURED_PENDING_PROVIDER"))
        assertFalse(service.contains("status = 'CONFIRMED', payment_state = 'PAID'"))
        assertFalse(service.contains("ONLINE_PAYMENT_CAPTURED_CONFIRMED"))
    }

    @Test
    fun `appointment cashfree namespace and refund table stay isolated from product payments`() {
        val service = source("src/main/kotlin/in/mypetnew/payment/infrastructure/JdbcAppointmentOnlinePaymentService.kt")
        val webhook = source("src/main/kotlin/in/mypetnew/application/web/PaymentWebhookController.kt")
        val workers = source("src/main/kotlin/in/mypetnew/payment/infrastructure/PaymentLifecycleWorkers.kt")
        val migration = source("src/main/resources/db/migration/V18__appointment_online_payment.sql")

        assertTrue(service.contains("APPOINTMENT_PROVIDER_PREFIX = \"ma_\""))
        assertTrue(service.contains("appointment_payment_refund"))
        assertTrue(webhook.contains("isAppointmentProviderOrder"))
        assertTrue(workers.contains("appointmentPayments.processRefundBatch()"))
        assertTrue(workers.contains("appointmentPayments.reconcileTerminalRefunds()"))
        assertTrue(migration.contains("CREATE TABLE mypet.appointment_payment_refund"))
        assertFalse(migration.contains("ALTER TABLE mypet.payment_refund"))
    }

    @Test
    fun `terminal and late captured appointment payments enter refund workflow`() {
        val service = source("src/main/kotlin/in/mypetnew/payment/infrastructure/JdbcAppointmentOnlinePaymentService.kt")
        val persistence = source("src/main/kotlin/in/mypetnew/appointment/infrastructure/OnlineAwareJdbcAppointmentPersistence.kt")

        assertTrue(service.contains("payment_state = 'REFUND_PENDING'"))
        assertTrue(service.contains("LATE_PAYMENT_REFUND_PENDING"))
        assertTrue(service.contains("projectTerminalAppointment"))
        assertTrue(service.contains("payment_state = 'REFUNDED'"))
        assertTrue(service.contains("payment_state = 'REFUND_FAILED'"))
        assertTrue(persistence.contains("TerminalAppointmentPaymentProjection"))
        assertTrue(persistence.contains("AppointmentStatus.REJECTED"))
        assertTrue(persistence.contains("AppointmentStatus.CANCELLED"))
    }

    @Test
    fun `customer payment API never accepts client authored amount or identity`() {
        val controller = source("src/main/kotlin/in/mypetnew/application/web/CustomerPaymentApiController.kt")

        assertTrue(controller.contains("setOf(\"referenceType\", \"referenceId\", \"provider\")"))
        assertTrue(controller.contains("request.referenceType == \"APPOINTMENT\""))
        assertFalse(controller.contains("amountPaise: Long"))
        assertFalse(controller.contains("customerId: UUID"))
    }
}
