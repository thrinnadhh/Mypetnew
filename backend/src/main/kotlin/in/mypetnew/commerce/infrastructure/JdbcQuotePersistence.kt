package `in`.mypetnew.commerce.infrastructure

import `in`.mypetnew.commerce.domain.PricingSnapshot
import `in`.mypetnew.commerce.domain.Quote
import `in`.mypetnew.commerce.domain.QuotePersistence
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.util.UUID

class JdbcQuotePersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : QuotePersistence {
    override fun save(quote: Quote): Quote = transactions.execute {
        jdbc.update(
            """
            INSERT INTO mypet.commerce_quote (
                id, customer_id, outlet_id, cart_signature, fulfilment_mode, payment_method,
                item_subtotal_paise, platform_fee_paise, merchant_commission_paise,
                delivery_fee_paise, grand_total_paise, currency, rule_version, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            quote.id,
            quote.customerId,
            quote.outletId,
            quote.cartSignature,
            quote.fulfilmentMode,
            quote.paymentMethod,
            quote.pricing.itemSubtotalPaise,
            quote.pricing.platformFeePaise,
            quote.pricing.merchantCommissionPaise,
            quote.pricing.deliveryFeePaise,
            quote.pricing.grandTotalPaise,
            quote.pricing.currency,
            quote.pricing.ruleVersion,
            quote.expiresAt,
        )
        quote.lines.forEach { (listingId, line) ->
            jdbc.update(
                """
                INSERT INTO mypet.quote_line (quote_id, listing_id, quantity, unit_price_paise)
                VALUES (?, ?, ?, ?)
                """.trimIndent(),
                quote.id,
                listingId,
                line.first,
                line.second,
            )
        }
        quote
    } ?: throw IllegalStateException("Quote transaction returned no result")

    override fun get(id: UUID): Quote? {
        val header = jdbc.query(
            """
            SELECT id, customer_id, outlet_id, cart_signature, fulfilment_mode, payment_method,
                   item_subtotal_paise, platform_fee_paise, merchant_commission_paise,
                   delivery_fee_paise, grand_total_paise, currency, rule_version, expires_at
            FROM mypet.commerce_quote
            WHERE id = ?
            """.trimIndent(),
            { result, _ -> header(result) },
            id,
        ).singleOrNull() ?: return null
        val lines = jdbc.query(
            """
            SELECT listing_id, quantity, unit_price_paise
            FROM mypet.quote_line
            WHERE quote_id = ?
            ORDER BY listing_id
            """.trimIndent(),
            { result, _ ->
                result.getObject("listing_id", UUID::class.java) to
                    Pair(result.getInt("quantity"), result.getLong("unit_price_paise"))
            },
            id,
        ).toMap()
        return Quote(
            id = header.id,
            customerId = header.customerId,
            outletId = header.outletId,
            lines = lines,
            cartSignature = header.cartSignature,
            fulfilmentMode = header.fulfilmentMode,
            paymentMethod = header.paymentMethod,
            pricing = PricingSnapshot(
                itemSubtotalPaise = header.itemSubtotalPaise,
                platformFeePaise = header.platformFeePaise,
                deliveryFeePaise = header.deliveryFeePaise,
                merchantCommissionPaise = header.merchantCommissionPaise,
                grandTotalPaise = header.grandTotalPaise,
                currency = header.currency,
                ruleVersion = header.ruleVersion,
            ),
            expiresAt = header.expiresAt,
        )
    }

    private fun header(result: ResultSet): Header = Header(
        id = result.getObject("id", UUID::class.java),
        customerId = result.getObject("customer_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        cartSignature = result.getString("cart_signature"),
        fulfilmentMode = result.getString("fulfilment_mode"),
        paymentMethod = result.getString("payment_method"),
        itemSubtotalPaise = result.getLong("item_subtotal_paise"),
        platformFeePaise = result.getLong("platform_fee_paise"),
        merchantCommissionPaise = result.getLong("merchant_commission_paise"),
        deliveryFeePaise = result.getLong("delivery_fee_paise"),
        grandTotalPaise = result.getLong("grand_total_paise"),
        currency = result.getString("currency"),
        ruleVersion = result.getString("rule_version"),
        expiresAt = result.getTimestamp("expires_at").toInstant(),
    )

    private data class Header(
        val id: UUID,
        val customerId: UUID,
        val outletId: UUID,
        val cartSignature: String,
        val fulfilmentMode: String,
        val paymentMethod: String,
        val itemSubtotalPaise: Long,
        val platformFeePaise: Long,
        val merchantCommissionPaise: Long,
        val deliveryFeePaise: Long,
        val grandTotalPaise: Long,
        val currency: String,
        val ruleVersion: String,
        val expiresAt: java.time.Instant,
    )
}
