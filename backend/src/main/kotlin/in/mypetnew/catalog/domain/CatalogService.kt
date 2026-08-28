package `in`.mypetnew.catalog.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import `in`.mypetnew.provider.domain.ProviderCapability
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

enum class ListingKind { PRODUCT, MEDICINE }

enum class CommerceMode { COMMERCE, VIEW_ONLY }

enum class ListingStatus { ACTIVE, INACTIVE }

enum class CatalogMutationType { CREATE, UPDATE, DEACTIVATE, ACTIVATE }

data class CreateListingCommand(
    val organizationId: UUID,
    val outletId: UUID,
    val barcodeType: BarcodeType,
    val barcode: String,
    val name: String,
    val kind: ListingKind,
    val mrpPaise: Long,
    val sellingPricePaise: Long,
    val capabilities: Set<ProviderCapability>,
    val category: String,
    val brand: String? = null,
    val description: String? = null,
    val petType: String? = null,
    val lifeStage: String? = null,
    val packLabel: String? = null,
    val sku: String? = null,
    val imageUrls: List<String> = emptyList(),
)

data class UpdateListingCommand(
    val organizationId: UUID,
    val outletId: UUID,
    val listingId: UUID,
    val expectedVersion: Long,
    val name: String,
    val mrpPaise: Long,
    val sellingPricePaise: Long,
    val category: String,
    val brand: String? = null,
    val description: String? = null,
    val petType: String? = null,
    val lifeStage: String? = null,
    val packLabel: String? = null,
    val sku: String? = null,
    val capabilities: Set<ProviderCapability>,
)

data class CatalogLifecycleCommand(
    val organizationId: UUID,
    val outletId: UUID,
    val listingId: UUID,
    val expectedVersion: Long,
    val targetStatus: ListingStatus,
    val capabilities: Set<ProviderCapability>,
)

data class Listing(
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
    val category: String = "other",
    val brand: String? = null,
    val description: String? = null,
    val petType: String? = null,
    val lifeStage: String? = null,
    val packLabel: String? = null,
    val sku: String? = null,
    val imageUrls: List<String> = emptyList(),
    val status: ListingStatus = ListingStatus.ACTIVE,
    val version: Long = 0,
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = createdAt,
)

data class CatalogHistoryEntry(
    val id: UUID,
    val listingId: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val listingVersion: Long,
    val mutationType: CatalogMutationType,
    val actorId: UUID,
    val oldName: String?,
    val newName: String,
    val oldMrpPaise: Long?,
    val newMrpPaise: Long,
    val oldSellingPricePaise: Long?,
    val newSellingPricePaise: Long,
    val oldCategory: String?,
    val newCategory: String,
    val oldBrand: String?,
    val newBrand: String?,
    val oldDescription: String?,
    val newDescription: String?,
    val oldPetType: String?,
    val newPetType: String?,
    val oldLifeStage: String?,
    val newLifeStage: String?,
    val oldPackLabel: String?,
    val newPackLabel: String?,
    val oldSku: String?,
    val newSku: String?,
    val oldStatus: ListingStatus?,
    val newStatus: ListingStatus,
    val createdAt: Instant,
)

data class CatalogSearchQuery(
    val organizationId: UUID,
    val outletId: UUID,
    val query: String? = null,
    val status: ListingStatus? = null,
    val page: Int = 0,
    val pageSize: Int = DEFAULT_CATALOG_PAGE_SIZE,
)

