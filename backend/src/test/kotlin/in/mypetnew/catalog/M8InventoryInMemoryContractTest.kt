package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.CountLineInput
import `in`.mypetnew.catalog.domain.CountSessionStatus
import `in`.mypetnew.catalog.domain.InventoryDamageInput
import `in`.mypetnew.catalog.domain.InventoryExpiryInput
import `in`.mypetnew.catalog.domain.InventoryReceivingInput
import `in`.mypetnew.catalog.domain.InventoryReturnInput
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.InventoryShrinkageInput
import `in`.mypetnew.catalog.domain.ReturnType
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.TransferRequest
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID

class M8InventoryInMemoryContractTest {
    private val organizationId = UUID.randomUUID()
    private val outletId = UUID.randomUUID()
    private val actorId = UUID.randomUUID()

    @Test
    fun `M8 in-memory receiving damage expiry shrinkage and returns preserve inventory semantics`() {
        val service = InventoryService()
        val listingId = UUID.randomUUID()
        val scope = InventoryScope(organizationId, outletId, listingId)

        val received = service.receive(
            scope,
            InventoryReceivingInput(outletId, listingId, 100, "PURCHASE_ORDER", "PO-1", "B-1", "2028-12-31"),
            "receive-1", actorId, "trace-receive",
        )
        assertEquals(StockReason.RECEIVING, received.reason)
        assertEquals(100, received.resultingOnHand)
        assertEquals(received.id, service.receive(
            scope,
            InventoryReceivingInput(outletId, listingId, 100, "PURCHASE_ORDER", "PO-1", "B-1", "2028-12-31"),
            "receive-1", actorId, "trace-receive-replay",
        ).id)

        assertEquals(-10, service.damage(scope, InventoryDamageInput(outletId, listingId, 10, "broken", "DMG-1"), "damage-1", actorId, "trace-damage").quantityDelta)
        assertEquals(-5, service.expire(scope, InventoryExpiryInput(outletId, listingId, 5, "B-1", "2028-12-31"), "expiry-1", actorId, "trace-expiry").quantityDelta)
        assertEquals(-3, service.shrink(scope, InventoryShrinkageInput(outletId, listingId, 3, "cycle count", "SHR-1"), "shrink-1", actorId, "trace-shrink").quantityDelta)
        assertEquals(4, service.returnStock(scope, InventoryReturnInput(outletId, listingId, 4, ReturnType.CUSTOMER_RETURN, "ORDER", "RET-1"), "return-customer", actorId, "trace-return-customer").quantityDelta)
        assertEquals(-6, service.returnStock(scope, InventoryReturnInput(outletId, listingId, 6, ReturnType.VENDOR_RETURN, "RMA", "RET-2"), "return-vendor", actorId, "trace-return-vendor").quantityDelta)

        val balance = service.balance(scope)
        assertEquals(80, balance.onHand)
        assertEquals(0, balance.reserved)
        assertEquals(80, balance.available)
        assertTrue(service.history(listingId).map { it.reason }.containsAll(listOf(
            StockReason.RECEIVING,
            StockReason.DAMAGE,
            StockReason.EXPIRY,
            StockReason.SHRINKAGE,
            StockReason.CUSTOMER_RETURN,
            StockReason.VENDOR_RETURN,
        )))

        assertThrows(DomainException::class.java) {
            service.receive(scope, InventoryReceivingInput(outletId, listingId, 101), "receive-1", actorId, "trace-mismatch")
        }
        assertThrows(DomainException::class.java) {
            service.damage(scope, InventoryDamageInput(outletId, listingId, 10_000), "damage-too-much", actorId, "trace-damage-fail")
        }
    }

