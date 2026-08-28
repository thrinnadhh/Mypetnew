package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.InventoryBalance
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.domain.MerchantSyncBootstrapResponse
import `in`.mypetnew.catalog.domain.MerchantSyncChange
import `in`.mypetnew.catalog.domain.MerchantSyncChangePage
import `in`.mypetnew.catalog.domain.MerchantSyncFeedService
import `in`.mypetnew.catalog.domain.MerchantSyncPublisher
import `in`.mypetnew.catalog.domain.SyncEntityType
import `in`.mypetnew.common.error.DomainException
import jakarta.annotation.PostConstruct
import org.springframework.beans.factory.annotation.Value
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper
import java.security.MessageDigest
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

@Service
class JdbcMerchantSyncFeed(
    private val jdbc: JdbcTemplate,
    private val json: ObjectMapper = ObjectMapper(),
    @param:Value("\${mypet.sync.cursor-secret:\${MYPET_SYNC_CURSOR_SECRET:}}")
    private val cursorSecret: String = "",
) : MerchantSyncPublisher, MerchantSyncFeedService {

    companion object {
        const val MAX_PAGE_SIZE = 250
        const val CURSOR_PREFIX = "msc_v2:"
        const val BOOTSTRAP_CURSOR_PREFIX = "msb_v2:"
        // Cursor older than 90 days or negative sequence is considered expired/invalid
        const val MAX_CURSOR_AGE_SECONDS = 90L * 24 * 60 * 60
        // Active bootstrap session cursor max age 2 hours
        const val MAX_BOOTSTRAP_SESSION_AGE_SECONDS = 2L * 60 * 60
    }

    @PostConstruct
    fun validateSecret() {
        if (cursorSecret.isBlank() || cursorSecret.length < 32) {
            throw IllegalStateException("mypet.sync.cursor-secret must be configured with a secure key of at least 32 characters")
        }
    }

    override fun publishCatalogItemChange(listing: Listing, isTombstone: Boolean) {
        val payloadMap = mapOf(
            "id" to listing.id.toString(),
            "organizationId" to listing.organizationId.toString(),
            "outletId" to listing.outletId.toString(),
            "barcodeType" to listing.barcodeType.name,
            "normalizedBarcode" to listing.normalizedBarcode,
            "name" to listing.name,
            "kind" to listing.kind.name,
            "commerceMode" to listing.commerceMode.name,
            "mrpPaise" to listing.mrpPaise,
            "sellingPricePaise" to listing.sellingPricePaise,
            "category" to listing.category,
            "brand" to listing.brand,
            "description" to listing.description,
            "petType" to listing.petType,
            "lifeStage" to listing.lifeStage,
            "packLabel" to listing.packLabel,
            "sku" to listing.sku,
            "imageUrls" to listing.imageUrls,
            "status" to listing.status.name,
            "version" to listing.version,
            "createdAt" to listing.createdAt.toString(),
            "updatedAt" to listing.updatedAt.toString(),
            "isTombstone" to isTombstone,
        )
        val payloadJson = json.writeValueAsString(payloadMap)
        val now = Timestamp.from(Instant.now())
        jdbc.update(
            """
            INSERT INTO mypet.merchant_sync_change_log (
                organization_id, outlet_id, entity_type, entity_id, entity_version,
                is_tombstone, payload, schema_version, created_at
            ) VALUES (?, ?, 'CATALOG_ITEM', ?, ?, ?, ?, 1, ?)
            """.trimIndent(),
            listing.organizationId,
            listing.outletId,
            listing.id,
            listing.version,
            isTombstone,
            payloadJson,
            now,
        )
    }

    override fun publishBarcodeChange(
        organizationId: UUID,
        outletId: UUID,
        listingId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
        isPrimary: Boolean,
        isTombstone: Boolean,
        updatedAt: Instant,
    ) {
        val payloadMap = mapOf(
            "organizationId" to organizationId.toString(),
            "outletId" to outletId.toString(),
            "listingId" to listingId.toString(),
            "barcodeType" to barcodeType.name,
            "normalizedBarcode" to normalizedBarcode,
            "isPrimary" to isPrimary,
            "isTombstone" to isTombstone,
            "updatedAt" to updatedAt.toString(),
        )
        val payloadJson = json.writeValueAsString(payloadMap)
        val now = Timestamp.from(Instant.now())
        jdbc.update(
            """
            INSERT INTO mypet.merchant_sync_change_log (
                organization_id, outlet_id, entity_type, entity_id, entity_version,
                is_tombstone, payload, schema_version, created_at
            ) VALUES (?, ?, 'CATALOG_BARCODE', ?, 0, ?, ?, 1, ?)
            """.trimIndent(),
            organizationId,
            outletId,
            listingId,
            isTombstone,
            payloadJson,
            now,
        )
    }

    override fun publishInventoryBalanceChange(balance: InventoryBalance, isTombstone: Boolean) {
        val payloadMap = mapOf(
            "organizationId" to balance.organizationId.toString(),
            "outletId" to balance.outletId.toString(),
            "listingId" to balance.listingId.toString(),
            "onHand" to balance.onHand,
            "reserved" to balance.reserved,
            "version" to balance.version,
            "updatedAt" to balance.updatedAt.toString(),
            "isTombstone" to isTombstone,
        )
        val payloadJson = json.writeValueAsString(payloadMap)
        val now = Timestamp.from(Instant.now())
        jdbc.update(
            """
            INSERT INTO mypet.merchant_sync_change_log (
                organization_id, outlet_id, entity_type, entity_id, entity_version,
                is_tombstone, payload, schema_version, created_at
            ) VALUES (?, ?, 'INVENTORY_BALANCE', ?, ?, ?, ?, 1, ?)
            """.trimIndent(),
            balance.organizationId,
            balance.outletId,
            balance.listingId,
            balance.version,
            isTombstone,
            payloadJson,
            now,
        )
    }

    override fun fetchChanges(
        organizationId: UUID,
        outletId: UUID,
        cursor: String?,
        limit: Int,
    ): MerchantSyncChangePage {
        val boundedLimit = limit.coerceIn(1, MAX_PAGE_SIZE)
        val requestedSequence = if (cursor.isNullOrBlank()) {
            0L
        } else {
            decodeCursor(cursor, organizationId, outletId)
        }

        val rows = jdbc.query(
            """
            SELECT sequence_number, organization_id, outlet_id, entity_type, entity_id,
                   entity_version, is_tombstone, payload, schema_version, created_at
            FROM mypet.merchant_sync_change_log
            WHERE organization_id = ? AND outlet_id = ? AND sequence_number > ?
            ORDER BY sequence_number ASC
            LIMIT ?
            """.trimIndent(),
            { rs, _ -> mapChangeRow(rs) },
            organizationId,
            outletId,
            requestedSequence,
            boundedLimit + 1,
        )

        val hasMore = rows.size > boundedLimit
        val changes = if (hasMore) rows.take(boundedLimit) else rows
        val lastSeq = changes.lastOrNull()?.sequenceNumber ?: requestedSequence
        val nextCursor = if (changes.isNotEmpty()) encodeCursor(organizationId, outletId, lastSeq) else cursor
        val highWater = currentHighWaterCursor(organizationId, outletId)

        return MerchantSyncChangePage(
            changes = changes,
            nextCursor = nextCursor,
            hasMore = hasMore,
            currentHighWaterCursor = highWater,
            serverTime = Instant.now(),
        )
    }

    @Transactional(readOnly = true)
    open fun captureBootstrapHighWater(organizationId: UUID, outletId: UUID): Long {
        return jdbc.queryForObject(
            """
            SELECT COALESCE(MAX(sequence_number), 0)
            FROM mypet.merchant_sync_change_log
            WHERE organization_id = ? AND outlet_id = ?
            """.trimIndent(),
            Long::class.java,
            organizationId,
            outletId,
        ) ?: 0L
    }

    override fun fetchBootstrap(
        organizationId: UUID,
        outletId: UUID,
        cursor: String?,
        limit: Int,
    ): MerchantSyncBootstrapResponse {
        val boundedLimit = limit.coerceIn(1, MAX_PAGE_SIZE)

        val (highWaterSeq, lastListingId) = if (cursor.isNullOrBlank()) {
            val h = captureBootstrapHighWater(organizationId, outletId)
            h to null
        } else {
            decodeBootstrapCursor(cursor, organizationId, outletId)
        }

        val highWaterCursor = encodeCursor(organizationId, outletId, highWaterSeq)

        val listingRowMapper = { rs: ResultSet, _: Int ->
            ListingRowData(
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
                category = rs.getString("category"),
                brand = rs.getString("brand"),
                description = rs.getString("description"),
                petType = rs.getString("pet_type"),
                lifeStage = rs.getString("life_stage"),
                packLabel = rs.getString("pack_label"),
                sku = rs.getString("sku"),
                active = rs.getBoolean("active"),
                version = rs.getLong("version"),
                createdAt = rs.getTimestamp("created_at").toInstant(),
                updatedAt = rs.getTimestamp("updated_at").toInstant(),
            )
        }

        // Query listings with keyset pagination by id
        val listingRows = if (lastListingId == null) {
            jdbc.query(
                """
                SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                       name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                       category, brand, description, pet_type, life_stage, pack_label, sku,
                       active, version, created_at, updated_at
                FROM mypet.catalog_listing
                WHERE organization_id = ? AND outlet_id = ?
                ORDER BY id ASC
                LIMIT ?
                """.trimIndent(),
                listingRowMapper,
                organizationId,
                outletId,
                boundedLimit + 1,
            )
        } else {
            jdbc.query(
                """
                SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                       name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                       category, brand, description, pet_type, life_stage, pack_label, sku,
                       active, version, created_at, updated_at
                FROM mypet.catalog_listing
                WHERE organization_id = ? AND outlet_id = ? AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """.trimIndent(),
                listingRowMapper,
                organizationId,
                outletId,
                lastListingId,
                boundedLimit + 1,
            )
        }

        val hasMore = listingRows.size > boundedLimit
        val pageRows = if (hasMore) listingRows.take(boundedLimit) else listingRows
        val pageIds = pageRows.map { it.id }

        // Batch query images for listings in this page
        val imageMap = mutableMapOf<UUID, MutableList<String>>()
        if (pageIds.isNotEmpty()) {
            val inSql = pageIds.joinToString(",") { "'$it'" }
            jdbc.query(
                """
                SELECT listing_id, image_url
                FROM mypet.catalog_listing_image
                WHERE listing_id IN ($inSql)
                ORDER BY listing_id, position ASC
                """.trimIndent(),
            ) { imgRs ->
                val lid = imgRs.getObject("listing_id", UUID::class.java)
                val url = imgRs.getString("image_url")
                imageMap.getOrPut(lid) { mutableListOf() }.add(url)
            }
        }

        val catalogItems = pageRows.map { row ->
            val images = imageMap[row.id] ?: emptyList()
            Listing(
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
                imageUrls = images,
                status = if (row.active) ListingStatus.ACTIVE else ListingStatus.INACTIVE,
                version = row.version,
                createdAt = row.createdAt,
                updatedAt = row.updatedAt,
            )
        }

        // Query inventory balances for listings in this page
        val balances = if (pageIds.isNotEmpty()) {
            val inSql = pageIds.joinToString(",") { "'$it'" }
            jdbc.query(
                """
                SELECT organization_id, outlet_id, listing_id, on_hand, reserved, version, updated_at
                FROM mypet.inventory_balance
                WHERE organization_id = ? AND outlet_id = ? AND listing_id IN ($inSql)
                ORDER BY listing_id ASC
                """.trimIndent(),
                { rs, _ ->
                    InventoryBalance(
                        organizationId = rs.getObject("organization_id", UUID::class.java),
                        outletId = rs.getObject("outlet_id", UUID::class.java),
                        listingId = rs.getObject("listing_id", UUID::class.java),
                        onHand = rs.getInt("on_hand"),
                        reserved = rs.getInt("reserved"),
                        version = rs.getLong("version"),
                        updatedAt = rs.getTimestamp("updated_at").toInstant(),
                    )
                },
                organizationId,
                outletId,
            )
        } else {
            emptyList()
        }

        val nextCursor = if (hasMore && catalogItems.isNotEmpty()) {
            encodeBootstrapCursor(organizationId, outletId, highWaterSeq, catalogItems.last().id)
        } else {
            null
        }

        return MerchantSyncBootstrapResponse(
            highWaterCursor = highWaterCursor,
            catalogItems = catalogItems,
            inventoryBalances = balances,
            nextCursor = nextCursor,
            hasMore = hasMore,
            serverTime = Instant.now(),
        )
    }

    override fun currentHighWaterCursor(organizationId: UUID, outletId: UUID): String {
        val maxSeq = jdbc.queryForObject(
            """
            SELECT COALESCE(MAX(sequence_number), 0)
            FROM mypet.merchant_sync_change_log
            WHERE organization_id = ? AND outlet_id = ?
            """.trimIndent(),
            Long::class.java,
            organizationId,
            outletId,
        ) ?: 0L
        return encodeCursor(organizationId, outletId, maxSeq)
    }

    private fun computeHmac(payload: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(cursorSecret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val rawHmac = mac.doFinal(payload.toByteArray(Charsets.UTF_8))
        return rawHmac.joinToString("") { "%02x".format(it) }
    }

    private fun encodeCursor(organizationId: UUID, outletId: UUID, sequenceNumber: Long): String {
        val epochSeconds = Instant.now().epochSecond
        val payload = "$organizationId:$outletId:$sequenceNumber:$epochSeconds"
        val hmac = computeHmac(payload)
        val raw = "$CURSOR_PREFIX$payload:$hmac"
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.toByteArray(Charsets.UTF_8))
    }

    private fun encodeBootstrapCursor(organizationId: UUID, outletId: UUID, highWaterSeq: Long, lastListingId: UUID): String {
        val epochSeconds = Instant.now().epochSecond
        val payload = "$organizationId:$outletId:$highWaterSeq:$lastListingId:$epochSeconds"
        val hmac = computeHmac(payload)
        val raw = "$BOOTSTRAP_CURSOR_PREFIX$payload:$hmac"
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.toByteArray(Charsets.UTF_8))
    }

    private fun decodeCursor(cursor: String, expectedOrgId: UUID, expectedOutletId: UUID): Long {
        try {
            val decoded = String(Base64.getUrlDecoder().decode(cursor), Charsets.UTF_8)
            if (!decoded.startsWith(CURSOR_PREFIX)) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Invalid cursor format or signature")
            }
            val parts = decoded.removePrefix(CURSOR_PREFIX).split(":")
            if (parts.size != 5) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Malformed cursor parts")
            }
            val cursorOrgId = UUID.fromString(parts[0])
            val cursorOutletId = UUID.fromString(parts[1])
            val sequence = parts[2].toLongOrNull() ?: throw DomainException("SYNC_CURSOR_EXPIRED", "Invalid cursor sequence")
            val epochSeconds = parts[3].toLongOrNull() ?: throw DomainException("SYNC_CURSOR_EXPIRED", "Invalid cursor timestamp")
            val hmac = parts[4]

            // 1. Validate HMAC signature (tamper-evident)
            val expectedPayload = "$cursorOrgId:$cursorOutletId:$sequence:$epochSeconds"
            val expectedHmac = computeHmac(expectedPayload)
            if (!MessageDigest.isEqual(expectedHmac.toByteArray(Charsets.UTF_8), hmac.toByteArray(Charsets.UTF_8))) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Cursor signature mismatch: tamper detected")
            }

            // 2. Scope binding
            if (cursorOrgId != expectedOrgId || cursorOutletId != expectedOutletId) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Cursor scope mismatch: foreign organization or outlet")
            }

            // 3. Sequence non-negative
            if (sequence < 0) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Negative cursor sequence")
            }

            // 4. Age-based protocol expiry
            val nowSeconds = Instant.now().epochSecond
            if (nowSeconds - epochSeconds > MAX_CURSOR_AGE_SECONDS) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Sync cursor has expired, rebootstrap required")
            }

            return sequence
        } catch (domain: DomainException) {
            throw domain
        } catch (ex: Exception) {
            throw DomainException("SYNC_CURSOR_EXPIRED", "Could not decode cursor: ${ex.message}")
        }
    }

    private fun decodeBootstrapCursor(cursor: String, expectedOrgId: UUID, expectedOutletId: UUID): Pair<Long, UUID> {
        try {
            val decoded = String(Base64.getUrlDecoder().decode(cursor), Charsets.UTF_8)
            if (!decoded.startsWith(BOOTSTRAP_CURSOR_PREFIX)) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Invalid bootstrap cursor format")
            }
            val parts = decoded.removePrefix(BOOTSTRAP_CURSOR_PREFIX).split(":")
            if (parts.size != 6) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Malformed bootstrap cursor parts")
            }
            val cursorOrgId = UUID.fromString(parts[0])
            val cursorOutletId = UUID.fromString(parts[1])
            val highWaterSeq = parts[2].toLongOrNull() ?: throw DomainException("SYNC_CURSOR_EXPIRED", "Invalid bootstrap sequence")
            val lastListingId = UUID.fromString(parts[3])
            val epochSeconds = parts[4].toLongOrNull() ?: throw DomainException("SYNC_CURSOR_EXPIRED", "Invalid bootstrap timestamp")
            val hmac = parts[5]

            // 1. Validate HMAC signature
            val expectedPayload = "$cursorOrgId:$cursorOutletId:$highWaterSeq:$lastListingId:$epochSeconds"
            val expectedHmac = computeHmac(expectedPayload)
            if (!MessageDigest.isEqual(expectedHmac.toByteArray(Charsets.UTF_8), hmac.toByteArray(Charsets.UTF_8))) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Bootstrap cursor signature mismatch")
            }

            // 2. Scope binding
            if (cursorOrgId != expectedOrgId || cursorOutletId != expectedOutletId) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Bootstrap cursor scope mismatch")
            }

            // 3. Age-based expiry (active session max 2 hours)
            val nowSeconds = Instant.now().epochSecond
            if (nowSeconds - epochSeconds > MAX_BOOTSTRAP_SESSION_AGE_SECONDS) {
                throw DomainException("SYNC_CURSOR_EXPIRED", "Bootstrap session expired, start afresh")
            }

            return highWaterSeq to lastListingId
        } catch (domain: DomainException) {
            throw domain
        } catch (ex: Exception) {
            throw DomainException("SYNC_CURSOR_EXPIRED", "Could not decode bootstrap cursor: ${ex.message}")
        }
    }

    private fun mapChangeRow(rs: ResultSet): MerchantSyncChange {
        return MerchantSyncChange(
            sequenceNumber = rs.getLong("sequence_number"),
            organizationId = rs.getObject("organization_id", UUID::class.java),
            outletId = rs.getObject("outlet_id", UUID::class.java),
            entityType = SyncEntityType.valueOf(rs.getString("entity_type")),
            entityId = rs.getObject("entity_id", UUID::class.java),
            entityVersion = rs.getLong("entity_version"),
            isTombstone = rs.getBoolean("is_tombstone"),
            payload = rs.getString("payload"),
            schemaVersion = rs.getInt("schema_version"),
            createdAt = rs.getTimestamp("created_at").toInstant(),
        )
    }

    private fun mapListingRow(rs: ResultSet, images: List<String>): Listing {
        val listingId = rs.getObject("id", UUID::class.java)
        return Listing(
            id = listingId,
            organizationId = rs.getObject("organization_id", UUID::class.java),
            outletId = rs.getObject("outlet_id", UUID::class.java),
            barcodeType = BarcodeType.valueOf(rs.getString("barcode_type")),
            normalizedBarcode = rs.getString("normalized_barcode"),
            name = rs.getString("name"),
            kind = ListingKind.valueOf(rs.getString("listing_kind")),
            commerceMode = CommerceMode.valueOf(rs.getString("commerce_mode")),
            mrpPaise = rs.getLong("mrp_paise"),
            sellingPricePaise = rs.getLong("selling_price_paise"),
            category = rs.getString("category"),
            brand = rs.getString("brand"),
            description = rs.getString("description"),
            petType = rs.getString("pet_type"),
            lifeStage = rs.getString("life_stage"),
            packLabel = rs.getString("pack_label"),
            sku = rs.getString("sku"),
            imageUrls = images,
            status = if (rs.getBoolean("active")) ListingStatus.ACTIVE else ListingStatus.INACTIVE,
            version = rs.getLong("version"),
            createdAt = rs.getTimestamp("created_at").toInstant(),
            updatedAt = rs.getTimestamp("updated_at").toInstant(),
        )
    }
}

private data class ListingRowData(
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
    val active: Boolean,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
)
