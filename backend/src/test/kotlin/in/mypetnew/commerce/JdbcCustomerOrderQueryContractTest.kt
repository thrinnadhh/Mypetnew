package `in`.mypetnew.commerce

import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.infrastructure.JdbcCustomerOrderQuery
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

class JdbcCustomerOrderQueryContractTest {
    @Test
    fun `jdbc query is customer scoped stable paged and status filterable`() {
        val databaseName = "customer_orders_${UUID.randomUUID().toString().replace("-", "")}"
        val jdbc = JdbcTemplate(
            DriverManagerDataSource(
                "jdbc:h2:mem:$databaseName;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
                "sa",
                "",
            ),
        )
        jdbc.execute("CREATE SCHEMA mypet")
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                grand_total_paise BIGINT NOT NULL,
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
                quantity INTEGER NOT NULL
            )
            """.trimIndent(),
        )

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

        val page1 = query.list(customerA, null, page = 1, pageSize = 2)
        assertEquals(listOf(first), page1.items.map { it.orderId })
        assertFalse(page1.hasNext)
        assertTrue((page0.items + page1.items).none { it.orderId == foreign })

        val delivered = query.list(customerA, OrderStatus.DELIVERED, page = 0, pageSize = 20)
        assertEquals(listOf(second), delivered.items.map { it.orderId })
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
        jdbc.update(
            """
            INSERT INTO mypet.product_order (
                id, customer_id, outlet_id, grand_total_paise, fulfilment_mode,
                payment_method, payment_status, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            orderId,
            customerId,
            outletId,
            12_500L,
            "STORE_PICKUP",
            "PAY_ON_FULFILMENT",
            "PENDING_EXTERNAL_COLLECTION",
            status.name,
            Timestamp.from(createdAt),
            Timestamp.from(createdAt.plusSeconds(1)),
        )
        jdbc.update(
            "INSERT INTO mypet.product_order_line (order_id, listing_id, quantity) VALUES (?, ?, ?)",
            orderId,
            UUID.randomUUID(),
            quantity,
        )
    }
}
