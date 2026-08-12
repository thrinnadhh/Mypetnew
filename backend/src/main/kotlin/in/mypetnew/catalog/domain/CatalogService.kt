package `in`.mypetnew.catalog.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import `in`.mypetnew.provider.domain.ProviderCapability
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

enum class ListingKind { PRODUCT, MEDICINE }

enum class CommerceMode { COMMERCE, VIEW_ONLY }

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
    val category: String = "other",
    val brand: String? = null,
    val description: String? = null,
    val petType: String? = null,
    val lifeStage: String? = null,
    val packLabel: String? = null,
    val sku: String? = null,
    val imageUrls: List<String> = emptyList(),
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
    val createdAt: Instant = Instant.now(),
)

interface CatalogPersistence {
    fun create(
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
        actionKey: String,
        requestFingerprint: String,
    ): Listing

    fun get(listingId: UUID): Listing?
    fun all(): List<Listing>
}

class CatalogService(
    private val persistence: CatalogPersistence = InMemoryCatalogPersistence(),
) {
    fun createListing(command: CreateListingCommand, actionKey: String): Listing {
        val normalized = BarcodeNormalizer.normalize(command.barcodeType, command.barcode)
        val cleanedCategory = command.category.trim().lowercase().ifBlank { "other" }
        val cleanedCommand = command.copy(
            category = cleanedCategory,
            brand = cleanOptional(command.brand, 100),
            description = cleanOptional(command.description, 2000),
            petType = cleanOptional(command.petType, 40),
            lifeStage = cleanOptional(command.lifeStage, 40),
            packLabel = cleanOptional(command.packLabel, 80),
            sku = cleanOptional(command.sku, 80),
            imageUrls = command.imageUrls.map { it.trim() },
        )
        validate(cleanedCommand)
        validateActionKey(actionKey)
        val commerceMode = if (cleanedCommand.kind == ListingKind.MEDICINE) CommerceMode.VIEW_ONLY else CommerceMode.COMMERCE
        val fingerprint = fingerprint(cleanedCommand, normalized, commerceMode)
        return persistence.create(cleanedCommand, normalized, commerceMode, actionKey, fingerprint)
    }

    fun getListing(listingId: UUID): Listing = persistence.get(listingId)
        ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    fun allListings(): List<Listing> = persistence.all()

    private fun validate(command: CreateListingCommand) {
        if (command.name.isBlank() || command.name.length > 160) {
            throw DomainException("LISTING_NAME_INVALID", "A valid listing name is required")
        }
        if (command.mrpPaise < 0 || command.sellingPricePaise < 0 || command.sellingPricePaise > command.mrpPaise) {
            throw DomainException("LISTING_PRICE_INVALID", "The listing price is invalid")
        }
        if (command.kind == ListingKind.PRODUCT && ProviderCapability.PRODUCT_STORE !in command.capabilities) {
            throw DomainException("CAPABILITY_REQUIRED", "The outlet cannot publish product listings")
        }
        if (
            command.kind == ListingKind.MEDICINE &&
            ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY !in command.capabilities
        ) {
            throw DomainException("CAPABILITY_REQUIRED", "The outlet cannot publish medicine listings")
        }
        if (!command.category.matches(Regex("[a-z0-9][a-z0-9-]{0,79}"))) {
            throw DomainException("LISTING_CATEGORY_INVALID", "The category must be a valid lowercase slug")
        }
        if (command.imageUrls.size > 5) {
            throw DomainException("LISTING_IMAGE_INVALID", "A listing cannot have more than 5 images")
        }
        if (command.imageUrls.distinct().size != command.imageUrls.size) {
            throw DomainException("LISTING_IMAGE_INVALID", "Listing image URLs must be unique")
        }
        command.imageUrls.forEach { url ->
            if (url.length > 2048 || !url.startsWith("https://", ignoreCase = true)) {
                throw DomainException("LISTING_IMAGE_INVALID", "Image URLs must be valid HTTPS URLs up to 2048 characters")
            }
        }
    }

    private fun validateActionKey(actionKey: String) {
        if (!actionKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun fingerprint(command: CreateListingCommand, normalized: String, commerceMode: CommerceMode): String {
        val canonical = listOf(
            command.organizationId,
            command.outletId,
            command.barcodeType,
            normalized,
            command.name.trim(),
            command.kind,
            commerceMode,
            command.mrpPaise,
            command.sellingPricePaise,
            command.category,
            command.brand.orEmpty(),
            command.description.orEmpty(),
            command.petType.orEmpty(),
            command.lifeStage.orEmpty(),
            command.packLabel.orEmpty(),
            command.sku.orEmpty(),
            command.imageUrls.joinToString(","),
        ).joinToString(":")
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun cleanOptional(value: String?, maxLength: Int): String? {
        if (value == null) return null
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return null
        if (trimmed.length > maxLength) {
            throw DomainException("LISTING_METADATA_INVALID", "Metadata field exceeds maximum allowed length of $maxLength characters")
        }
        return trimmed
    }
}

private class InMemoryCatalogPersistence : CatalogPersistence {
    private data class UniqueBarcode(
        val organizationId: UUID,
        val outletId: UUID,
        val type: BarcodeType,
        val value: String,
    )

    private val listings = mutableMapOf<UniqueBarcode, Listing>()
    private val listingsById = mutableMapOf<UUID, Listing>()
    private val idempotency = IdempotencyStore<Listing>()

    @Synchronized
    override fun create(
        command: CreateListingCommand,
        normalizedBarcode: String,
        commerceMode: CommerceMode,
        actionKey: String,
        requestFingerprint: String,
    ): Listing = idempotency.execute("listing:${command.outletId}", actionKey, requestFingerprint) {
        val unique = UniqueBarcode(command.organizationId, command.outletId, command.barcodeType, normalizedBarcode)
        listings[unique] ?: Listing(
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
            createdAt = Instant.now(),
        ).also {
            listings[unique] = it
            listingsById[it.id] = it
        }
    }

    @Synchronized
    override fun get(listingId: UUID): Listing? = listingsById[listingId]

    @Synchronized
    override fun all(): List<Listing> = listingsById.values.toList()
}
