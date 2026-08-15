package `in`.mypetnew.delivery

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.DeliveryAddressSnapshot
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.delivery.domain.DispatchOfferStatus
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.delivery.domain.DispatchStatus
import `in`.mypetnew.delivery.domain.InMemoryCaptainGeoIndex
import `in`.mypetnew.delivery.domain.InMemoryDispatchPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

class DispatchServiceTest {
    @Test
    fun `ready delivery is assigned once and only captain completes delivery`() {
        val fixture = fixture()
        val captainId = UUID.randomUUID()
        fixture.dispatch.approveCaptain(captainId)
        fixture.dispatch.updateAvailability(captainId, true, 13.6288, 79.4192)

        val first = fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        val replay = fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        assertEquals(first.id, replay.id)
        assertEquals(DispatchStatus.OFFERED, first.status)

        val offer = fixture.dispatch.pendingOffers(captainId).single()
        val assigned = fixture.dispatch.respondToOffer(captainId, offer.id, true)
        assertEquals(captainId, assigned.assignedCaptainId)
        assertEquals(DispatchStatus.ASSIGNED, assigned.status)
        assertTrue(fixture.dispatch.captainState(captainId)?.busy == true)

        assertThrows(DomainException::class.java) {
            fixture.orders.transition(
                fixture.readyOrder.id,
                OrderStatus.PICKED_UP,
                "merchant-spoof",
                actorId = UUID.randomUUID(),
                actorRole = Role.MERCHANT,
            )
        }

        val pickedUp = fixture.dispatch.markPickedUp(captainId, assigned.id, "captain-pickup")
        assertEquals(DispatchStatus.PICKED_UP, pickedUp.status)
        assertEquals(OrderStatus.PICKED_UP, fixture.orders.get(fixture.readyOrder.id).status)
        assertEquals(0, fixture.inventory.reserved(fixture.listingId))

        val delivered = fixture.dispatch.markDelivered(captainId, assigned.id, "captain-delivered")
        assertEquals(DispatchStatus.DELIVERED, delivered.status)
        assertEquals(OrderStatus.DELIVERED, fixture.orders.get(fixture.readyOrder.id).status)
        assertFalse(requireNotNull(fixture.dispatch.captainState(captainId)).busy)

        assertEquals(delivered.id, fixture.dispatch.markDelivered(captainId, assigned.id, "captain-delivered").id)
    }

    @Test
    fun `unapproved offline stale and busy captains are excluded`() {
        val clock = MutableClock(Instant.parse("2026-08-15T09:00:00Z"))
        val fixture = fixture(clock)
        val unapproved = UUID.randomUUID()
        val stale = UUID.randomUUID()
        val busy = UUID.randomUUID()
        val eligible = UUID.randomUUID()

        fixture.dispatch.updateAvailability(unapproved, true, 13.6288, 79.4192)

        fixture.dispatch.approveCaptain(stale)
        fixture.dispatch.updateAvailability(stale, true, 13.6288, 79.4192)
        clock.advance(Duration.ofMinutes(3))

        fixture.dispatch.approveCaptain(busy)
        fixture.dispatch.updateAvailability(busy, true, 13.6288, 79.4192)
        fixture.persistence.updateCaptainBusy(busy, true)

        fixture.dispatch.approveCaptain(eligible)
        fixture.dispatch.updateAvailability(eligible, true, 13.6289, 79.4193)

        val job = fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        assertEquals(DispatchStatus.OFFERED, job.status)
        assertTrue(fixture.dispatch.pendingOffers(unapproved).isEmpty())
        assertTrue(fixture.dispatch.pendingOffers(stale).isEmpty())
        assertTrue(fixture.dispatch.pendingOffers(busy).isEmpty())
        assertEquals(1, fixture.dispatch.pendingOffers(eligible).size)
    }

    @Test
    fun `rejection offers the same job to next nearest captain without leaking assignment`() {
        val fixture = fixture()
        val firstCaptain = UUID.fromString("11111111-1111-4111-8111-111111111111")
        val secondCaptain = UUID.fromString("22222222-2222-4222-8222-222222222222")
        listOf(firstCaptain, secondCaptain).forEach(fixture.dispatch::approveCaptain)
        fixture.dispatch.updateAvailability(firstCaptain, true, 13.6288, 79.4192)
        fixture.dispatch.updateAvailability(secondCaptain, true, 13.6300, 79.4200)

        fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        val firstOffer = fixture.dispatch.pendingOffers(firstCaptain).single()
        val afterReject = fixture.dispatch.respondToOffer(firstCaptain, firstOffer.id, false)

        assertEquals(DispatchStatus.OFFERED, afterReject.status)
        assertNull(afterReject.assignedCaptainId)
        assertEquals(DispatchOfferStatus.REJECTED, fixture.persistence.getOffer(firstOffer.id)?.status)
        val secondOffer = fixture.dispatch.pendingOffers(secondCaptain).single()
        assertEquals(afterReject.id, secondOffer.jobId)
    }

