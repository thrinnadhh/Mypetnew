package `in`.mypetnew.commerce.infrastructure

import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.CustomerOrderSummary
import `in`.mypetnew.commerce.domain.CustomerOrderSummaryPage
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.common.error.DomainException
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

class JdbcCustomerOrderQuery(
    private val jdbc: JdbcTemplate,
) : CustomerOrderQuery {
    override fun list(
        customerId: UUID,
        status: OrderStatus?,
        page: Int,
        pageSize: Int,
    ): CustomerOrderSummaryPage {
        validatePagination(page, pageSize)
        val offset = page.toLong() * pageSize.toLong()
        val limit = pageSize + 1
        val select = """
            SELECT o.id,
                   o.outlet_id,
                   o.grand_total_paise,
                   o.fulfilment_mode,
                   o.payment_method,
                   o.payment_status,
                   o.status,
                   o.created_at,
                   o.updated_at,
                   COALESCE((
                       SELECT SUM(l.quantity)
                       FROM mypet.product_order_line l
                       WHERE l.order_id = o.id
                   ), 0) AS item_count
            FROM mypet.product_order o
        """.trimIndent()

        val rows = if (status == null) {
            jdbc.query(
                "$select\nWHERE o.customer_id = ?\nORDER BY o.created_at DESC, o.id DESC\nLIMIT ? OFFSET ?",
                { result, _ ->
                    CustomerOrderSummary(
                        orderId = result.getObject("id", UUID::class.java),
                        outletId = result.getObject("outlet_id", UUID::class.java),
                        itemCount = result.getInt("item_count"),
                        grandTotalPaise = result.getLong("grand_total_paise"),
                        fulfilmentMode = result.getString("fulfilment_mode"),
                        paymentMethod = result.getString("payment_method"),
                        paymentStatus = result.getString("payment_status"),
                        status = OrderStatus.valueOf(result.getString("status")),
                        placedAt = result.getTimestamp("created_at").toInstant(),
                        lastUpdatedAt = result.getTimestamp("updated_at").toInstant(),
                    )
                },
                customerId,
                limit,
                offset,
            )
        } else {
            jdbc.query(
                "$select\nWHERE o.customer_id = ? AND o.status = ?\nORDER BY o.created_at DESC, o.id DESC\nLIMIT ? OFFSET ?",
                { result, _ ->
                    CustomerOrderSummary(
                        orderId = result.getObject("id", UUID::class.java),
                        outletId = result.getObject("outlet_id", UUID::class.java),
                        itemCount = result.getInt("item_count"),
                        grandTotalPaise = result.getLong("grand_total_paise"),
                        fulfilmentMode = result.getString("fulfilment_mode"),
                        paymentMethod = result.getString("payment_method"),
                        paymentStatus = result.getString("payment_status"),
                        status = OrderStatus.valueOf(result.getString("status")),
                        placedAt = result.getTimestamp("created_at").toInstant(),
                        lastUpdatedAt = result.getTimestamp("updated_at").toInstant(),
                    )
                },
                customerId,
                status.name,
                limit,
                offset,
            )
        }

        return CustomerOrderSummaryPage(
            items = rows.take(pageSize),
            hasNext = rows.size > pageSize,
        )
    }

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }
}
