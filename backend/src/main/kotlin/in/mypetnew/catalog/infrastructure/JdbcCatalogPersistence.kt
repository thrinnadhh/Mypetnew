package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogPersistence
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.error.DomainException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID

class JdbcCatalogPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : CatalogPersistence {
    override fun create(
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
        actionKey: String,
        requestFingerprint: String,
    ): Listing {
        try {
            return transactions.execute {
                replay(command.outletId, actionKey, requestFingerprint)?.let { return@execute it }
                findByBarcode(command, normalizedBarcode)?.let { return@execute it }
                val now = Instant.now()
                val listing = Listing(
                    id = UUID.randomUUID(),
                    organizationId = command.organizationId,
                    outletId = command.outletId,
                    barcodeType = command.barcodeType,
                    normalizedBarcode = normalizedBarcode,
                    name = command.name.trim(),
                    kind = command.kind,
                    commerceMode = commerceMode,
                    mrpPaise = command.mrpPaise,
                    sellingPricePaise = command.sellingPricePaise,
                    category = command.category,
                    brand = command.brand,
                    description = command.description,
                    petType = command.petType,
                    lifeStage = command.lifeStage,
                    packLabel = command.packLabel,
                    sku = command.sku,
                    imageUrls = command.imageUrls,
                    createdAt = now,
                )
                jdbc.update(
                    """
                    INSERT INTO mypet.catalog_listing (
                        id, organization_id, outlet_id, barcode_type, normalized_barcode,
                        raw_barcode_audit, name, listing_kind, commerce_mode, mrp_paise,
                        selling_price_paise, category, brand, description, pet_type,
                        life_stage, pack_label, sku, active, version, create_idempotency_key,
                        create_request_fingerprint, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 0, ?, ?, ?, ?)
                    """.trimIndent(),
                    listing.id,
                    listing.organizationId,
                    listing.outletId,
                    listing.barcodeType.name,
                    listing.normalizedBarcode,
                    command.barcode.take(128),
                    listing.name,
                    listing.kind.name,
                    listing.commerceMode.name,
                    listing.mrpPaise,
                    listing.sellingPricePaise,
                    listing.category,
                    listing.brand,
                    listing.description,
                    listing.petType,
                    listing.lifeStage,
                    listing.packLabel,
                    listing.sku,
                    actionKey,
                    requestFingerprint,
                    java.sql.Timestamp.from(now),
                    java.sql.Timestamp.from(now),
                )
                listing.imageUrls.forEachIndexed { position, url ->
                    jdbc.update(
                        """
                        INSERT INTO mypet.catalog_listing_image (listing_id, position, image_url)
                        VALUES (?, ?, ?)
                        """.trimIndent(),
                        listing.id,
                        position,
                        url,
                    )
                }
                listing
            }
        } catch (duplicate: DuplicateKeyException) {
            replay(command.outletId, actionKey, requestFingerprint)?.let { return it }
            findByBarcode(command, normalizedBarcode)?.let { return it }
            throw DomainException("CATALOG_CONFLICT", "The listing changed concurrently; refresh and retry")
        }
    }

    override fun get(listingId: UUID): Listing? {
        val row = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                   name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                   category, brand, description, pet_type, life_stage, pack_label, sku, created_at
            FROM mypet.catalog_listing
            WHERE id = ? AND active = TRUE
            """.trimIndent(),
            { result, _ -> mapRow(result) },
            listingId,
        ).singleOrNull() ?: return null

        val images = fetchImagesForListings(listOf(listingId))[listingId].orEmpty()
        return listing(row, images)
    }

    override fun all(): List<Listing> {
        val rows = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                   name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                   category, brand, description, pet_type, life_stage, pack_label, sku, created_at
            FROM mypet.catalog_listing
            WHERE active = TRUE
            ORDER BY id
            """.trimIndent(),
        ) { result, _ -> mapRow(result) }

        if (rows.isEmpty()) return emptyList()

