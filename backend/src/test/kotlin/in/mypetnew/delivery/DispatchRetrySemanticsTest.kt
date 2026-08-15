package `in`.mypetnew.delivery

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.DeliveryAddressSnapshot
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.delivery.domain.DispatchStatus
import `in`.mypetnew.delivery.domain.InMemoryCaptainGeoIndex
import `in`.mypetnew.delivery.domain.InMemoryDispatchPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class DispatchRetrySemanticsTest {
    @Test
    fun `accepted offer can be replayed after a lost HTTP response`() {
        val fixture = fixture()
        val captainId = UUID.randomUUID()
        fixture.dispatch.approveCaptain(captainId)
        fixture.dispatch.updateAvailability(captainId, true, 13.6288, 79.4192)
        fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        val offer = fixture.dispatch.pendingOffers(captainId).single()

        val first = fixture.dispatch.respondToOffer(captainId, offer.id, true)
        val replay = fixture.dispatch.respondToOffer(captainId, offer.id, true)

        assertEquals(first.id, replay.id)
        assertEquals(DispatchStatus.ASSIGNED, replay.status)
        assertEquals(captainId, replay.assignedCaptainId)
    }

    @Test
    fun `empty candidate scans do not exhaust the Captain offer attempt budget`() {
        val fixture = fixture()
        val started = fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        assertEquals(DispatchStatus.SEARCHING, started.status)
        assertEquals(0, started.attemptCount)

        repeat(25) { fixture.dispatch.retryPendingDispatches() }

        val stillSearching = requireNotNull(fixture.dispatch.tracking(fixture.readyOrder.id))
        assertEquals(DispatchStatus.SEARCHING, stillSearching.status)
        assertEquals(0, stillSearching.attemptCount)
        assertEquals("NO_ELIGIBLE_CAPTAIN", stillSearching.failureReason)

        val captainId = UUID.randomUUID()
        fixture.dispatch.approveCaptain(captainId)
        fixture.dispatch.updateAvailability(captainId, true, 13.6288, 79.4192)
        fixture.dispatch.retryPendingDispatches()

        assertEquals(1, fixture.dispatch.pendingOffers(captainId).size)
        assertTrue(requireNotNull(fixture.dispatch.tracking(fixture.readyOrder.id)).attemptCount == 1)
    }

    private fun fixture(): Fixture {
        val clock = Clock.fixed(Instant.parse("2026-08-15T08:00:00Z"), ZoneOffset.UTC)
        val inventory = InventoryService()
        val listingId = UUID.randomUUID()
        inventory.adjust(listingId, 3, StockReason.RECEIPT, "p4-retry-stock-${UUID.randomUUID()}")
        val orders = OrderService(inventory)
        val quote = QuoteService(clock).createDeliveryQuote(
            customerId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
            lines = mapOf(listingId to Pair(1, 10_000L)),
            deliveryAddress = DeliveryAddressSnapshot(
                addressId = UUID.randomUUID(),
                recipientName = "Customer",
                phoneNumber = "+919876543210",
                line1 = "12 Main Road",
                line2 = null,
                city = "Tirupati",
                state = "Andhra Pradesh",
                pincode = "517501",
            ),
            deliveryFeePaise = 1_500,
            etaMinutes = 30,
        )
        var order = orders.checkout(
            quote = quote,
            organizationId = UUID.randomUUID(),
            listingNames = mapOf(listingId to "Dog Food"),
            idempotencyKey = "p4-retry-checkout",
            actorId = quote.customerId,
            traceId = "p4-retry-trace",
        )
        order = orders.transition(order.id, OrderStatus.ACCEPTED, "p4-retry-accept")
        order = orders.transition(order.id, OrderStatus.PREPARING, "p4-retry-prepare")
        order = orders.transition(order.id, OrderStatus.READY_FOR_PICKUP, "p4-retry-ready")
        val persistence = InMemoryDispatchPersistence()
        val dispatch = DispatchService(
            persistence = persistence,
            geoIndex = InMemoryCaptainGeoIndex(),
            orders = orders,
            clock = clock,
        )
        return Fixture(dispatch, order)
    }

    private data class Fixture(
        val dispatch: DispatchService,
        val readyOrder: ProductOrder,
    )
}
