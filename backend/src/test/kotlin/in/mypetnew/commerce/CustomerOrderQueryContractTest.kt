package `in`.mypetnew.commerce

import `in`.mypetnew.commerce.domain.InMemoryQueryableOrderPersistence
import `in`.mypetnew.commerce.domain.OrderHistoryEntry
import `in`.mypetnew.commerce.domain.OrderLineSnapshot
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.auth.Role
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID

class CustomerOrderQueryContractTest {
    private val persistence = InMemoryQueryableOrderPersistence()
    private val outletId = UUID.fromString("11111111-1111-4111-8111-111111111111")
    private val customerA = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    private val customerB = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

    @Test
    fun `customer list is owner scoped stable paged and status filterable`() {
        val first = UUID.fromString("10000000-0000-4000-8000-000000000001")
        val second = UUID.fromString("20000000-0000-4000-8000-000000000002")
        val third = UUID.fromString("30000000-0000-4000-8000-000000000003")
        val foreign = UUID.fromString("f0000000-0000-4000-8000-000000000004")

        insert(first, customerA, OrderStatus.PLACED, Instant.parse("2026-08-15T01:00:00Z"), mapOf(UUID.randomUUID() to 1))
        insert(second, customerA, OrderStatus.DELIVERED, Instant.parse("2026-08-15T02:00:00Z"), mapOf(UUID.randomUUID() to 2))
        insert(third, customerA, OrderStatus.CANCELLED, Instant.parse("2026-08-15T02:00:00Z"), mapOf(UUID.randomUUID() to 3))
        insert(foreign, customerB, OrderStatus.PLACED, Instant.parse("2026-08-15T03:00:00Z"), mapOf(UUID.randomUUID() to 9))

        val page0 = persistence.list(customerA, null, page = 0, pageSize = 2)
        assertEquals(listOf(third, second), page0.items.map { it.orderId })
        assertEquals(listOf(3, 2), page0.items.map { it.itemCount })
        assertTrue(page0.hasNext)

        val page1 = persistence.list(customerA, null, page = 1, pageSize = 2)
        assertEquals(listOf(first), page1.items.map { it.orderId })
        assertFalse(page1.hasNext)
        assertTrue((page0.items + page1.items).none { it.orderId == foreign })

        val delivered = persistence.list(customerA, OrderStatus.DELIVERED, page = 0, pageSize = 20)
        assertEquals(listOf(second), delivered.items.map { it.orderId })
    }

    private fun insert(
        id: UUID,
        customerId: UUID,
        status: OrderStatus,
        placedAt: Instant,
        lines: Map<UUID, Int>,
    ) {
        val order = ProductOrder(
            id = id,
            customerId = customerId,
            outletId = outletId,
            lines = lines,
            grandTotalPaise = 12_500,
            status = status,
            history = emptyList(),
        )
        val snapshots = lines.map { (listingId, quantity) ->
            OrderLineSnapshot(listingId, "Test item", quantity, 12_500)
        }
        persistence.insertOrder(
            order = order,
            lines = snapshots,
            idempotencyKey = "checkout-$id",
            requestFingerprint = "fingerprint-$id",
            initialHistory = OrderHistoryEntry(
                status = status,
                occurredAt = placedAt,
                commandKey = "checkout-$id",
                actorId = customerId,
                actorRole = Role.CUSTOMER,
            ),
        )
    }
}