data class CatalogSearchPage(
    val items: List<Listing>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

interface CatalogPersistence {
    fun create(
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing

    fun getActive(listingId: UUID): Listing?
    fun getManaged(organizationId: UUID, outletId: UUID, listingId: UUID): Listing?

    fun update(
        command: UpdateListingCommand,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing

    fun changeLifecycle(
        command: CatalogLifecycleCommand,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing

    fun history(organizationId: UUID, outletId: UUID, listingId: UUID): List<CatalogHistoryEntry>
    fun search(query: CatalogSearchQuery): CatalogSearchPage
    fun all(): List<Listing>
}

class CatalogService(
    private val persistence: CatalogPersistence = InMemoryCatalogPersistence(),
) {
    fun createListing(
        command: CreateListingCommand,
        actionKey: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
    ): Listing {
        val normalized = BarcodeNormalizer.normalize(command.barcodeType, command.barcode)
        val cleanedCommand = cleanCreate(command)
        validateListingValues(cleanedCommand)
        validateCapability(cleanedCommand.kind, cleanedCommand.capabilities)
        validateActionKey(actionKey)
        val commerceMode = if (cleanedCommand.kind == ListingKind.MEDICINE) CommerceMode.VIEW_ONLY else CommerceMode.COMMERCE
        val requestFingerprint = createFingerprint(cleanedCommand, normalized, commerceMode)
        return persistence.create(cleanedCommand, normalized, commerceMode, actionKey, requestFingerprint, actorId)
    }

    fun updateListing(
        command: UpdateListingCommand,
        actionKey: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
    ): Listing {
        if (command.expectedVersion < 0) invalidVersion()
        val current = getManagedListing(command.organizationId, command.outletId, command.listingId)
        validateCapability(current.kind, command.capabilities)
        val cleaned = cleanUpdate(command)
        validateListingValues(cleaned)
        validateActionKey(actionKey)
        return persistence.update(cleaned, actionKey, updateFingerprint(cleaned), actorId)
    }

    fun changeLifecycle(
        command: CatalogLifecycleCommand,
        actionKey: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
    ): Listing {
        if (command.expectedVersion < 0) invalidVersion()
        val current = getManagedListing(command.organizationId, command.outletId, command.listingId)
        if (command.targetStatus == ListingStatus.ACTIVE) {
            validateCapability(current.kind, command.capabilities)
            validateListingValues(current)
            if (current.kind == ListingKind.MEDICINE && current.commerceMode != CommerceMode.VIEW_ONLY) {
                throw DomainException("MEDICINE_COMMERCE_FORBIDDEN", "Medicine listings must remain view only")
            }
        }
        validateActionKey(actionKey)
        return persistence.changeLifecycle(command, actionKey, lifecycleFingerprint(command), actorId)
    }

    fun getListing(listingId: UUID): Listing = persistence.getActive(listingId)
        ?: resourceUnavailable()

    fun getManagedListing(organizationId: UUID, outletId: UUID, listingId: UUID): Listing =
        persistence.getManaged(organizationId, outletId, listingId) ?: resourceUnavailable()

    fun listHistory(organizationId: UUID, outletId: UUID, listingId: UUID): List<CatalogHistoryEntry> {
        getManagedListing(organizationId, outletId, listingId)
        return persistence.history(organizationId, outletId, listingId)
    }

    fun searchManagedListings(query: CatalogSearchQuery): CatalogSearchPage {
        if (query.page < 0 || query.pageSize <= 0) {
            throw DomainException("CATALOG_PAGE_INVALID", "Catalog pagination is invalid")
        }
        val normalizedTerm = query.query?.trim()?.takeIf { it.isNotEmpty() }
        if (normalizedTerm != null && normalizedTerm.length > MAX_CATALOG_SEARCH_LENGTH) {
            throw DomainException("CATALOG_SEARCH_INVALID", "Catalog search term is too long")
        }
        val bounded = query.copy(
            query = normalizedTerm,
            pageSize = query.pageSize.coerceAtMost(MAX_CATALOG_PAGE_SIZE),
        )
        return persistence.search(bounded)
    }

    fun allListings(): List<Listing> = persistence.all()

    private fun cleanCreate(command: CreateListingCommand): CreateListingCommand {
        val category = cleanCategory(command.category)
        return command.copy(
            name = command.name.trim(),
            category = category,
            brand = cleanOptional(command.brand, 100),
            description = cleanOptional(command.description, 2000),
            petType = cleanOptional(command.petType, 40),
            lifeStage = cleanOptional(command.lifeStage, 40),
            packLabel = cleanOptional(command.packLabel, 80),
            sku = cleanOptional(command.sku, 80),
            imageUrls = command.imageUrls.map { it.trim() },
        )
    }

    private fun cleanUpdate(command: UpdateListingCommand): UpdateListingCommand = command.copy(
        name = command.name.trim(),
        category = cleanCategory(command.category),
        brand = cleanOptional(command.brand, 100),
        description = cleanOptional(command.description, 2000),
        petType = cleanOptional(command.petType, 40),
        lifeStage = cleanOptional(command.lifeStage, 40),
        packLabel = cleanOptional(command.packLabel, 80),
        sku = cleanOptional(command.sku, 80),
    )

    private fun cleanCategory(category: String): String {
        val cleaned = category.trim().lowercase()
        if (cleaned.isBlank() || !cleaned.matches(Regex("[a-z0-9][a-z0-9-]{0,79}"))) {
            throw DomainException("LISTING_CATEGORY_INVALID", "The category must be a valid lowercase slug")
        }
        return cleaned
    }

    private fun validateListingValues(command: CreateListingCommand) {
        validateListingValues(command.name, command.mrpPaise, command.sellingPricePaise)
        validateImages(command.imageUrls)
    }

    private fun validateListingValues(command: UpdateListingCommand) {
        validateListingValues(command.name, command.mrpPaise, command.sellingPricePaise)
    }

    private fun validateListingValues(listing: Listing) {
        validateListingValues(listing.name, listing.mrpPaise, listing.sellingPricePaise)
    }

    private fun validateListingValues(name: String, mrpPaise: Long, sellingPricePaise: Long) {
        if (name.isBlank() || name.length > 160) {
            throw DomainException("LISTING_NAME_INVALID", "A valid listing name is required")
        }
        if (mrpPaise < 0 || sellingPricePaise < 0 || sellingPricePaise > mrpPaise) {
            throw DomainException("LISTING_PRICE_INVALID", "The listing price is invalid")
        }
    }

    private fun validateCapability(kind: ListingKind, capabilities: Set<ProviderCapability>) {
        if (kind == ListingKind.PRODUCT && ProviderCapability.PRODUCT_STORE !in capabilities) {
            throw DomainException("CAPABILITY_REQUIRED", "The outlet cannot publish product listings")
        }
        if (kind == ListingKind.MEDICINE && ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY !in capabilities) {
            throw DomainException("CAPABILITY_REQUIRED", "The outlet cannot publish medicine listings")
        }
    }

    private fun validateImages(imageUrls: List<String>) {
        if (imageUrls.size > 5 || imageUrls.distinct().size != imageUrls.size) {
            throw DomainException("LISTING_IMAGE_INVALID", "Listing images are invalid")
        }
        imageUrls.forEach(::validateImageUrl)
    }

    private fun validateImageUrl(url: String) {
        if (url.length > 2048) {
            throw DomainException("LISTING_IMAGE_INVALID", "Image URL exceeds maximum length of 2048 characters")
        }
        val uri = try {
            URI(url)
        } catch (e: Exception) {
            throw DomainException("LISTING_IMAGE_INVALID", "Image URL is syntactically invalid")
        }
        if (!uri.isAbsolute || uri.scheme == null || !uri.scheme.equals("https", ignoreCase = true)) {
            throw DomainException("LISTING_IMAGE_INVALID", "Image URL scheme must be HTTPS")
        }
        if (uri.host.isNullOrBlank()) {
            throw DomainException("LISTING_IMAGE_INVALID", "Image URL host must be non-empty")
        }
        if (uri.userInfo != null || uri.rawUserInfo != null) {
            throw DomainException("LISTING_IMAGE_INVALID", "Image URL user credentials are not allowed")
        }
    }

    private fun validateActionKey(actionKey: String) {
        if (!actionKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun createFingerprint(command: CreateListingCommand, normalized: String, commerceMode: CommerceMode): String {
        val out = ByteArrayOutputStream()
        val dos = DataOutputStream(out)

        fun writeString(value: String?) {
            if (value == null) {
                dos.writeInt(-1)
            } else {
                val bytes = value.toByteArray(StandardCharsets.UTF_8)
                dos.writeInt(bytes.size)
                dos.write(bytes)
            }
        }

        writeString(command.organizationId.toString())
        writeString(command.outletId.toString())
        writeString(command.barcodeType.name)
        writeString(normalized)
        writeString(command.name)
        writeString(command.kind.name)
        writeString(commerceMode.name)
        dos.writeLong(command.mrpPaise)
        dos.writeLong(command.sellingPricePaise)
        writeString(command.category)
        writeString(command.brand)
        writeString(command.description)
        writeString(command.petType)
        writeString(command.lifeStage)
        writeString(command.packLabel)
        writeString(command.sku)
        dos.writeInt(command.imageUrls.size)
        command.imageUrls.forEach(::writeString)
        dos.flush()
        return sha256(out.toByteArray())
    }

    companion object {
        val SYSTEM_ACTOR_ID: UUID = UUID(0, 0)

        fun computeUpdateFingerprint(
            organizationId: String,
            outletId: String,
            listingId: String,
            expectedVersion: String,
            name: String,
            mrpPaise: String,
            sellingPricePaise: String,
            category: String,
            brand: String?,
            description: String?,
            petType: String?,
            lifeStage: String?,
            packLabel: String?,
            sku: String?,
        ): String = fingerprintParts(
            organizationId, outletId, listingId,
            expectedVersion, name, mrpPaise,
            sellingPricePaise, category, brand, description,
            petType, lifeStage, packLabel, sku,
        )

        fun computeLifecycleFingerprint(
            organizationId: String,
            outletId: String,
            listingId: String,
            expectedVersion: String,
            targetStatus: String,
        ): String = fingerprintParts(
            organizationId, outletId, listingId,
            expectedVersion, targetStatus,
        )

        fun fingerprintParts(vararg values: String?): String {
            val out = ByteArrayOutputStream()
            val dos = DataOutputStream(out)
            values.forEach { value ->
                if (value == null) {
                    dos.writeInt(-1)
                } else {
                    val bytes = value.toByteArray(StandardCharsets.UTF_8)
                    dos.writeInt(bytes.size)
                    dos.write(bytes)
                }
            }
            dos.flush()
            return sha256(out.toByteArray())
        }

        private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    private fun updateFingerprint(command: UpdateListingCommand): String = computeUpdateFingerprint(
        command.organizationId.toString(), command.outletId.toString(), command.listingId.toString(),
        command.expectedVersion.toString(), command.name, command.mrpPaise.toString(),
        command.sellingPricePaise.toString(), command.category, command.brand, command.description,
        command.petType, command.lifeStage, command.packLabel, command.sku,
    )

    private fun lifecycleFingerprint(command: CatalogLifecycleCommand): String = computeLifecycleFingerprint(
        command.organizationId.toString(), command.outletId.toString(), command.listingId.toString(),
        command.expectedVersion.toString(), command.targetStatus.name,
    )

    private fun cleanOptional(value: String?, maxLength: Int): String? {
        if (value == null) return null
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return null
        if (trimmed.length > maxLength) {
            throw DomainException("LISTING_METADATA_INVALID", "Metadata field exceeds maximum allowed length of $maxLength characters")
        }
        return trimmed
    }

    private fun invalidVersion(): Nothing = throw DomainException(
        "CATALOG_VERSION_INVALID",
        "The expected catalog version is invalid",
    )

    private fun resourceUnavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )
}

const val DEFAULT_CATALOG_PAGE_SIZE = 25
const val MAX_CATALOG_PAGE_SIZE = 100
private const val MAX_CATALOG_SEARCH_LENGTH = 120

private class InMemoryCatalogPersistence : CatalogPersistence {
    private data class UniqueBarcode(
        val organizationId: UUID,
        val outletId: UUID,
        val type: BarcodeType,
        val value: String,
    )

    private val listings = mutableMapOf<UniqueBarcode, Listing>()
    private val listingsById = mutableMapOf<UUID, Listing>()
    private val createIdempotency = IdempotencyStore<Listing>()
    private val mutationIdempotency = IdempotencyStore<Listing>()
    private val historyByListing = mutableMapOf<UUID, MutableList<CatalogHistoryEntry>>()

    @Synchronized
    override fun create(
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing = createIdempotency.execute("listing:${command.outletId}", actionKey, requestFingerprint) {
        val unique = UniqueBarcode(command.organizationId, command.outletId, command.barcodeType, normalizedBarcode)
        listings[unique]?.let { existing ->
            if (!matchesCreate(existing, command, normalizedBarcode, commerceMode)) duplicate()
            return@execute existing
        }
        val now = Instant.now()
        val listing = Listing(
            id = UUID.randomUUID(),
            organizationId = command.organizationId,
            outletId = command.outletId,
            barcodeType = command.barcodeType,
            normalizedBarcode = normalizedBarcode,
            name = command.name,
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
            status = ListingStatus.ACTIVE,
            version = 0,
            createdAt = now,
            updatedAt = now,
        )
        listings[unique] = listing
        listingsById[listing.id] = listing
        appendHistory(null, listing, CatalogMutationType.CREATE, actorId)
        listing
    }

    @Synchronized
    override fun getActive(listingId: UUID): Listing? = listingsById[listingId]?.takeIf { it.status == ListingStatus.ACTIVE }

    @Synchronized
    override fun getManaged(organizationId: UUID, outletId: UUID, listingId: UUID): Listing? =
        listingsById[listingId]?.takeIf { it.organizationId == organizationId && it.outletId == outletId }

    @Synchronized
    override fun update(
        command: UpdateListingCommand,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing = mutationIdempotency.execute("catalog:${command.outletId}", actionKey, requestFingerprint) {
        val current = getManaged(command.organizationId, command.outletId, command.listingId) ?: resourceUnavailable()
        if (current.version != command.expectedVersion) versionConflict()
        val now = Instant.now()
        val updated = current.copy(
            name = command.name,
            mrpPaise = command.mrpPaise,
            sellingPricePaise = command.sellingPricePaise,
            category = command.category,
            brand = command.brand,
            description = command.description,
            petType = command.petType,
            lifeStage = command.lifeStage,
            packLabel = command.packLabel,
            sku = command.sku,
            version = current.version + 1,
            updatedAt = now,
        )
        listingsById[updated.id] = updated
        val unique = UniqueBarcode(updated.organizationId, updated.outletId, updated.barcodeType, updated.normalizedBarcode)
        listings[unique] = updated
        appendHistory(current, updated, CatalogMutationType.UPDATE, actorId)
        updated
    }

    @Synchronized
    override fun changeLifecycle(
        command: CatalogLifecycleCommand,
        actionKey: String,
        requestFingerprint: String,
        actorId: UUID,
    ): Listing = mutationIdempotency.execute("catalog:${command.outletId}", actionKey, requestFingerprint) {
        val current = getManaged(command.organizationId, command.outletId, command.listingId) ?: resourceUnavailable()
        if (current.version != command.expectedVersion) versionConflict()
        if (current.status == command.targetStatus) stateConflict()
        val updated = current.copy(
            status = command.targetStatus,
            version = current.version + 1,
            updatedAt = Instant.now(),
        )
        listingsById[updated.id] = updated
        val unique = UniqueBarcode(updated.organizationId, updated.outletId, updated.barcodeType, updated.normalizedBarcode)
        listings[unique] = updated
        appendHistory(
            current,
            updated,
            if (updated.status == ListingStatus.ACTIVE) CatalogMutationType.ACTIVATE else CatalogMutationType.DEACTIVATE,
            actorId,
        )
        updated
    }

    @Synchronized
    override fun history(organizationId: UUID, outletId: UUID, listingId: UUID): List<CatalogHistoryEntry> =
        getManaged(organizationId, outletId, listingId)?.let { historyByListing[listingId].orEmpty().toList() } ?: emptyList()

    @Synchronized
    override fun search(query: CatalogSearchQuery): CatalogSearchPage {
        val term = query.query?.lowercase()
        val matching = listingsById.values.asSequence()
            .filter { it.organizationId == query.organizationId && it.outletId == query.outletId }
            .filter { query.status == null || it.status == query.status }
            .filter { listing ->
                term == null || listOf(listing.name, listing.category, listing.brand, listing.sku)
                    .filterNotNull()
                    .any { it.lowercase().contains(term) }
            }
            .sortedWith(compareByDescending<Listing> { it.updatedAt }.thenBy { it.id.toString() })
            .toList()
        val start = query.page.toLong() * query.pageSize.toLong()
        if (start > Int.MAX_VALUE) return CatalogSearchPage(emptyList(), query.page, query.pageSize, false)
        val from = start.toInt().coerceAtMost(matching.size)
        val to = (from + query.pageSize).coerceAtMost(matching.size)
        return CatalogSearchPage(
            items = matching.subList(from, to),
            page = query.page,
            pageSize = query.pageSize,
            hasNext = to < matching.size,
        )
    }

    @Synchronized
    override fun all(): List<Listing> = listingsById.values.filter { it.status == ListingStatus.ACTIVE }

    private fun appendHistory(old: Listing?, new: Listing, mutationType: CatalogMutationType, actorId: UUID) {
        historyByListing.getOrPut(new.id) { mutableListOf() }.add(historyEntry(old, new, mutationType, actorId, new.updatedAt))
    }

    private fun matchesCreate(
        listing: Listing,
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
    ): Boolean = listing.version == 0L &&
        listing.normalizedBarcode == normalizedBarcode && listing.name == command.name &&
        listing.kind == command.kind && listing.commerceMode == commerceMode &&
        listing.mrpPaise == command.mrpPaise && listing.sellingPricePaise == command.sellingPricePaise &&
        listing.category == command.category && listing.brand == command.brand && listing.description == command.description &&
        listing.petType == command.petType && listing.lifeStage == command.lifeStage && listing.packLabel == command.packLabel &&
        listing.sku == command.sku && listing.imageUrls == command.imageUrls

    private fun resourceUnavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
    private fun versionConflict(): Nothing = throw DomainException("CATALOG_VERSION_CONFLICT", "The listing changed; refresh and retry")
    private fun stateConflict(): Nothing = throw DomainException("CATALOG_STATE_INVALID", "The listing is already in the requested state")
    private fun duplicate(): Nothing = throw DomainException("CATALOG_DUPLICATE", "A different listing already uses this catalog identity")
}

internal fun historyEntry(
    old: Listing?,
    new: Listing,
    mutationType: CatalogMutationType,
    actorId: UUID,
    createdAt: Instant,
    id: UUID = UUID.randomUUID(),
): CatalogHistoryEntry = CatalogHistoryEntry(
    id = id,
    listingId = new.id,
    organizationId = new.organizationId,
    outletId = new.outletId,
    listingVersion = new.version,
    mutationType = mutationType,
    actorId = actorId,
    oldName = old?.name,
    newName = new.name,
    oldMrpPaise = old?.mrpPaise,
    newMrpPaise = new.mrpPaise,
    oldSellingPricePaise = old?.sellingPricePaise,
    newSellingPricePaise = new.sellingPricePaise,
    oldCategory = old?.category,
    newCategory = new.category,
    oldBrand = old?.brand,
    newBrand = new.brand,
    oldDescription = old?.description,
    newDescription = new.description,
    oldPetType = old?.petType,
    newPetType = new.petType,
    oldLifeStage = old?.lifeStage,
    newLifeStage = new.lifeStage,
    oldPackLabel = old?.packLabel,
    newPackLabel = new.packLabel,
    oldSku = old?.sku,
    newSku = new.sku,
    oldStatus = old?.status,
    newStatus = new.status,
    createdAt = createdAt,
)
