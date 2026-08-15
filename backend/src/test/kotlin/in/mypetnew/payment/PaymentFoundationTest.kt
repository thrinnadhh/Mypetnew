package `in`.mypetnew.payment

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.PaymentMethods
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.FakePaymentGateway
import `in`.mypetnew.payment.domain.InMemoryPaymentPersistence
import `in`.mypetnew.payment.domain.PaymentService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class PaymentFoundationTest {
    private val now = Instant.parse("2026-08-15T10:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)

    @Test
    fun `missing payment method defaults and normalized method changes quote fingerprint`() {
        val quotes = QuoteService(clock)
        val customer = UUID.randomUUID()
        val outlet = UUID.randomUUID()
        val lines = mapOf(UUID.randomUUID() to Pair(1, 12_500L))

        val legacy = quotes.createPickupQuote(customer, outlet, lines)
        val online = quotes.createPickupQuote(customer, outlet, lines, "online_payment")

        assertEquals(PaymentMethods.PAY_ON_FULFILMENT, legacy.paymentMethod)
        assertEquals(PaymentMethods.ONLINE_PAYMENT, online.paymentMethod)
        assertNotEquals(legacy.cartSignature, online.cartSignature)
        assertThrows(DomainException::class.java) {
            quotes.createPickupQuote(customer, outlet, lines, "CARD")
        }
    }

    @Test
    fun `online checkout sets server hold while pay on fulfilment stays unchanged`() {
        val fixture = fixture()
        val legacy = fixture.checkout(PaymentMethods.PAY_ON_FULFILMENT, "legacy")
        val online = fixture.checkout(PaymentMethods.ONLINE_PAYMENT, "online")

        assertEquals("PENDING_EXTERNAL_COLLECTION", legacy.paymentStatus)
        assertNull(legacy.paymentHoldExpiresAt)
        assertEquals("PENDING_ONLINE_PAYMENT", online.paymentStatus)
        assertEquals(now.plus(Duration.ofMinutes(15)), online.paymentHoldExpiresAt)
    }

    @Test
    fun `unpaid online order cannot be accepted`() {
        val fixture = fixture()
        val online = fixture.checkout(PaymentMethods.ONLINE_PAYMENT, "guard")

        val error = assertThrows(DomainException::class.java) {
            fixture.orders.transition(online.id, OrderStatus.ACCEPTED, "accept", actorRole = Role.MERCHANT)
        }

        assertEquals("ORDER_PAYMENT_REQUIRED", error.code)
    }

    @Test
    fun `payment initiation derives amount and is idempotent`() {
        val fixture = fixture()
        val order = fixture.checkout(PaymentMethods.ONLINE_PAYMENT, "pay")
        val payments = PaymentService(InMemoryPaymentPersistence(fixture.orders), FakePaymentGateway(), clock)

        val first = payments.initiate(order.customerId, "PRODUCT_ORDER", order.id, "CASHFREE", "pay-1")
        val replay = payments.initiate(order.customerId, "PRODUCT_ORDER", order.id, "CASHFREE", "pay-1")

        assertEquals(first.id, replay.id)
        assertEquals(order.grandTotalPaise, first.amountPaise)
        assertEquals("INR", first.currency)
        assertNotNull(first.providerSessionId)
    }

    @Test
    fun `foreign and nonexistent order expose same error and appointment fails before probing`() {
        val fixture = fixture()
        val order = fixture.checkout(PaymentMethods.ONLINE_PAYMENT, "owned")
        val payments = PaymentService(InMemoryPaymentPersistence(fixture.orders), FakePaymentGateway(), clock)

        val foreign = assertThrows(DomainException::class.java) {
            payments.initiate(UUID.randomUUID(), "PRODUCT_ORDER", order.id, "CASHFREE", "foreign")
        }
        val missing = assertThrows(DomainException::class.java) {
            payments.initiate(order.customerId, "PRODUCT_ORDER", UUID.randomUUID(), "CASHFREE", "missing")
        }
        val appointment = assertThrows(DomainException::class.java) {
            payments.initiate(order.customerId, "APPOINTMENT", UUID.randomUUID(), "CASHFREE", "appointment")
        }

        assertEquals("RESOURCE_NOT_FOUND", foreign.code)
        assertEquals(foreign.code, missing.code)
        assertEquals("PAYMENT_REFERENCE_UNSUPPORTED", appointment.code)
    }

    private fun fixture(): Fixture {
        val inventory = InventoryService()
        return Fixture(inventory, OrderService(inventory, clock = clock))
    }

    private inner class Fixture(
        private val inventory: InventoryService,
        val orders: OrderService,
    ) {
        fun checkout(method: String, key: String): ProductOrder {
            val listing = UUID.randomUUID()
            val customer = UUID.randomUUID()
            val outlet = UUID.randomUUID()
            inventory.adjust(listing, 1, StockReason.RECEIPT, "stock-$key")
            val quote = QuoteService(clock).createPickupQuote(
                customer,
                outlet,
                mapOf(listing to Pair(1, 12_500L)),
                method,
            )
            return orders.checkout(
                quote,
                UUID.randomUUID(),
                mapOf(listing to "Dog food"),
                "checkout-$key",
                customer,
                "trace-$key",
            )
        }
    }
}
