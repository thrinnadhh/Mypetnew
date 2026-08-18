package `in`.mypetnew.commerce

import `in`.mypetnew.commerce.domain.CustomerOrderCategory
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.infrastructure.JdbcCustomerOrderQuery
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

class JdbcCustomerOrderQueryContractTest {
    @Test
    fun `jdbc query is customer scoped cursor stable and preserves order snapshots`() {
        val databaseName = "customer_orders_${UUID.randomUUID().toString().replace("-", "")}"
        val jdbc = JdbcTemplate(
            DriverManagerDataSource(
                "jdbc:h2:mem:$databaseName;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
                "sa",
                "",
            ),
        )
        createSchema(jdbc)

        val query = JdbcCustomerOrderQuery(jdbc)
        val customerA = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        val customerB = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        val outletId = UUID.fromString("11111111-1111-4111-8111-111111111111")
        val first = UUID.fromString("10000000-0000-4000-8000-000000000001")
        val second = UUID.fromString("20000000-0000-4000-8000-000000000002")
        val third = UUID.fromString("30000000-0000-4000-8000-000000000003")
        val foreign = UUID.fromString("f0000000-0000-4000-8000-000000000004")

        insert(jdbc, first, customerA, outletId, OrderStatus.PLACED, Instant.parse("2026-08-15T01:00:00Z"), 1)
        insert(jdbc, second, customerA, outletId, OrderStatus.DELIVERED, Instant.parse("2026-08-15T02:00:00Z"), 2)
        insert(jdbc, third, customerA, outletId, OrderStatus.CANCELLED, Instant.parse("2026-08-15T02:00:00Z"), 3)
        insert(jdbc, foreign, customerB, outletId, OrderStatus.PLACED, Instant.parse("2026-08-15T03:00:00Z"), 9)

        val page0 = query.list(customerA, null, page = 0, pageSize = 2)
        assertEquals(listOf(third, second), page0.items.map { it.orderId })
        assertEquals(listOf(3, 2), page0.items.map { it.itemCount })
        assertTrue(page0.hasNext)
        val cursor = requireNotNull(page0.nextCursor)

        val newest = UUID.fromString("40000000-0000-4000-8000-000000000005")
        insert(jdbc, newest, customerA, outletId, OrderStatus.PLACED, Instant.parse("2026-08-15T04:00:00Z"), 1)
        val cursorPage = query.list(customerA, null, page = 1, pageSize = 2, cursor = cursor)
        assertEquals(listOf(first), cursorPage.items.map { it.orderId })
        assertFalse(cursorPage.hasNext)
        assertTrue(cursorPage.items.none { it.orderId in page0.items.map { item -> item.orderId } })
        assertTrue(cursorPage.items.none { it.orderId == newest })
        assertTrue((page0.items + cursorPage.items).none { it.orderId == foreign })

        val active = query.list(customerA, null, page = 0, pageSize = 20, category = CustomerOrderCategory.ACTIVE)
        assertEquals(listOf(newest, first), active.items.map { it.orderId })
        val past = query.list(customerA, null, page = 0, pageSize = 20, category = CustomerOrderCategory.PAST)
        assertEquals(listOf(third, second), past.items.map { it.orderId })

        val detail = requireNotNull(query.detail(customerA, first))
        assertEquals("Snapshot item $first", detail.items.single().listingName)
        assertEquals(12_345L, detail.items.single().unitPricePaise)
        assertEquals(OrderStatus.PLACED, detail.statusHistory.single().status)
        assertNull(query.detail(customerB, first))
    }

    private fun createSchema(jdbc: JdbcTemplate) {
        jdbc.execute("CREATE SCHEMA mypet")
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order (
                id UUID PRIMARY KEY,
                order_number VARCHAR(40) NOT NULL,
                customer_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                quote_id UUID NOT NULL,
                grand_total_paise BIGINT NOT NULL,
                platform_fee_paise BIGINT NOT NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                payment_method VARCHAR(40) NOT NULL,
                payment_status VARCHAR(40) NOT NULL,
                status VARCHAR(32) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order_line (
                order_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                listing_name VARCHAR(240) NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price_paise BIGINT NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order_history (
                id UUID PRIMARY KEY,
                order_id UUID NOT NULL,
                from_status VARCHAR(32),
                to_status VARCHAR(32) NOT NULL,
                actor_id UUID NOT NULL,
                actor_role VARCHAR(32) NOT NULL,
                reason VARCHAR(240),
                idempotency_key VARCHAR(128) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """.trimIndent(),
        )
    }

    private fun insert(
        jdbc: JdbcTemplate,
        orderId: UUID,
        customerId: UUID,
        outletId: UUID,
        status: OrderStatus,
        createdAt: Instant,
        quantity: Int,
    ) {
        val quoteId = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.product_order (
                id, order_number, customer_id, outlet_id, quote_id, grand_total_paise, platform_fee_paise,
                fulfilment_mode, payment_method, payment_status, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            orderId,
            "MP-${orderId.toString().replace("-", "").take(12).uppercase()}",
            customerId,
            outletId,
            quoteId,
            12_500L,
            1_000L,
            "STORE_PICKUP",
            "PAY_ON_FULFILMENT",
            "PENDING_EXTERNAL_COLLECTION",
            status.name,
            Timestamp.from(createdAt),
            Timestamp.from(createdAt.plusSeconds(1)),
        )
        val listingId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.product_order_line (order_id, listing_id, listing_name, quantity, unit_price_paise) VALUES (?, ?, ?, ?, ?)",
            orderId,
            listingId,
            "Snapshot item $orderId",
            quantity,
            12_345L,
        )
        jdbc.update(
            """
            INSERT INTO mypet.product_order_history (
                id, order_id, from_status, to_status, actor_id, actor_role, reason, idempotency_key, trace_id, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            orderId,
            null,
            status.name,
            customerId,
            "CUSTOMER",
            null,
            "checkout-$orderId",
            "test-trace",
            Timestamp.from(createdAt),
        )
    }
}