    @Test
    fun `M8 in-memory transfer is conserved idempotent and rejects invalid transfers`() {
        val service = InventoryService()
        val sourceListing = UUID.randomUUID()
        val destinationListing = UUID.randomUUID()
        val destinationOutlet = UUID.randomUUID()
        val sourceScope = InventoryScope(organizationId, outletId, sourceListing)
        val destinationScope = InventoryScope(organizationId, destinationOutlet, destinationListing)

        service.receive(sourceScope, InventoryReceivingInput(outletId, sourceListing, 50), "seed-transfer", actorId, "trace-seed-transfer")
        val request = TransferRequest(outletId, destinationOutlet, sourceListing, destinationListing, 20)
        val result = service.transfer(organizationId, request, "transfer-1", actorId, "trace-transfer")

        assertEquals(30, service.balance(sourceScope).onHand)
        assertEquals(20, service.balance(destinationScope).onHand)
        assertEquals(StockReason.TRANSFER_OUT, result.sourceMovement.reason)
        assertEquals(StockReason.TRANSFER_IN, result.destinationMovement.reason)
        assertEquals(result.transfer.id, service.transfer(organizationId, request, "transfer-1", actorId, "trace-transfer-replay").transfer.id)

        assertThrows(DomainException::class.java) {
            service.transfer(organizationId, request.copy(quantity = 31), "transfer-too-much", actorId, "trace-transfer-fail")
        }
        assertThrows(DomainException::class.java) {
            service.transfer(organizationId, request.copy(destinationOutletId = outletId), "transfer-same-outlet", actorId, "trace-transfer-invalid")
        }
    }

    @Test
    fun `M8 in-memory count reconciliation incorporates post-cutoff movements and supports replay`() {
        val service = InventoryService()
        val listingId = UUID.randomUUID()
        val scope = InventoryScope(organizationId, outletId, listingId)
        service.receive(scope, InventoryReceivingInput(outletId, listingId, 20), "count-seed", actorId, "trace-count-seed")

        val session = service.startCountSession(organizationId, outletId, actorId, "trace-count-start", 7)
        service.updateCountLines(organizationId, outletId, session.id, listOf(CountLineInput(listingId, 18)))
        service.receive(scope, InventoryReceivingInput(outletId, listingId, 2), "count-after-cutoff", actorId, "trace-count-after")

        val result = service.submitCountSession(organizationId, outletId, session.id, "count-submit", actorId, "trace-count-submit")
        assertEquals(CountSessionStatus.SUBMITTED, result.status)
        assertEquals(20, result.lines.single().targetCurrentOnHand)
        assertEquals(-2, result.lines.single().countAdjustmentDelta)
        assertNotNull(result.lines.single().movementId)
        assertEquals(20, service.balance(scope).onHand)

        val replay = service.submitCountSession(organizationId, outletId, session.id, "count-submit", actorId, "trace-count-replay")
        assertEquals(result, replay)
        assertThrows(DomainException::class.java) {
            service.updateCountLines(organizationId, outletId, session.id, listOf(CountLineInput(listingId, 19)))
        }
    }

    @Test
    fun `M8 in-memory count conflict moves session to review and validation rejects negative counts`() {
        val service = InventoryService()
        val listingId = UUID.randomUUID()
        val scope = InventoryScope(organizationId, outletId, listingId)
        service.receive(scope, InventoryReceivingInput(outletId, listingId, 10), "conflict-seed", actorId, "trace-conflict-seed")
        service.reserve(listingId, 8, "conflict-reserve", actorId, "trace-conflict-reserve")

        val session = service.startCountSession(organizationId, outletId, actorId, "trace-conflict-start")
        service.updateCountLines(organizationId, outletId, session.id, listOf(CountLineInput(listingId, 4)))
        val conflict = assertThrows(DomainException::class.java) {
            service.submitCountSession(organizationId, outletId, session.id, "conflict-submit", actorId, "trace-conflict-submit")
        }
        assertEquals("COUNT_CUTOFF_CONFLICT", conflict.code)
        assertEquals(CountSessionStatus.REVIEW_REQUIRED, service.getCountSession(organizationId, outletId, session.id).status)
        assertEquals(10, service.balance(scope).onHand)
        assertEquals(8, service.balance(scope).reserved)

        val other = service.startCountSession(organizationId, outletId, actorId, "trace-negative-count")
        assertThrows(DomainException::class.java) {
            service.updateCountLines(organizationId, outletId, other.id, listOf(CountLineInput(listingId, -1)))
        }
        assertThrows(DomainException::class.java) {
            service.getCountSession(UUID.randomUUID(), outletId, other.id)
        }
        assertThrows(DomainException::class.java) {
            service.receive(scope, InventoryReceivingInput(outletId, listingId, 0), "zero-receive", actorId, "trace-zero")
        }
    }
}
