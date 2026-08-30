package `in`.mypetnew.commerce.infrastructure

import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.commerce.domain.CommerceListingAuthority
import `in`.mypetnew.commerce.domain.CommerceListingSnapshot
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

class JdbcCommerceListingAuthority(
    private val jdbc: JdbcTemplate,
) : CommerceListingAuthority {
    override fun lockForCommerce(listingIds: Collection<UUID>): Map<UUID, CommerceListingSnapshot> {
        val ordered = listingIds.distinct().sortedBy(UUID::toString)
        if (ordered.isEmpty()) return emptyMap()
        val placeholders = ordered.joinToString(",") { "?" }
        return jdbc.query(
            """
            SELECT id, organization_id, outlet_id, name, commerce_mode, active, selling_price_paise
            FROM mypet.catalog_listing
            WHERE id IN ($placeholders)
            ORDER BY id
            FOR SHARE
            """.trimIndent(),
            { rs, _ ->
                CommerceListingSnapshot(
                    id = rs.getObject("id", UUID::class.java),
                    organizationId = rs.getObject("organization_id", UUID::class.java),
                    outletId = rs.getObject("outlet_id", UUID::class.java),
                    name = rs.getString("name"),
                    commerceMode = CommerceMode.valueOf(rs.getString("commerce_mode")),
                    active = rs.getBoolean("active"),
                    sellingPricePaise = rs.getLong("selling_price_paise"),
                )
            },
            *ordered.toTypedArray(),
        ).associateBy { it.id }
    }
}