        val ids = rows.map { it.id }
        val imagesMap = fetchImagesForListings(ids)
        return rows.map { listing(it, imagesMap[it.id].orEmpty()) }
    }

    private fun replay(outletId: UUID, actionKey: String, requestFingerprint: String): Listing? {
        val pair = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                   name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                   category, brand, description, pet_type, life_stage, pack_label, sku, created_at,
                   create_request_fingerprint
            FROM mypet.catalog_listing
            WHERE outlet_id = ? AND create_idempotency_key = ?
            """.trimIndent(),
            { result, _ -> mapRow(result) to result.getString("create_request_fingerprint") },
            outletId,
            actionKey,
        ).singleOrNull() ?: return null

        if (pair.second != requestFingerprint) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        val row = pair.first
        val images = fetchImagesForListings(listOf(row.id))[row.id].orEmpty()
        return listing(row, images)
    }

    private fun findByBarcode(command: CreateListingCommand, normalizedBarcode: String): Listing? {
        val row = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                   name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                   category, brand, description, pet_type, life_stage, pack_label, sku, created_at
            FROM mypet.catalog_listing
            WHERE organization_id = ? AND outlet_id = ? AND barcode_type = ? AND normalized_barcode = ?
            """.trimIndent(),
            { result, _ -> mapRow(result) },
            command.organizationId,
            command.outletId,
            command.barcodeType.name,
            normalizedBarcode,
        ).singleOrNull() ?: return null

        val images = fetchImagesForListings(listOf(row.id))[row.id].orEmpty()
        return listing(row, images)
    }

    private fun fetchImagesForListings(listingIds: Collection<UUID>): Map<UUID, List<String>> {
        if (listingIds.isEmpty()) return emptyMap()
        val map = mutableMapOf<UUID, MutableList<String>>()
        val placeholders = listingIds.joinToString(",") { "?" }
        jdbc.query(
            """
            SELECT listing_id, image_url
            FROM mypet.catalog_listing_image
            WHERE listing_id IN ($placeholders)
            ORDER BY listing_id, position ASC
            """.trimIndent(),
            { rs ->
                val id = rs.getObject("listing_id", UUID::class.java)
                val url = rs.getString("image_url")
                map.getOrPut(id) { mutableListOf() }.add(url)
            },
            *listingIds.toTypedArray(),
        )
        return map
    }

    private data class ListingRow(
        val id: UUID,
        val organizationId: UUID,
        val outletId: UUID,
        val barcodeType: BarcodeType,
        val normalizedBarcode: String,
        val name: String,
        val kind: ListingKind,
        val commerceMode: CommerceMode,
        val mrpPaise: Long,
        val sellingPricePaise: Long,
        val category: String,
        val brand: String?,
        val description: String?,
        val petType: String?,
        val lifeStage: String?,
        val packLabel: String?,
        val sku: String?,
        val createdAt: Instant,
    )

    private fun mapRow(rs: ResultSet): ListingRow = ListingRow(
        id = rs.getObject("id", UUID::class.java),
        organizationId = rs.getObject("organization_id", UUID::class.java),
        outletId = rs.getObject("outlet_id", UUID::class.java),
        barcodeType = BarcodeType.valueOf(rs.getString("barcode_type")),
        normalizedBarcode = rs.getString("normalized_barcode"),
        name = rs.getString("name"),
        kind = ListingKind.valueOf(rs.getString("listing_kind")),
        commerceMode = CommerceMode.valueOf(rs.getString("commerce_mode")),
        mrpPaise = rs.getLong("mrp_paise"),
        sellingPricePaise = rs.getLong("selling_price_paise"),
        category = rs.getString("category") ?: "other",
        brand = rs.getString("brand"),
        description = rs.getString("description"),
        petType = rs.getString("pet_type"),
        lifeStage = rs.getString("life_stage"),
        packLabel = rs.getString("pack_label"),
        sku = rs.getString("sku"),
        createdAt = rs.getTimestamp("created_at")?.toInstant() ?: Instant.now(),
    )

    private fun listing(row: ListingRow, imageUrls: List<String>): Listing = Listing(
        id = row.id,
        organizationId = row.organizationId,
        outletId = row.outletId,
        barcodeType = row.barcodeType,
        normalizedBarcode = row.normalizedBarcode,
        name = row.name,
        kind = row.kind,
        commerceMode = row.commerceMode,
        mrpPaise = row.mrpPaise,
        sellingPricePaise = row.sellingPricePaise,
        category = row.category,
        brand = row.brand,
        description = row.description,
        petType = row.petType,
        lifeStage = row.lifeStage,
        packLabel = row.packLabel,
        sku = row.sku,
        imageUrls = imageUrls,
        createdAt = row.createdAt,
    )
}
