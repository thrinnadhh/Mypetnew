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
    @param:Value("\${mypet.sync.cursor-secret:mypet-sync-cursor-secret-v2-secure-key}")
    private val cursorSecret: String = "mypet-sync-cursor-secret-v2-secure-key",
) : MerchantSyncPublisher, MerchantSyncFeedService {

    companion object {
        const val MAX_PAGE_SIZE = 250
        const val CURSOR_PREFIX = "msc_v2:"
        // Cursor older than 90 days or negative sequence is considered expired/invalid
        const val MAX_CURSOR_AGE_SECONDS = 90L * 24 * 60 * 60
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
            "listingId" to listingId.toString(),
            "organizationId" to organizationId.toString(),
            "outletId" to outletId.toString(),
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
            "listingId" to balance.listingId.toString(),
            "organizationId" to balance.organizationId.toString(),
            "outletId" to balance.outletId.toString(),
            "onHand" to balance.onHand,
            "reserved" to balance.reserved,
            "available" to balance.available,
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

    @Transactional(readOnly = true)
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
    override fun fetchBootstrap(
        organizationId: UUID,
        outletId: UUID,
    ): MerchantSyncBootstrapResponse {
        val highWater = currentHighWaterCursor(organizationId, outletId)

        // Batch query listing images to avoid N+1 queries
        val imageMap = mutableMapOf<UUID, MutableList<String>>()
        jdbc.query(
            """
            SELECT i.listing_id, i.image_url
            FROM mypet.catalog_listing_image i
            JOIN mypet.catalog_listing l ON l.id = i.listing_id
            WHERE l.organization_id = ? AND l.outlet_id = ?
            ORDER BY i.listing_id, i.position ASC
            """.trimIndent(),
            { imgRs ->
                val lid = imgRs.getObject("listing_id", UUID::class.java)
                val url = imgRs.getString("image_url")
                imageMap.getOrPut(lid) { mutableListOf() }.add(url)
            },
            organizationId,
            outletId,
        )

        val catalogItems = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                   name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                   category, brand, description, pet_type, life_stage, pack_label, sku,
                   active, version, created_at, updated_at
            FROM mypet.catalog_listing
            WHERE organization_id = ? AND outlet_id = ?
            ORDER BY created_at ASC
            """.trimIndent(),
            { rs, _ ->
                val listingId = rs.getObject("id", UUID::class.java)
                val images = imageMap[listingId] ?: emptyList()
                mapListingRow(rs, images)
            },
            organizationId,
            outletId,
        )

        val balances = jdbc.query(
            """
            SELECT organization_id, outlet_id, listing_id, on_hand, reserved, version, updated_at
            FROM mypet.inventory_balance
            WHERE organization_id = ? AND outlet_id = ?
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

        return MerchantSyncBootstrapResponse(
            highWaterCursor = highWater,
            catalogItems = catalogItems,
            inventoryBalances = balances,
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
