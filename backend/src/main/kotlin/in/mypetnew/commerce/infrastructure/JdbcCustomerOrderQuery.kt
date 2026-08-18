package `in`.mypetnew.commerce.infrastructure

import `in`.mypetnew.commerce.domain.CustomerOrderCategory
import `in`.mypetnew.commerce.domain.CustomerOrderCursor
import `in`.mypetnew.commerce.domain.CustomerOrderDetailSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderLineSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.CustomerOrderSummary
import `in`.mypetnew.commerce.domain.CustomerOrderSummaryPage
import `in`.mypetnew.commerce.domain.OrderHistoryEntry
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import java.util.UUID

class JdbcCustomerOrderQuery(
    private val jdbc: JdbcTemplate,
) : CustomerOrderQuery {
    private val named = NamedParameterJdbcTemplate(jdbc)

    override fun list(
        customerId: UUID,
        status: OrderStatus?,
        page: Int,
        pageSize: Int,
        category: CustomerOrderCategory?,
        cursor: CustomerOrderCursor?,
    ): CustomerOrderSummaryPage {
        validatePagination(page, pageSize)
        if (status != null && category != null) {
            throw DomainException("ORDER_FILTER_INVALID", "Choose either an order status or category filter")
        }

        val params = MapSqlParameterSource()
            .addValue("customerId", customerId)
            .addValue("limit", pageSize + 1)
            .addValue("offset", if (cursor == null) page.toLong() * pageSize.toLong() else 0L)
        val filters = mutableListOf("o.customer_id = :customerId")

        if (status != null) {
            filters += "o.status = :status"
            params.addValue("status", status.name)
        } else if (category != null) {
            filters += "o.status IN (:statuses)"
            params.addValue("statuses", statuses(category).map(OrderStatus::name))
        }

        if (cursor != null) {
            filters += "(o.created_at < :cursorPlacedAt OR (o.created_at = :cursorPlacedAt AND o.id < :cursorOrderId))"
            params.addValue("cursorPlacedAt", java.sql.Timestamp.from(cursor.placedAt))
            params.addValue("cursorOrderId", cursor.orderId)
        }

        val rows = named.query(
            """
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
            WHERE ${filters.joinToString(" AND ")}
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
            params,
        ) { result, _ -> summary(result) }

        val items = rows.take(pageSize)
        return CustomerOrderSummaryPage(
            items = items,
            hasNext = rows.size > pageSize,
            nextCursor = if (rows.size > pageSize && items.isNotEmpty()) {
                items.last().let { CustomerOrderCursor(it.placedAt, it.orderId) }
            } else {
                null
            },
        )
    }

    override fun detail(customerId: UUID, orderId: UUID): CustomerOrderDetailSnapshot? {
        val header = jdbc.query(
            """
            SELECT id, order_number, outlet_id, quote_id, grand_total_paise, platform_fee_paise,
                   payment_method, payment_status, fulfilment_mode, status, created_at
            FROM mypet.product_order
            WHERE id = ? AND customer_id = ?
            """.trimIndent(),
            { result, _ ->
                Header(
                    orderId = result.getObject("id", UUID::class.java),
                    orderNumber = result.getString("order_number"),
                    outletId = result.getObject("outlet_id", UUID::class.java),
                    quoteId = result.getObject("quote_id", UUID::class.java),
                    grandTotalPaise = result.getLong("grand_total_paise"),
                    platformFeePaise = result.getLong("platform_fee_paise"),
                    paymentMethod = result.getString("payment_method"),
                    paymentStatus = result.getString("payment_status"),
                    fulfilmentMode = result.getString("fulfilment_mode"),
                    status = OrderStatus.valueOf(result.getString("status")),
                    placedAt = result.getTimestamp("created_at")?.toInstant(),
                )
            },
            orderId,
            customerId,
        ).singleOrNull() ?: return null

        val items = jdbc.query(
            """
            SELECT listing_id, listing_name, quantity, unit_price_paise
            FROM mypet.product_order_line
            WHERE order_id = ?
            ORDER BY listing_id
            """.trimIndent(),
            { result, _ ->
                CustomerOrderLineSnapshot(
                    listingId = result.getObject("listing_id", UUID::class.java),
                    listingName = result.getString("listing_name"),
                    quantity = result.getInt("quantity"),
                    unitPricePaise = result.getLong("unit_price_paise"),
                )
            },
            orderId,
        )
        val history = jdbc.query(
            """
            SELECT from_status, to_status, actor_id, actor_role, reason, idempotency_key, trace_id, occurred_at
            FROM mypet.product_order_history
            WHERE order_id = ?
            ORDER BY occurred_at, id
            """.trimIndent(),
            { result, _ ->
                OrderHistoryEntry(
                    status = OrderStatus.valueOf(result.getString("to_status")),
                    occurredAt = result.getTimestamp("occurred_at").toInstant(),
                    commandKey = result.getString("idempotency_key"),
                    fromStatus = result.getString("from_status")?.let(OrderStatus::valueOf),
                    actorId = result.getObject("actor_id", UUID::class.java),
                    actorRole = Role.valueOf(result.getString("actor_role")),
                    reason = result.getString("reason"),
                    traceId = result.getString("trace_id"),
                )
            },
            orderId,
        )
        return CustomerOrderDetailSnapshot(
            orderId = header.orderId,
            orderNumber = header.orderNumber,
            outletId = header.outletId,
            quoteId = header.quoteId,
            items = items,
            grandTotalPaise = header.grandTotalPaise,
            platformFeePaise = header.platformFeePaise,
            paymentMethod = header.paymentMethod,
            paymentStatus = header.paymentStatus,
            fulfilmentMode = header.fulfilmentMode,
            status = header.status,
            placedAt = header.placedAt,
            statusHistory = history,
        )
    }

    private fun summary(result: java.sql.ResultSet): CustomerOrderSummary = CustomerOrderSummary(
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

    private fun statuses(category: CustomerOrderCategory): Set<OrderStatus> = when (category) {
        CustomerOrderCategory.ACTIVE -> setOf(
            OrderStatus.PLACED,
            OrderStatus.ACCEPTED,
            OrderStatus.PREPARING,
            OrderStatus.READY_FOR_PICKUP,
            OrderStatus.PICKED_UP,
        )
        CustomerOrderCategory.PAST -> setOf(
            OrderStatus.DELIVERED,
            OrderStatus.REJECTED,
            OrderStatus.CANCELLED,
        )
    }

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    private data class Header(
        val orderId: UUID,
        val orderNumber: String,
        val outletId: UUID,
        val quoteId: UUID,
        val grandTotalPaise: Long,
        val platformFeePaise: Long,
        val paymentMethod: String,
        val paymentStatus: String,
        val fulfilmentMode: String,
        val status: OrderStatus,
        val placedAt: java.time.Instant?,
    )
}
