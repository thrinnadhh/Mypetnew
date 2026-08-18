package `in`.mypetnew.commerce

import `in`.mypetnew.commerce.domain.CustomerOrderCategory
import `in`.mypetnew.commerce.domain.InMemoryQueryableOrderPersistence
import `in`.mypetnew.commerce.domain.OrderHistoryEntry
import `in`.mypetnew.commerce.domain.OrderLineSnapshot
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.auth.Role
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
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
        assertEquals(second, page0.nextCursor?.orderId)

        val page1 = persistence.list(customerA, null, page = 1, pageSize = 2)
        assertEquals(listOf(first), page1.items.map { it.orderId })
        assertFalse(page1.hasNext)
        assertTrue((page0.items + page1.items).none { it.orderId == foreign })

        val delivered = persistence.list(customerA, OrderStatus.DELIVERED, page = 0, pageSize = 20)
        assertEquals(listOf(second), delivered.items.map { it.orderId })
    }

    @Test
    fun `cursor page does not shift when a newer order is inserted`() {
        val first = UUID.fromString("10000000-0000-4000-8000-000000000011")
        val second = UUID.fromString("20000000-0000-4000-8000-000000000012")
        val third = UUID.fromString("30000000-0000-4000-8000-000000000013")
        insert(first, customerA, OrderStatus.PLACED, Instant.parse("2026-08-15T01:00:00Z"), mapOf(UUID.randomUUID() to 1))
        insert(second, customerA, OrderStatus.ACCEPTED, Instant.parse("2026-08-15T02:00:00Z"), mapOf(UUID.randomUUID() to 1))
        insert(third, customerA, OrderStatus.PREPARING, Instant.parse("2026-08-15T03:00:00Z"), mapOf(UUID.randomUUID() to 1))

        val page0 = persistence.list(customerA, null, 0, 2, CustomerOrderCategory.ACTIVE)
        val cursor = requireNotNull(page0.nextCursor)
        val newest = UUID.fromString("40000000-0000-4000-8000-000000000014")
        insert(newest, customerA, OrderStatus.PLACED, Instant.parse("2026-08-15T04:00:00Z"), mapOf(UUID.randomUUID() to 1))

        val page1 = persistence.list(customerA, null, 1, 2, CustomerOrderCategory.ACTIVE, cursor)
        assertEquals(listOf(first), page1.items.map { it.orderId })
        assertTrue(page1.items.none { it.orderId in page0.items.map { item -> item.orderId } })
        assertTrue(page1.items.none { it.orderId == newest })
    }

    @Test
    fun `detail is owner scoped and preserves order-time line snapshots`() {
        val orderId = UUID.fromString("50000000-0000-4000-8000-000000000015")
        val listingId = UUID.fromString("60000000-0000-4000-8000-000000000016")
        insert(
            orderId,
            customerA,
            OrderStatus.PLACED,
            Instant.parse("2026-08-15T05:00:00Z"),
            mapOf(listingId to 2),
            listingName = "Original dog food name",
            unitPricePaise = 12_345,
        )

        val detail = requireNotNull(persistence.detail(customerA, orderId))
        assertEquals("Original dog food name", detail.items.single().listingName)
        assertEquals(12_345, detail.items.single().unitPricePaise)
        assertEquals(2, detail.items.single().quantity)
        assertNull(persistence.detail(customerB, orderId))
    }

    @Test
    fun `active and past category filters are server authoritative`() {
        val active = UUID.fromString("70000000-0000-4000-8000-000000000017")
        val past = UUID.fromString("80000000-0000-4000-8000-000000000018")
        insert(active, customerA, OrderStatus.READY_FOR_PICKUP, Instant.parse("2026-08-15T06:00:00Z"), mapOf(UUID.randomUUID() to 1))
        insert(past, customerA, OrderStatus.CANCELLED, Instant.parse("2026-08-15T07:00:00Z"), mapOf(UUID.randomUUID() to 1))

        assertEquals(listOf(active), persistence.list(customerA, null, 0, 20, CustomerOrderCategory.ACTIVE).items.map { it.orderId })
        assertEquals(listOf(past), persistence.list(customerA, null, 0, 20, CustomerOrderCategory.PAST).items.map { it.orderId })
    }

    private fun insert(
        id: UUID,
        customerId: UUID,
        status: OrderStatus,
        placedAt: Instant,
        lines: Map<UUID, Int>,
        listingName: String = "Test item",
        unitPricePaise: Long = 12_500,
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
            OrderLineSnapshot(listingId, listingName, quantity, unitPricePaise)
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
