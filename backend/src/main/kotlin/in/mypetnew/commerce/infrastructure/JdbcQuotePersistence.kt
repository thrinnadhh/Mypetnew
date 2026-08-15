package `in`.mypetnew.commerce.infrastructure

import `in`.mypetnew.commerce.domain.DeliveryAddressSnapshot
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
                delivery_fee_paise, grand_total_paise, currency, rule_version, expires_at,
                delivery_address_id, delivery_recipient_name, delivery_phone_number,
                delivery_line1, delivery_line2, delivery_city, delivery_state, delivery_pincode,
                delivery_eta_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            quote.deliveryAddress?.addressId,
            quote.deliveryAddress?.recipientName,
            quote.deliveryAddress?.phoneNumber,
            quote.deliveryAddress?.line1,
            quote.deliveryAddress?.line2,
            quote.deliveryAddress?.city,
            quote.deliveryAddress?.state,
            quote.deliveryAddress?.pincode,
            quote.etaMinutes,
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
    }

    override fun get(id: UUID): Quote? {
        val header = jdbc.query(
            """
            SELECT id, customer_id, outlet_id, cart_signature, fulfilment_mode, payment_method,
                   item_subtotal_paise, platform_fee_paise, merchant_commission_paise,
                   delivery_fee_paise, grand_total_paise, currency, rule_version, expires_at,
                   delivery_address_id, delivery_recipient_name, delivery_phone_number,
                   delivery_line1, delivery_line2, delivery_city, delivery_state, delivery_pincode,
                   delivery_eta_minutes
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
            deliveryAddress = header.deliveryAddressId?.let { addressId ->
                DeliveryAddressSnapshot(
                    addressId = addressId,
                    recipientName = requireNotNull(header.deliveryRecipientName),
                    phoneNumber = requireNotNull(header.deliveryPhoneNumber),
                    line1 = requireNotNull(header.deliveryLine1),
                    line2 = header.deliveryLine2,
                    city = requireNotNull(header.deliveryCity),
                    state = requireNotNull(header.deliveryState),
                    pincode = requireNotNull(header.deliveryPincode),
                )
            },
            etaMinutes = header.deliveryEtaMinutes,
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
        deliveryAddressId = result.getObject("delivery_address_id", UUID::class.java),
        deliveryRecipientName = result.getString("delivery_recipient_name"),
        deliveryPhoneNumber = result.getString("delivery_phone_number"),
        deliveryLine1 = result.getString("delivery_line1"),
        deliveryLine2 = result.getString("delivery_line2"),
        deliveryCity = result.getString("delivery_city"),
        deliveryState = result.getString("delivery_state"),
        deliveryPincode = result.getString("delivery_pincode"),
        deliveryEtaMinutes = result.getObject("delivery_eta_minutes", Int::class.javaObjectType),
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
        val deliveryAddressId: UUID?,
        val deliveryRecipientName: String?,
        val deliveryPhoneNumber: String?,
        val deliveryLine1: String?,
        val deliveryLine2: String?,
        val deliveryCity: String?,
        val deliveryState: String?,
        val deliveryPincode: String?,
        val deliveryEtaMinutes: Int?,
    )
}
