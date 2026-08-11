package `in`.mypetnew.catalog.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import `in`.mypetnew.provider.domain.ProviderCapability
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
)

class CatalogService {
    private data class UniqueBarcode(
        val organizationId: UUID,
        val outletId: UUID,
        val type: BarcodeType,
        val value: String,
    )

    private val listings = mutableMapOf<UniqueBarcode, Listing>()
    private val idempotency = IdempotencyStore<Listing>()

    @Synchronized
    fun createListing(command: CreateListingCommand, actionKey: String): Listing {
        val normalized = BarcodeNormalizer.normalize(command.barcodeType, command.barcode)
        val fingerprint = listOf(
            command.organizationId,
            command.outletId,
            command.barcodeType,
            normalized,
            command.name,
            command.kind,
            command.mrpPaise,
            command.sellingPricePaise,
        ).joinToString(":")
        return idempotency.execute("listing", actionKey, fingerprint) {
            validate(command)
            val unique = UniqueBarcode(command.organizationId, command.outletId, command.barcodeType, normalized)
            listings[unique] ?: Listing(
                id = UUID.randomUUID(),
                organizationId = command.organizationId,
                outletId = command.outletId,
                barcodeType = command.barcodeType,
                normalizedBarcode = normalized,
                name = command.name.trim(),
                kind = command.kind,
                commerceMode = if (command.kind == ListingKind.MEDICINE) CommerceMode.VIEW_ONLY else CommerceMode.COMMERCE,
                mrpPaise = command.mrpPaise,
                sellingPricePaise = command.sellingPricePaise,
            ).also { listings[unique] = it }
        }
    }

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
    }
}