    @Test
    fun `foreign captain cannot accept another captains offer`() {
        val fixture = fixture()
        val owner = UUID.randomUUID()
        val foreign = UUID.randomUUID()
        listOf(owner, foreign).forEach(fixture.dispatch::approveCaptain)
        fixture.dispatch.updateAvailability(owner, true, 13.6288, 79.4192)
        fixture.dispatch.updateAvailability(foreign, true, 13.6400, 79.4300)

        fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        val offer = fixture.dispatch.pendingOffers(owner).single()
        assertThrows(DomainException::class.java) {
            fixture.dispatch.respondToOffer(foreign, offer.id, true)
        }
        assertNull(fixture.dispatch.tracking(fixture.readyOrder.id)?.assignedCaptainId)
    }

    @Test
    fun `expired offer is persisted timed out and retry advances to another captain`() {
        val clock = MutableClock(Instant.parse("2026-08-15T10:00:00Z"))
        val fixture = fixture(clock)
        val firstCaptain = UUID.randomUUID()
        val secondCaptain = UUID.randomUUID()
        listOf(firstCaptain, secondCaptain).forEach(fixture.dispatch::approveCaptain)
        fixture.dispatch.updateAvailability(firstCaptain, true, 13.6288, 79.4192)
        fixture.dispatch.updateAvailability(secondCaptain, true, 13.6290, 79.4194)

        fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)
        val firstOffer = fixture.dispatch.pendingOffers(firstCaptain).single()
        clock.advance(Duration.ofSeconds(31))
        fixture.dispatch.updateAvailability(secondCaptain, true, 13.6290, 79.4194)
        fixture.dispatch.retryPendingDispatches()

        assertEquals(DispatchOfferStatus.TIMED_OUT, fixture.persistence.getOffer(firstOffer.id)?.status)
        assertTrue(fixture.dispatch.pendingOffers(firstCaptain).isEmpty())
        assertEquals(1, fixture.dispatch.pendingOffers(secondCaptain).size)
    }

    @Test
    fun `no captain does not mutate canonical ready order`() {
        val fixture = fixture()
        val job = fixture.dispatch.start(fixture.readyOrder, 13.6287, 79.4191)

        assertEquals(DispatchStatus.SEARCHING, job.status)
        assertEquals(OrderStatus.READY_FOR_PICKUP, fixture.orders.get(fixture.readyOrder.id).status)
        assertNull(job.assignedCaptainId)
        assertNotNull(job.failureReason)
    }

    @Test
    fun `invalid or missing online location fails closed`() {
        val fixture = fixture()
        val captainId = UUID.randomUUID()
        fixture.dispatch.approveCaptain(captainId)

        assertThrows(DomainException::class.java) {
            fixture.dispatch.updateAvailability(captainId, true)
        }
        assertThrows(DomainException::class.java) {
            fixture.dispatch.updateAvailability(captainId, true, 91.0, 79.0)
        }
    }

    private fun fixture(clock: Clock = Clock.fixed(Instant.parse("2026-08-15T08:00:00Z"), ZoneOffset.UTC)): Fixture {
        val inventory = InventoryService()
        val listingId = UUID.randomUUID()
        inventory.adjust(listingId, 5, StockReason.RECEIPT, "seed-stock")
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
            idempotencyKey = "checkout-delivery",
            actorId = quote.customerId,
            traceId = "trace-delivery",
        )
        order = orders.transition(order.id, OrderStatus.ACCEPTED, "accept")
        order = orders.transition(order.id, OrderStatus.PREPARING, "prepare")
        order = orders.transition(order.id, OrderStatus.READY_FOR_PICKUP, "ready")
        val persistence = InMemoryDispatchPersistence()
        val geo = InMemoryCaptainGeoIndex()
        val dispatch = DispatchService(
            persistence = persistence,
            geoIndex = geo,
            orders = orders,
            clock = clock,
        )
        return Fixture(inventory, listingId, orders, persistence, dispatch, order)
    }

    private data class Fixture(
        val inventory: InventoryService,
        val listingId: UUID,
        val orders: OrderService,
        val persistence: InMemoryDispatchPersistence,
        val dispatch: DispatchService,
        val readyOrder: ProductOrder,
    )

    private class MutableClock(private var current: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = current
        fun advance(duration: Duration) {
            current = current.plus(duration)
        }
    }
}
