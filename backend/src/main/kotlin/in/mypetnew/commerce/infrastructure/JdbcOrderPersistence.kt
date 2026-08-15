package `in`.mypetnew.commerce.infrastructure

import `in`.mypetnew.commerce.domain.CheckoutIdempotencyRace
import `in`.mypetnew.commerce.domain.OrderHistoryEntry
import `in`.mypetnew.commerce.domain.OrderLineSnapshot
import `in`.mypetnew.commerce.domain.OrderPersistence
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.PersistedCheckout
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.util.UUID

class JdbcOrderPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : OrderPersistence {
    override val rollsBackOnFailure: Boolean = true

    override fun <T> inTransaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("Order transaction returned no result")

    override fun findCheckout(customerId: UUID, idempotencyKey: String): PersistedCheckout? {
        val row = jdbc.query(
            """
            SELECT id, checkout_request_fingerprint
            FROM mypet.product_order
            WHERE customer_id = ? AND checkout_idempotency_key = ?
            """.trimIndent(),
            { result, _ -> result.getObject("id", UUID::class.java) to result.getString("checkout_request_fingerprint") },
            customerId,
            idempotencyKey,
        ).singleOrNull() ?: return null
        return PersistedCheckout(row.second, get(row.first))
    }

    override fun insertOrder(
        order: ProductOrder,
        lines: List<OrderLineSnapshot>,
        idempotencyKey: String,
        requestFingerprint: String,
        initialHistory: OrderHistoryEntry,
    ) {
        try {
            jdbc.update(
                """
                INSERT INTO mypet.product_order (
                    id, order_number, customer_id, organization_id, outlet_id, quote_id, status,
                    fulfilment_mode, payment_method, payment_status, grand_total_paise,
                    platform_fee_paise, merchant_commission_paise, currency, payment_hold_expires_at, version,
                    checkout_idempotency_key, checkout_request_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 0, ?, ?)
                """.trimIndent(),
                order.id,
                order.orderNumber,
                order.customerId,
                order.organizationId,
                order.outletId,
                order.quoteId,
                order.status.name,
                order.fulfilmentMode,
                order.paymentMethod,
                order.paymentStatus,
                order.grandTotalPaise,
                order.platformFeePaise,
                order.merchantCommissionPaise,
                order.paymentHoldExpiresAt,
                idempotencyKey,
                requestFingerprint,
            )
            lines.forEach { line ->
                jdbc.update(
                    """
                    INSERT INTO mypet.product_order_line (
                        order_id, listing_id, listing_name, quantity, unit_price_paise
                    ) VALUES (?, ?, ?, ?, ?)
                    """.trimIndent(),
                    order.id,
                    line.listingId,
                    line.listingName,
                    line.quantity,
                    line.unitPricePaise,
                )
            }
            insertHistory(order.id, initialHistory)
        } catch (duplicate: DuplicateKeyException) {
            throw CheckoutIdempotencyRace()
        }
    }

    override fun insertReservation(orderId: UUID, listingId: UUID, quantity: Int) {
        jdbc.update(
            """
            INSERT INTO mypet.inventory_reservation (
                id, order_id, listing_id, quantity, status
            ) VALUES (?, ?, ?, ?, 'RESERVED')
            """.trimIndent(),
            UUID.randomUUID(),
            orderId,
            listingId,
            quantity,
        )
    }

    override fun updateReservations(orderId: UUID, status: String) {
        jdbc.update(
            """
            UPDATE mypet.inventory_reservation
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE order_id = ? AND status = 'RESERVED'
            """.trimIndent(),
            status,
            orderId,
        )
    }

    override fun findTransition(orderId: UUID, idempotencyKey: String): OrderHistoryEntry? = jdbc.query(
        """
        SELECT from_status, to_status, actor_id, actor_role, reason, idempotency_key, trace_id, occurred_at
        FROM mypet.product_order_history
        WHERE order_id = ? AND idempotency_key = ?
        """.trimIndent(),
        { result, _ -> history(result) },
        orderId,
        idempotencyKey,
    ).singleOrNull()

    override fun lock(orderId: UUID): ProductOrder {
        val header = jdbc.query(
            """
            SELECT id, order_number, customer_id, organization_id, outlet_id, quote_id, status,
                   fulfilment_mode, payment_method, payment_status, grand_total_paise,
                   platform_fee_paise, merchant_commission_paise, payment_hold_expires_at
            FROM mypet.product_order
            WHERE id = ?
            FOR UPDATE
            """.trimIndent(),
            { result, _ -> header(result) },
            orderId,
        ).singleOrNull() ?: notFound()
        return assemble(header)
    }

    override fun saveTransition(previousStatus: OrderStatus, order: ProductOrder, entry: OrderHistoryEntry) {
        val updated = jdbc.update(
            """
            UPDATE mypet.product_order
            SET status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = ?
            """.trimIndent(),
            order.status.name,
            order.id,
            previousStatus.name,
        )
        if (updated != 1) {
            throw DomainException("ORDER_CONFLICT", "The order changed concurrently; refresh and retry")
        }
        insertHistory(order.id, entry)
    }

