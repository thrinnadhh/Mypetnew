package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.MAX_PUBLIC_CART_REVALIDATION_LINES
import `in`.mypetnew.catalog.domain.PublicCatalogReadPage
import `in`.mypetnew.catalog.domain.PublicCatalogReadQuery
import `in`.mypetnew.catalog.domain.PublicCatalogReadRepository
import `in`.mypetnew.catalog.domain.PublicCatalogReadRow
import `in`.mypetnew.common.error.DomainException
import org.springframework.jdbc.core.JdbcTemplate
import java.sql.ResultSet
import java.util.UUID

class JdbcPublicCatalogReadRepository(
    private val jdbc: JdbcTemplate,
) : PublicCatalogReadRepository {
    override fun search(query: PublicCatalogReadQuery): PublicCatalogReadPage {
        val where = mutableListOf(
            "l.active = TRUE",
            "o.status = 'ACTIVE'",
        )
        val parameters = mutableListOf<Any>()

        query.pincode?.let { pincode ->
            where += "EXISTS (SELECT 1 FROM mypet.outlet_service_pincode sp WHERE sp.outlet_id = o.id AND sp.pincode = ? AND sp.active = TRUE)"
            parameters += pincode
        }
        query.outletId?.let { where += "l.outlet_id = ?"; parameters += it }
        query.kind?.let { where += "l.listing_kind = ?"; parameters += it.name }
        query.category?.let { where += "LOWER(l.category) = ?"; parameters += it }
        query.brand?.let { where += "LOWER(COALESCE(l.brand, '')) = ?"; parameters += it }
        query.petType?.let { where += "LOWER(COALESCE(l.pet_type, '')) = ?"; parameters += it }
        query.lifeStage?.let { where += "LOWER(COALESCE(l.life_stage, '')) = ?"; parameters += it }
        query.commerceMode?.let { where += "l.commerce_mode = ?"; parameters += it.name }
        query.search?.let { term ->
            val pattern = "%${escapeLike(term.lowercase())}%"
            where += "(LOWER(l.name) LIKE ? ESCAPE '!' OR LOWER(l.category) LIKE ? ESCAPE '!' OR LOWER(COALESCE(l.brand, '')) LIKE ? ESCAPE '!' OR LOWER(o.name) LIKE ? ESCAPE '!')"
            repeat(4) { parameters += pattern }
        }

        val availableExpression = "GREATEST(COALESCE(b.on_hand, 0) - COALESCE(b.reserved, 0), 0)"
        when (query.availability) {
            "IN_STOCK" -> where += "$availableExpression > 0"
            "OUT_OF_STOCK" -> where += "$availableExpression = 0"
            "ANY", null -> Unit
            else -> throw DomainException("CATALOG_AVAILABILITY_INVALID", "Catalog availability filter is invalid")
        }

        val orderBy = when (query.sort) {
            "NAME" -> "LOWER(l.name) ASC, l.id ASC"
            "PRICE_ASC" -> "l.selling_price_paise ASC, LOWER(l.name) ASC, l.id ASC"
            "PRICE_DESC" -> "l.selling_price_paise DESC, LOWER(l.name) ASC, l.id ASC"
            "NEWEST" -> "l.created_at DESC, LOWER(l.name) ASC, l.id ASC"
            else -> throw DomainException("CATALOG_SORT_INVALID", "Catalog sort option is invalid")
        }

        val offset = query.page.toLong() * query.pageSize.toLong()
        parameters += query.pageSize + 1
        parameters += offset
        val rows = jdbc.query(
            """
            SELECT ${columns(serviceabilitySql = "TRUE")},
                   image.image_url AS primary_image_url
            FROM mypet.catalog_listing l
            JOIN mypet.provider_outlet o ON o.id = l.outlet_id AND o.organization_id = l.organization_id
            LEFT JOIN mypet.inventory_balance b
              ON b.organization_id = l.organization_id AND b.outlet_id = l.outlet_id AND b.listing_id = l.id
            LEFT JOIN mypet.catalog_listing_image image ON image.listing_id = l.id AND image.position = 0
            WHERE ${where.joinToString(" AND ")}
            ORDER BY $orderBy
            LIMIT ? OFFSET ?
            """.trimIndent(),
            { rs, _ -> mapRow(rs, listOfNotNull(rs.getString("primary_image_url"))) },
            *parameters.toTypedArray(),
        )
        return PublicCatalogReadPage(
            items = rows.take(query.pageSize),
            page = query.page,
            pageSize = query.pageSize,
            hasNext = rows.size > query.pageSize,
        )
    }

    override fun detail(listingId: UUID, pincode: String?): PublicCatalogReadRow? {
        val serviceability = if (pincode == null) {
            "TRUE"
        } else {
            "EXISTS (SELECT 1 FROM mypet.outlet_service_pincode sp WHERE sp.outlet_id = o.id AND sp.pincode = ? AND sp.active = TRUE)"
        }
        val parameters = mutableListOf<Any>()
        if (pincode != null) parameters += pincode
        parameters += listingId
        val row = jdbc.query(
            """
            SELECT ${columns(serviceability)}
            FROM mypet.catalog_listing l
            JOIN mypet.provider_outlet o ON o.id = l.outlet_id AND o.organization_id = l.organization_id
            LEFT JOIN mypet.inventory_balance b
              ON b.organization_id = l.organization_id AND b.outlet_id = l.outlet_id AND b.listing_id = l.id
            WHERE l.id = ?
            """.trimIndent(),
            { rs, _ -> mapRow(rs, emptyList()) },
            *parameters.toTypedArray(),
        ).singleOrNull() ?: return null
        return row.copy(imageUrls = imagesFor(listOf(listingId))[listingId].orEmpty())
    }

    override fun snapshots(listingIds: Collection<UUID>, pincode: String): Map<UUID, PublicCatalogReadRow> {
        val ordered = listingIds.distinct().sortedBy(UUID::toString)
        if (ordered.isEmpty()) return emptyMap()
        if (ordered.size > MAX_PUBLIC_CART_REVALIDATION_LINES) {
            throw DomainException("CART_REVALIDATION_LIMIT_EXCEEDED", "Too many cart lines were supplied")
        }
        val placeholders = ordered.joinToString(",") { "?" }
        val rows = jdbc.query(
            """
            SELECT ${columns("EXISTS (SELECT 1 FROM mypet.outlet_service_pincode sp WHERE sp.outlet_id = o.id AND sp.pincode = ? AND sp.active = TRUE)")}
            FROM mypet.catalog_listing l
            JOIN mypet.provider_outlet o ON o.id = l.outlet_id AND o.organization_id = l.organization_id
            LEFT JOIN mypet.inventory_balance b
              ON b.organization_id = l.organization_id AND b.outlet_id = l.outlet_id AND b.listing_id = l.id
            WHERE l.id IN ($placeholders)
            ORDER BY l.id ASC
            """.trimIndent(),
            { rs, _ -> mapRow(rs, emptyList()) },
            pincode,
            *ordered.toTypedArray(),
        )
        val images = imagesFor(rows.map { it.id })
        return rows.associate { row -> row.id to row.copy(imageUrls = images[row.id].orEmpty()) }
    }

    private fun imagesFor(listingIds: Collection<UUID>): Map<UUID, List<String>> {
        val ordered = listingIds.distinct().sortedBy(UUID::toString)
        if (ordered.isEmpty()) return emptyMap()
        val placeholders = ordered.joinToString(",") { "?" }
        return jdbc.query(
            """
            SELECT listing_id, image_url
            FROM mypet.catalog_listing_image
            WHERE listing_id IN ($placeholders)
            ORDER BY listing_id ASC, position ASC
            """.trimIndent(),
            { rs, _ -> rs.getObject("listing_id", UUID::class.java) to rs.getString("image_url") },
            *ordered.toTypedArray(),
        ).groupBy({ it.first }, { it.second })
    }

    private fun mapRow(rs: ResultSet, imageUrls: List<String>): PublicCatalogReadRow = PublicCatalogReadRow(
        id = rs.getObject("id", UUID::class.java),
        organizationId = rs.getObject("organization_id", UUID::class.java),
        outletId = rs.getObject("outlet_id", UUID::class.java),
        outletName = rs.getString("outlet_name"),
        name = rs.getString("name"),
        kind = ListingKind.valueOf(rs.getString("listing_kind")),
        category = rs.getString("category"),
        brand = rs.getString("brand"),
        description = rs.getString("description"),
        petType = rs.getString("pet_type"),
        lifeStage = rs.getString("life_stage"),
        packLabel = rs.getString("pack_label"),
        sku = rs.getString("sku"),
        mrpPaise = rs.getLong("mrp_paise"),
        sellingPricePaise = rs.getLong("selling_price_paise"),
        commerceMode = CommerceMode.valueOf(rs.getString("commerce_mode")),
        availableQuantity = rs.getInt("available_quantity"),
        pickupEnabled = rs.getBoolean("pickup_enabled"),
        listingActive = rs.getBoolean("listing_active"),
        outletActive = rs.getBoolean("outlet_active"),
        serviceable = rs.getBoolean("serviceable"),
        imageUrls = imageUrls,
        createdAt = rs.getTimestamp("created_at").toInstant(),
    )

    private fun columns(serviceabilitySql: String): String = """
        l.id,
        l.organization_id,
        l.outlet_id,
        o.name AS outlet_name,
        l.name,
        l.listing_kind,
        l.category,
        l.brand,
        l.description,
        l.pet_type,
        l.life_stage,
        l.pack_label,
        l.sku,
        l.mrp_paise,
        l.selling_price_paise,
        l.commerce_mode,
        GREATEST(COALESCE(b.on_hand, 0) - COALESCE(b.reserved, 0), 0) AS available_quantity,
        o.pickup_enabled,
        l.active AS listing_active,
        (o.status = 'ACTIVE') AS outlet_active,
        ($serviceabilitySql) AS serviceable,
        l.created_at
    """.trimIndent()

    private fun escapeLike(value: String): String = value
        .replace("!", "!!")
        .replace("%", "!%")
        .replace("_", "!_")
}
