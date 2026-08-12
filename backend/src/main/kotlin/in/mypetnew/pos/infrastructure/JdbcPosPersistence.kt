package `in`.mypetnew.pos.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.pos.domain.PaymentDeclaration
import `in`.mypetnew.pos.domain.PersistedPosSale
import `in`.mypetnew.pos.domain.PosIdempotencyRace
import `in`.mypetnew.pos.domain.PosPersistence
import `in`.mypetnew.pos.domain.PosSale
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.util.UUID

class JdbcPosPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : PosPersistence {
    override val rollsBackOnFailure: Boolean = true

    override fun <T> inTransaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("POS transaction returned no result")

    override fun find(outletId: UUID, idempotencyKey: String): PersistedPosSale? {
        val row = jdbc.query(
            """
            SELECT id, request_fingerprint
            FROM mypet.pos_sale
            WHERE outlet_id = ? AND idempotency_key = ?
            """.trimIndent(),
            { result, _ -> result.getObject("id", UUID::class.java) to result.getString("request_fingerprint") },
            outletId,
            idempotencyKey,
        ).singleOrNull() ?: return null
        return PersistedPosSale(row.second, get(row.first))
    }

    override fun insert(
        sale: PosSale,
        listingNames: Map<UUID, String>,
        idempotencyKey: String,
        requestFingerprint: String,
    ) {
        try {
            jdbc.update(
                """
                INSERT INTO mypet.pos_sale (
                    id, sale_number, organization_id, outlet_id, customer_id, cashier_id,
                    total_paise, currency, payment_declaration, idempotency_key,
                    request_fingerprint, loyalty_awarded, trace_id, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                sale.id,
                saleNumber(sale.id),
                sale.merchantId,
                sale.outletId,
                sale.customerId,
                sale.cashierId,
                sale.totalPaise,
                sale.paymentDeclaration.name,
                idempotencyKey,
                requestFingerprint,
                sale.loyaltyAwarded,
                sale.traceId,
                sale.completedAt,
            )
            sale.lines.forEach { (listingId, line) ->
                jdbc.update(
                    """
                    INSERT INTO mypet.pos_sale_line (
                        sale_id, listing_id, listing_name, quantity, unit_price_paise
                    ) VALUES (?, ?, ?, ?, ?)
                    """.trimIndent(),
                    sale.id,
                    listingId,
                    listingNames.getValue(listingId),
                    line.first,
                    line.second,
                )
            }
        } catch (duplicate: DuplicateKeyException) {
            throw PosIdempotencyRace()
        }
    }

    override fun updateLoyaltyResult(saleId: UUID, awarded: Boolean) {
        val updated = jdbc.update(
            "UPDATE mypet.pos_sale SET loyalty_awarded = ? WHERE id = ?",
            awarded,
            saleId,
        )
        if (updated != 1) notFound()
    }

    override fun delete(saleId: UUID) {
        jdbc.update("DELETE FROM mypet.pos_sale_line WHERE sale_id = ?", saleId)
        jdbc.update("DELETE FROM mypet.pos_sale WHERE id = ?", saleId)
    }

    override fun get(saleId: UUID): PosSale {
        val header = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, customer_id, cashier_id, total_paise,
                   payment_declaration, completed_at, loyalty_awarded, trace_id
            FROM mypet.pos_sale
            WHERE id = ?
            """.trimIndent(),
            { result, _ -> header(result) },
            saleId,
        ).singleOrNull() ?: notFound()
        val lines = jdbc.query(
            """
            SELECT listing_id, quantity, unit_price_paise
            FROM mypet.pos_sale_line
            WHERE sale_id = ?
            ORDER BY listing_id
            """.trimIndent(),
            { result, _ ->
                result.getObject("listing_id", UUID::class.java) to
                    Pair(result.getInt("quantity"), result.getLong("unit_price_paise"))
            },
            saleId,
        ).toMap()
        return PosSale(
            id = header.id,
            merchantId = header.merchantId,
            outletId = header.outletId,
            customerId = header.customerId,
            lines = lines,
            totalPaise = header.totalPaise,
            paymentDeclaration = header.paymentDeclaration,
            completedAt = header.completedAt,
            loyaltyAwarded = header.loyaltyAwarded,
            cashierId = header.cashierId,
            traceId = header.traceId,
        )
    }

    private fun saleNumber(id: UUID): String = "POS-${id.toString().replace("-", "").take(12).uppercase()}"

    private fun header(result: ResultSet): Header = Header(
        id = result.getObject("id", UUID::class.java),
        merchantId = result.getObject("organization_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        customerId = result.getObject("customer_id", UUID::class.java),
        cashierId = result.getObject("cashier_id", UUID::class.java),
        totalPaise = result.getLong("total_paise"),
        paymentDeclaration = PaymentDeclaration.valueOf(result.getString("payment_declaration")),
        completedAt = result.getTimestamp("completed_at").toInstant(),
        loyaltyAwarded = result.getBoolean("loyalty_awarded"),
        traceId = result.getString("trace_id"),
    )

    private fun notFound(): Nothing = throw DomainException("POS_SALE_NOT_FOUND", "The POS sale is unavailable")

    private data class Header(
        val id: UUID,
        val merchantId: UUID,
        val outletId: UUID,
        val customerId: UUID?,
        val cashierId: UUID,
        val totalPaise: Long,
        val paymentDeclaration: PaymentDeclaration,
        val completedAt: java.time.Instant,
        val loyaltyAwarded: Boolean,
        val traceId: String,
    )
}