    override fun deleteOrder(orderId: UUID) {
        jdbc.update("DELETE FROM mypet.inventory_reservation WHERE order_id = ?", orderId)
        jdbc.update("DELETE FROM mypet.product_order_history WHERE order_id = ?", orderId)
        jdbc.update("DELETE FROM mypet.product_order_line WHERE order_id = ?", orderId)
        jdbc.update("DELETE FROM mypet.product_order WHERE id = ?", orderId)
    }

    override fun get(orderId: UUID): ProductOrder {
        val header = jdbc.query(
            """
            SELECT id, order_number, customer_id, organization_id, outlet_id, quote_id, status,
                   fulfilment_mode, payment_method, payment_status, grand_total_paise,
                   platform_fee_paise, merchant_commission_paise, payment_hold_expires_at
            FROM mypet.product_order
            WHERE id = ?
            """.trimIndent(),
            { result, _ -> header(result) },
            orderId,
        ).singleOrNull() ?: notFound()
        return assemble(header)
    }

    private fun assemble(header: Header): ProductOrder {
        val lines = jdbc.query(
            "SELECT listing_id, quantity FROM mypet.product_order_line WHERE order_id = ? ORDER BY listing_id",
            { result, _ -> result.getObject("listing_id", UUID::class.java) to result.getInt("quantity") },
            header.id,
        ).associate { it }
        val history = jdbc.query(
            """
            SELECT from_status, to_status, actor_id, actor_role, reason, idempotency_key, trace_id, occurred_at
            FROM mypet.product_order_history
            WHERE order_id = ?
            ORDER BY occurred_at, id
            """.trimIndent(),
            { result, _ -> history(result) },
            header.id,
        )
        return ProductOrder(
            id = header.id,
            orderNumber = header.orderNumber,
            customerId = header.customerId,
            organizationId = header.organizationId,
            outletId = header.outletId,
            quoteId = header.quoteId,
            lines = lines,
            grandTotalPaise = header.grandTotalPaise,
            platformFeePaise = header.platformFeePaise,
            merchantCommissionPaise = header.merchantCommissionPaise,
            paymentMethod = header.paymentMethod,
            paymentStatus = header.paymentStatus,
            fulfilmentMode = header.fulfilmentMode,
            status = header.status,
            history = history,
            paymentHoldExpiresAt = header.paymentHoldExpiresAt,
        )
    }

    private fun insertHistory(orderId: UUID, entry: OrderHistoryEntry) {
        jdbc.update(
            """
            INSERT INTO mypet.product_order_history (
                id, order_id, from_status, to_status, actor_id, actor_role, reason,
                idempotency_key, trace_id, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            orderId,
            entry.fromStatus?.name,
            entry.status.name,
            entry.actorId,
            entry.actorRole.name,
            entry.reason,
            entry.commandKey,
            entry.traceId,
            entry.occurredAt,
        )
    }

    private fun header(result: ResultSet): Header = Header(
        id = result.getObject("id", UUID::class.java),
        orderNumber = result.getString("order_number"),
        customerId = result.getObject("customer_id", UUID::class.java),
        organizationId = result.getObject("organization_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        quoteId = result.getObject("quote_id", UUID::class.java),
        status = OrderStatus.valueOf(result.getString("status")),
        fulfilmentMode = result.getString("fulfilment_mode"),
        paymentMethod = result.getString("payment_method"),
        paymentStatus = result.getString("payment_status"),
        grandTotalPaise = result.getLong("grand_total_paise"),
        platformFeePaise = result.getLong("platform_fee_paise"),
        merchantCommissionPaise = result.getLong("merchant_commission_paise"),
        paymentHoldExpiresAt = result.getTimestamp("payment_hold_expires_at")?.toInstant(),
    )

    private fun history(result: ResultSet): OrderHistoryEntry = OrderHistoryEntry(
        status = OrderStatus.valueOf(result.getString("to_status")),
        occurredAt = result.getTimestamp("occurred_at").toInstant(),
        commandKey = result.getString("idempotency_key"),
        fromStatus = result.getString("from_status")?.let(OrderStatus::valueOf),
        actorId = result.getObject("actor_id", UUID::class.java),
        actorRole = Role.valueOf(result.getString("actor_role")),
        reason = result.getString("reason"),
        traceId = result.getString("trace_id"),
    )

    private fun notFound(): Nothing = throw DomainException("ORDER_NOT_FOUND", "The order is unavailable")

    private data class Header(
        val id: UUID,
        val orderNumber: String,
        val customerId: UUID,
        val organizationId: UUID,
        val outletId: UUID,
        val quoteId: UUID,
        val status: OrderStatus,
        val fulfilmentMode: String,
        val paymentMethod: String,
        val paymentStatus: String,
        val grandTotalPaise: Long,
        val platformFeePaise: Long,
        val merchantCommissionPaise: Long,
        val paymentHoldExpiresAt: java.time.Instant?,
    )
}
