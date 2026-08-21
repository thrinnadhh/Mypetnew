package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogHistoryEntry
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogMutationType
import `in`.mypetnew.catalog.domain.CatalogPersistence
import `in`.mypetnew.catalog.domain.CatalogSearchPage
import `in`.mypetnew.catalog.domain.CatalogSearchQuery
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.domain.UpdateListingCommand
import `in`.mypetnew.catalog.domain.historyEntry
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
        actorId: UUID,
    ): Listing {
        try {
            return transactions.execute {
                replayCreate(command.outletId, actionKey, requestFingerprint)?.let { return@execute it }
                findByBarcode(command.organizationId, command.outletId, command.barcodeType, normalizedBarcode)?.let { existing ->
                    if (!matchesCreate(existing, command, normalizedBarcode, commerceMode)) duplicate()
                    return@execute existing
                }
                val listingId = UUID.randomUUID()
                val now = Instant.now()
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
                    listingId,
                    command.organizationId,
                    command.outletId,
                    command.barcodeType.name,
                    normalizedBarcode,
                    command.barcode.take(128),
                    command.name,
                    command.kind.name,
                    commerceMode.name,
                    command.mrpPaise,
                    command.sellingPricePaise,
                    command.category,
                    command.brand,
                    command.description,
                    command.petType,
                    command.lifeStage,
                    command.packLabel,
                    command.sku,
                    actionKey,
                    requestFingerprint,
                    java.sql.Timestamp.from(now),
                    java.sql.Timestamp.from(now),
                )
                command.imageUrls.forEachIndexed { position, url ->
                    jdbc.update(
                        "INSERT INTO mypet.catalog_listing_image (listing_id, position, image_url) VALUES (?, ?, ?)",
                        listingId,
                        position,
                        url,
                    )
                }
                val created = getManaged(command.organizationId, command.outletId, listingId)
                    ?: persistenceError()
                insertHistory(null, created, CatalogMutationType.CREATE, actorId)
                created
            }
        } catch (duplicateKey: DuplicateKeyException) {
            replayCreate(command.outletId, actionKey, requestFingerprint)?.let { return it }
            findByBarcode(command.organizationId, command.outletId, command.barcodeType, normalizedBarcode)?.let { existing ->
                if (!matchesCreate(existing, command, normalizedBarcode, commerceMode)) duplicate()
                return existing
            }
            throw DomainException("CATALOG_CONFLICT", "The catalog changed concurrently; refresh and retry")
        }
    }

    override fun getActive(listingId: UUID): Listing? = readListing(
        "WHERE id = ? AND active = TRUE",
        arrayOf(listingId),
    )

    override fun getManaged(organizationId: UUID, outletId: UUID, listingId: UUID): Listing? = readListing(
        "WHERE id = ? AND organization_id = ? AND outlet_id = ?",
        arrayOf(listingId, organizationId, outletId),
    )

    override fun update(
        command: UpdateListingCommand,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing {
        try {
            return transactions.execute {
                replayMutation(command.outletId, actionKey, requestFingerprint)?.let { return@execute it }
                val current = getManaged(command.organizationId, command.outletId, command.listingId)
                    ?: resourceUnavailable()
                if (current.version != command.expectedVersion) versionConflict()
                val now = Instant.now()
                val changed = jdbc.update(
                    """
                    UPDATE mypet.catalog_listing
                    SET name = ?, mrp_paise = ?, selling_price_paise = ?, category = ?, brand = ?,
                        description = ?, pet_type = ?, life_stage = ?, pack_label = ?, sku = ?,
                        version = version + 1, updated_at = ?
                    WHERE id = ? AND organization_id = ? AND outlet_id = ? AND version = ?
                    """.trimIndent(),
                    command.name,
                    command.mrpPaise,
                    command.sellingPricePaise,
                    command.category,
                    command.brand,
                    command.description,
                    command.petType,
                    command.lifeStage,
                    command.packLabel,
                    command.sku,
                    java.sql.Timestamp.from(now),
                    command.listingId,
                    command.organizationId,
                    command.outletId,
                    command.expectedVersion,
                )
                if (changed != 1) versionConflict()
                val updated = getManaged(command.organizationId, command.outletId, command.listingId)
                    ?: persistenceError()
                insertHistory(current, updated, CatalogMutationType.UPDATE, actorId)
                insertReceipt(updated, CatalogMutationType.UPDATE, actionKey, requestFingerprint)
                updated
            }
        } catch (duplicateKey: DuplicateKeyException) {
            replayMutation(command.outletId, actionKey, requestFingerprint)?.let { return it }
            throw DomainException("CATALOG_CONFLICT", "The catalog changed concurrently; refresh and retry")
        }
    }

    override fun changeLifecycle(
        command: CatalogLifecycleCommand,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing {
        try {
            return transactions.execute {
                replayMutation(command.outletId, actionKey, requestFingerprint)?.let { return@execute it }
                val current = getManaged(command.organizationId, command.outletId, command.listingId)
                    ?: resourceUnavailable()
                if (current.version != command.expectedVersion) versionConflict()
                if (current.status == command.targetStatus) stateConflict()
                val now = Instant.now()
                val changed = jdbc.update(
                    """
                    UPDATE mypet.catalog_listing
                    SET active = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND organization_id = ? AND outlet_id = ? AND version = ?
                    """.trimIndent(),
                    command.targetStatus == ListingStatus.ACTIVE,
                    java.sql.Timestamp.from(now),
                    command.listingId,
                    command.organizationId,
                    command.outletId,
                    command.expectedVersion,
                )
                if (changed != 1) versionConflict()
                val updated = getManaged(command.organizationId, command.outletId, command.listingId)
                    ?: persistenceError()
                val mutation = if (command.targetStatus == ListingStatus.ACTIVE) {
                    CatalogMutationType.ACTIVATE
                } else {
                    CatalogMutationType.DEACTIVATE
                }
                insertHistory(current, updated, mutation, actorId)
                insertReceipt(updated, mutation, actionKey, requestFingerprint)
                updated
            }
        } catch (duplicateKey: DuplicateKeyException) {
            replayMutation(command.outletId, actionKey, requestFingerprint)?.let { return it }
            throw DomainException("CATALOG_CONFLICT", "The catalog changed concurrently; refresh and retry")
        }
    }

    override fun history(organizationId: UUID, outletId: UUID, listingId: UUID): List<CatalogHistoryEntry> = jdbc.query(
        """
        SELECT id, listing_id, organization_id, outlet_id, listing_version, mutation_type, actor_id,
               old_name, new_name, old_mrp_paise, new_mrp_paise,
               old_selling_price_paise, new_selling_price_paise,
               old_category, new_category, old_brand, new_brand,
               old_description, new_description, old_pet_type, new_pet_type,
               old_life_stage, new_life_stage, old_pack_label, new_pack_label,
               old_sku, new_sku, old_active, new_active, created_at
        FROM mypet.catalog_listing_history
        WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?
        ORDER BY listing_version ASC
        """.trimIndent(),
        { result, _ -> mapHistory(result) },
        organizationId,
        outletId,
        listingId,
    )

    override fun search(query: CatalogSearchQuery): CatalogSearchPage {
        val where = StringBuilder("WHERE organization_id = ? AND outlet_id = ?")
        val parameters = mutableListOf<Any>(query.organizationId, query.outletId)
        query.status?.let { status ->
            where.append(" AND active = ?")
            parameters.add(status == ListingStatus.ACTIVE)
        }
        query.query?.let { term ->
            val pattern = "%${escapeLike(term.lowercase())}%"
            where.append(
                " AND (LOWER(name) LIKE ? ESCAPE '!' OR LOWER(category) LIKE ? ESCAPE '!'" +
                    " OR LOWER(COALESCE(brand, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(sku, '')) LIKE ? ESCAPE '!')",
            )
            repeat(4) { parameters.add(pattern) }
        }
        val offsetLong = query.page.toLong() * query.pageSize.toLong()
        if (offsetLong > Int.MAX_VALUE) {
            return CatalogSearchPage(emptyList(), query.page, query.pageSize, false)
        }
        parameters.add(query.pageSize + 1)
        parameters.add(offsetLong.toInt())
        val rows = jdbc.query(
            """
            $LISTING_SELECT
            $where
            ORDER BY updated_at DESC, id ASC
            LIMIT ? OFFSET ?
            """.trimIndent(),
            { result, _ -> mapRow(result) },
            *parameters.toTypedArray(),
        )
        val visibleRows = rows.take(query.pageSize)
        val images = fetchImagesForListings(visibleRows.map { it.id })
        return CatalogSearchPage(
            items = visibleRows.map { row -> listing(row, images[row.id].orEmpty()) },
            page = query.page,
            pageSize = query.pageSize,
            hasNext = rows.size > query.pageSize,
        )
    }

    override fun all(): List<Listing> {
        val rows = jdbc.query(
            "$LISTING_SELECT WHERE active = TRUE ORDER BY id",
            { result, _ -> mapRow(result) },
        )
        val images = fetchImagesForListings(rows.map { it.id })
        return rows.map { listing(it, images[it.id].orEmpty()) }
    }

    private fun readListing(where: String, args: Array<out Any>): Listing? {
        val row = jdbc.query(
            "$LISTING_SELECT $where",
            { result, _ -> mapRow(result) },
            *args,
        ).singleOrNull() ?: return null
        return listing(row, fetchImagesForListings(listOf(row.id))[row.id].orEmpty())
    }

    private fun replayCreate(outletId: UUID, actionKey: String, requestFingerprint: String): Listing? {
        val replay = jdbc.query(
            """
            SELECT id, create_request_fingerprint
            FROM mypet.catalog_listing
            WHERE outlet_id = ? AND create_idempotency_key = ?
            """.trimIndent(),
            { result, _ -> result.getObject("id", UUID::class.java) to result.getString("create_request_fingerprint") },
            outletId,
            actionKey,
        ).singleOrNull() ?: return null
        if (replay.second != requestFingerprint) fingerprintMismatch()
        return snapshotAtVersion(replay.first, 0) ?: readListing("WHERE id = ?", arrayOf(replay.first))
    }

    private fun replayMutation(outletId: UUID, actionKey: String, requestFingerprint: String): Listing? {
        val receipt = jdbc.query(
            """
            SELECT listing_id, request_fingerprint, resulting_version
            FROM mypet.catalog_mutation_receipt
            WHERE outlet_id = ? AND idempotency_key = ?
            """.trimIndent(),
            { result, _ -> MutationReceipt(
                result.getObject("listing_id", UUID::class.java),
                result.getString("request_fingerprint"),
                result.getLong("resulting_version"),
            ) },
            outletId,
            actionKey,
        ).singleOrNull() ?: return null
        if (receipt.requestFingerprint != requestFingerprint) fingerprintMismatch()
        return snapshotAtVersion(receipt.listingId, receipt.resultingVersion) ?: persistenceError()
    }

    private fun snapshotAtVersion(listingId: UUID, version: Long): Listing? {
        val current = readListing("WHERE id = ?", arrayOf(listingId)) ?: return null
        val entry = jdbc.query(
            """
            SELECT id, listing_id, organization_id, outlet_id, listing_version, mutation_type, actor_id,
                   old_name, new_name, old_mrp_paise, new_mrp_paise,
                   old_selling_price_paise, new_selling_price_paise,
                   old_category, new_category, old_brand, new_brand,
                   old_description, new_description, old_pet_type, new_pet_type,
                   old_life_stage, new_life_stage, old_pack_label, new_pack_label,
                   old_sku, new_sku, old_active, new_active, created_at
            FROM mypet.catalog_listing_history
            WHERE listing_id = ? AND listing_version = ?
            """.trimIndent(),
            { result, _ -> mapHistory(result) },
            listingId,
            version,
        ).singleOrNull() ?: return null
        return current.copy(
            name = entry.newName,
            mrpPaise = entry.newMrpPaise,
            sellingPricePaise = entry.newSellingPricePaise,
            category = entry.newCategory,
            brand = entry.newBrand,
            description = entry.newDescription,
            petType = entry.newPetType,
            lifeStage = entry.newLifeStage,
            packLabel = entry.newPackLabel,
            sku = entry.newSku,
            status = entry.newStatus,
            version = entry.listingVersion,
            updatedAt = entry.createdAt,
        )
    }

    private fun findByBarcode(
        organizationId: UUID,
        outletId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
    ): Listing? = readListing(
        "WHERE organization_id = ? AND outlet_id = ? AND barcode_type = ? AND normalized_barcode = ?",
        arrayOf<Any>(organizationId, outletId, barcodeType.name, normalizedBarcode),
    )

    private fun insertHistory(old: Listing?, new: Listing, mutationType: CatalogMutationType, actorId: UUID) {
        val entry = historyEntry(old, new, mutationType, actorId, new.updatedAt)
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing_history(
                id, listing_id, organization_id, outlet_id, listing_version, mutation_type, actor_id,
                old_name, new_name, old_mrp_paise, new_mrp_paise,
                old_selling_price_paise, new_selling_price_paise,
                old_category, new_category, old_brand, new_brand,
                old_description, new_description, old_pet_type, new_pet_type,
                old_life_stage, new_life_stage, old_pack_label, new_pack_label,
                old_sku, new_sku, old_active, new_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            entry.id,
            entry.listingId,
            entry.organizationId,
            entry.outletId,
            entry.listingVersion,
            entry.mutationType.name,
            entry.actorId,
            entry.oldName,
            entry.newName,
            entry.oldMrpPaise,
            entry.newMrpPaise,
            entry.oldSellingPricePaise,
            entry.newSellingPricePaise,
            entry.oldCategory,
            entry.newCategory,
            entry.oldBrand,
            entry.newBrand,
            entry.oldDescription,
            entry.newDescription,
            entry.oldPetType,
            entry.newPetType,
            entry.oldLifeStage,
            entry.newLifeStage,
            entry.oldPackLabel,
            entry.newPackLabel,
            entry.oldSku,
            entry.newSku,
            entry.oldStatus?.let { it == ListingStatus.ACTIVE },
            entry.newStatus == ListingStatus.ACTIVE,
            java.sql.Timestamp.from(entry.createdAt),
        )
    }

    private fun insertReceipt(
        listing: Listing,
        mutationType: CatalogMutationType,
        actionKey: String,
        requestFingerprint: String,
    ) {
        jdbc.update(
            """
            INSERT INTO mypet.catalog_mutation_receipt(
                id, outlet_id, listing_id, idempotency_key, request_fingerprint,
                mutation_type, resulting_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            listing.outletId,
            listing.id,
            actionKey,
            requestFingerprint,
            mutationType.name,
            listing.version,
            java.sql.Timestamp.from(listing.updatedAt),
        )
    }

    private fun fetchImagesForListings(listingIds: Collection<UUID>): Map<UUID, List<String>> {
        if (listingIds.isEmpty()) return emptyMap()
        val images = mutableMapOf<UUID, MutableList<String>>()
        val placeholders = listingIds.joinToString(",") { "?" }
        jdbc.query(
            """
            SELECT listing_id, image_url
            FROM mypet.catalog_listing_image
            WHERE listing_id IN ($placeholders)
            ORDER BY listing_id, position ASC
            """.trimIndent(),
            { result ->
                val id = result.getObject("listing_id", UUID::class.java)
                images.getOrPut(id) { mutableListOf() }.add(result.getString("image_url"))
            },
            *listingIds.toTypedArray(),
        )
        return images
    }

    private fun mapRow(result: ResultSet): ListingRow {
        val createdAt = result.getTimestamp("created_at")?.toInstant() ?: corrupt("created_at")
        val updatedAt = result.getTimestamp("updated_at")?.toInstant() ?: corrupt("updated_at")
        return ListingRow(
            id = result.getObject("id", UUID::class.java),
            organizationId = result.getObject("organization_id", UUID::class.java),
            outletId = result.getObject("outlet_id", UUID::class.java),
            barcodeType = BarcodeType.valueOf(result.getString("barcode_type")),
            normalizedBarcode = result.getString("normalized_barcode"),
            name = result.getString("name"),
            kind = ListingKind.valueOf(result.getString("listing_kind")),
            commerceMode = CommerceMode.valueOf(result.getString("commerce_mode")),
            mrpPaise = result.getLong("mrp_paise"),
            sellingPricePaise = result.getLong("selling_price_paise"),
            category = result.getString("category") ?: "other",
            brand = result.getString("brand"),
            description = result.getString("description"),
            petType = result.getString("pet_type"),
            lifeStage = result.getString("life_stage"),
            packLabel = result.getString("pack_label"),
            sku = result.getString("sku"),
            status = if (result.getBoolean("active")) ListingStatus.ACTIVE else ListingStatus.INACTIVE,
            version = result.getLong("version"),
            createdAt = createdAt,
            updatedAt = updatedAt,
        )
    }

    private fun mapHistory(result: ResultSet): CatalogHistoryEntry = CatalogHistoryEntry(
        id = result.getObject("id", UUID::class.java),
        listingId = result.getObject("listing_id", UUID::class.java),
        organizationId = result.getObject("organization_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        listingVersion = result.getLong("listing_version"),
        mutationType = CatalogMutationType.valueOf(result.getString("mutation_type")),
        actorId = result.getObject("actor_id", UUID::class.java),
        oldName = result.getString("old_name"),
        newName = result.getString("new_name"),
        oldMrpPaise = nullableLong(result, "old_mrp_paise"),
        newMrpPaise = result.getLong("new_mrp_paise"),
        oldSellingPricePaise = nullableLong(result, "old_selling_price_paise"),
        newSellingPricePaise = result.getLong("new_selling_price_paise"),
        oldCategory = result.getString("old_category"),
        newCategory = result.getString("new_category"),
        oldBrand = result.getString("old_brand"),
        newBrand = result.getString("new_brand"),
        oldDescription = result.getString("old_description"),
        newDescription = result.getString("new_description"),
        oldPetType = result.getString("old_pet_type"),
        newPetType = result.getString("new_pet_type"),
        oldLifeStage = result.getString("old_life_stage"),
        newLifeStage = result.getString("new_life_stage"),
        oldPackLabel = result.getString("old_pack_label"),
        newPackLabel = result.getString("new_pack_label"),
        oldSku = result.getString("old_sku"),
        newSku = result.getString("new_sku"),
        oldStatus = nullableBoolean(result, "old_active")?.let { if (it) ListingStatus.ACTIVE else ListingStatus.INACTIVE },
        newStatus = if (result.getBoolean("new_active")) ListingStatus.ACTIVE else ListingStatus.INACTIVE,
        createdAt = result.getTimestamp("created_at")?.toInstant() ?: corrupt("history.created_at"),
    )

    private fun nullableLong(result: ResultSet, column: String): Long? {
        val value = result.getLong(column)
        return if (result.wasNull()) null else value
    }

    private fun nullableBoolean(result: ResultSet, column: String): Boolean? {
        val value = result.getBoolean(column)
        return if (result.wasNull()) null else value
    }

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
        status = row.status,
        version = row.version,
        createdAt = row.createdAt,
        updatedAt = row.updatedAt,
    )

    private fun matchesCreate(
        listing: Listing,
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
    ): Boolean = listing.version == 0L && listing.status == ListingStatus.ACTIVE &&
        listing.normalizedBarcode == normalizedBarcode && listing.name == command.name &&
        listing.kind == command.kind && listing.commerceMode == commerceMode &&
        listing.mrpPaise == command.mrpPaise && listing.sellingPricePaise == command.sellingPricePaise &&
        listing.category == command.category && listing.brand == command.brand && listing.description == command.description &&
        listing.petType == command.petType && listing.lifeStage == command.lifeStage && listing.packLabel == command.packLabel &&
        listing.sku == command.sku && listing.imageUrls == command.imageUrls

    private fun escapeLike(value: String): String = value.replace("!", "!!").replace("%", "!%").replace("_", "!_")

    private fun resourceUnavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
    private fun versionConflict(): Nothing = throw DomainException("CATALOG_VERSION_CONFLICT", "The listing changed; refresh and retry")
    private fun stateConflict(): Nothing = throw DomainException("CATALOG_STATE_INVALID", "The listing is already in the requested state")
    private fun duplicate(): Nothing = throw DomainException("CATALOG_DUPLICATE", "A different listing already uses this catalog identity")
    private fun fingerprintMismatch(): Nothing = throw DomainException(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        "The idempotency key was already used for another request",
    )
    private fun persistenceError(): Nothing = throw DomainException("PERSISTENCE_ERROR", "Catalog persistence did not produce a result")
    private fun corrupt(field: String): Nothing = throw DomainException("DATABASE_CORRUPT", "Missing $field for catalog record")

    private data class MutationReceipt(val listingId: UUID, val requestFingerprint: String, val resultingVersion: Long)

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
        val status: ListingStatus,
        val version: Long,
        val createdAt: Instant,
        val updatedAt: Instant,
    )

    companion object {
        private val LISTING_SELECT = """
            SELECT id, organization_id, outlet_id, barcode_type, normalized_barcode,
                   name, listing_kind, commerce_mode, mrp_paise, selling_price_paise,
                   category, brand, description, pet_type, life_stage, pack_label, sku,
                   active, version, created_at, updated_at
            FROM mypet.catalog_listing
        """.trimIndent()
    }
}
