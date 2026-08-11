package `in`.mypetnew.commerce

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.CartAddResult
import `in`.mypetnew.commerce.domain.CartService
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class CommerceInventoryContractTest {
    @Test
    fun `cart never silently crosses outlet boundary`() {
        val cart = CartService()
        val customer = UUID.randomUUID()
        val outletA = UUID.randomUUID()
        val outletB = UUID.randomUUID()

        cart.add(customer, outletA, UUID.randomUUID(), 1)
        val result = cart.add(customer, outletB, UUID.randomUUID(), 1)

        assertInstanceOf(CartAddResult.OutletConflict::class.java, result)
        assertEquals(outletA, cart.get(customer).outletId)
    }

    @Test
    fun `last unit has exactly one concurrent reservation winner`() {
        val inventory = InventoryService()
        val listingId = UUID.randomUUID()
        inventory.adjust(listingId, 1, StockReason.RECEIPT, "receive-1")
        val executor = Executors.newFixedThreadPool(12)

        val results = executor.invokeAll((1..50).map { attempt ->
            Callable {
                runCatching { inventory.reserve(listingId, 1, "order-$attempt") }.isSuccess
            }
        }).map { it.get() }
        executor.shutdown()

        assertEquals(1, results.count { it })
        assertEquals(0, inventory.available(listingId))
        assertEquals(1, inventory.reserved(listingId))
    }

    @Test
    fun `pickup quote uses exact paise fees and expires`() {
        val clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)
        val quotes = QuoteService(clock)
        val quote = quotes.createPickupQuote(
            customerId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
            lines = mapOf(UUID.randomUUID() to Pair(2, 12_500L)),
        )

        assertEquals(25_000, quote.pricing.itemSubtotalPaise)
        assertEquals(1_000, quote.pricing.platformFeePaise)
        assertEquals(1_000, quote.pricing.merchantCommissionPaise)
        assertEquals(26_000, quote.pricing.grandTotalPaise)
        assertThrows(DomainException::class.java) {
            quotes.requireValid(quote.id, quote.cartSignature, Instant.parse("2026-08-11T12:06:00Z"))
        }
    }

    @Test
    fun `checkout and fulfilment are idempotent and legal only`() {
        val inventory = InventoryService()
        val listingId = UUID.randomUUID()
        inventory.adjust(listingId, 2, StockReason.RECEIPT, "receive")
        val orders = OrderService(inventory)
        val customerId = UUID.randomUUID()
        val outletId = UUID.randomUUID()

        val first = orders.checkout(customerId, outletId, mapOf(listingId to 1), 13_500, "checkout-1")
        val replay = orders.checkout(customerId, outletId, mapOf(listingId to 1), 13_500, "checkout-1")
        assertEquals(first.id, replay.id)

        assertThrows(DomainException::class.java) {
            orders.transition(first.id, OrderStatus.READY_FOR_PICKUP, "transition-illegal")
        }
        orders.transition(first.id, OrderStatus.ACCEPTED, "transition-1")
        orders.transition(first.id, OrderStatus.PREPARING, "transition-2")
        orders.transition(first.id, OrderStatus.READY_FOR_PICKUP, "transition-3")
        orders.transition(first.id, OrderStatus.DELIVERED, "transition-4")
        val transitionReplay = orders.transition(first.id, OrderStatus.DELIVERED, "transition-4")

        assertEquals(OrderStatus.DELIVERED, transitionReplay.status)
        assertEquals(5, transitionReplay.history.size)
    }
}

