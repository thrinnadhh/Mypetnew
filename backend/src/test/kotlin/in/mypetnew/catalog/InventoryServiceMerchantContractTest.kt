package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID

class InventoryServiceMerchantContractTest {
    @Test
    fun `merchant scoped adjustments preserve authority metadata paginate history and reconcile`() {
        val inventory = InventoryService()
        val scope = InventoryScope(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID())
        val actorId = UUID.randomUUID()

        val first = inventory.adjustMerchant(
            scope = scope,
            delta = 3,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "merchant-adjust-1",
            actorId = actorId,
            traceId = "trace-1",
            referenceType = "STOCK_COUNT",
            referenceId = "count-1",
        )
        inventory.adjustMerchant(
            scope = scope,
            delta = 2,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "merchant-adjust-2",
            actorId = actorId,
            traceId = "trace-2",
        )

        assertEquals(scope.organizationId, first.organizationId)
        assertEquals(scope.outletId, first.outletId)
        assertEquals(actorId, first.actorId)
        assertEquals("merchant-adjust-1", first.idempotencyKey)
        assertEquals("STOCK_COUNT", first.sourceType)
        assertEquals("count-1", first.sourceReference)

        val balance = inventory.balance(scope)
        assertEquals(5, balance.onHand)
        assertEquals(0, balance.reserved)
        assertEquals(5, balance.available)

        val firstPage = inventory.history(scope, page = -1, pageSize = 1)
        assertEquals(0, firstPage.page)
        assertEquals(1, firstPage.pageSize)
        assertEquals(1, firstPage.items.size)
        assertTrue(firstPage.hasNext)

        val lastPage = inventory.history(scope, page = 1, pageSize = 1)
        assertEquals(1, lastPage.items.size)
        assertFalse(lastPage.hasNext)
        assertEquals(5, inventory.requireReconciled(scope).onHand)
    }

    @Test
    fun `merchant adjustment validation rejects unsafe command shapes`() {
        val inventory = InventoryService()
        val scope = InventoryScope(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID())
        val actorId = UUID.randomUUID()

        assertThrows(DomainException::class.java) {
            inventory.adjustMerchant(scope, 0, StockReason.MANUAL_INCREASE, "zero", actorId, "trace")
        }
        assertThrows(DomainException::class.java) {
            inventory.adjustMerchant(scope, -1, StockReason.MANUAL_INCREASE, "wrong-sign", actorId, "trace")
        }
        assertThrows(DomainException::class.java) {
            inventory.adjustMerchant(scope, 1, StockReason.RECEIPT, "wrong-reason", actorId, "trace")
        }
        assertThrows(DomainException::class.java) {
            inventory.adjustMerchant(
                scope,
                1,
                StockReason.MANUAL_INCREASE,
                "partial-reference",
                actorId,
                "trace",
                referenceType = "COUNT",
                referenceId = null,
            )
        }
        assertThrows(DomainException::class.java) {
            inventory.adjustMerchant(
                scope,
                1,
                StockReason.MANUAL_INCREASE,
                "invalid-reference",
                actorId,
                "trace",
                referenceType = "not-valid",
                referenceId = "count-1",
            )
        }
        assertThrows(DomainException::class.java) {
            inventory.adjustMerchant(
                scope,
                1_000_001,
                StockReason.MANUAL_INCREASE,
                "too-large",
                actorId,
                "trace",
            )
        }
    }

    @Test
    fun `inventory reservation release fulfilment and point of sale keep stock legal`() {
        val inventory = InventoryService()
        val listingId = UUID.randomUUID()

        inventory.adjust(listingId, 4, StockReason.RECEIPT, "opening")
        inventory.reserve(listingId, 2, "reserve-1")
        inventory.release(listingId, 1, "release-1")
        inventory.fulfil(listingId, 1, "fulfil-1")
        inventory.sell(listingId, 1, "pos-1")

        assertEquals(2, inventory.available(listingId))
        assertEquals(0, inventory.reserved(listingId))
        assertTrue(inventory.history(listingId).isNotEmpty())

        assertThrows(DomainException::class.java) {
            inventory.release(listingId, 1, "release-without-reservation")
        }
    }
}
