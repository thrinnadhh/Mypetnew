package `in`.mypetnew.catalog.domain

import java.util.UUID

interface BarcodeResolutionLookup {
    fun findListingId(
        organizationId: UUID,
        outletId: UUID,
        barcodeType: BarcodeType,
        normalizedBarcode: String,
    ): UUID?
}

data class BarcodeResolutionResult(
    val barcodeType: BarcodeType,
    val normalizedBarcode: String,
    val listing: Listing?,
)

class BarcodeResolutionService(
    private val catalog: CatalogService,
    private val lookup: BarcodeResolutionLookup,
) {
    fun resolve(
        organizationId: UUID,
        outletId: UUID,
        barcodeType: BarcodeType,
        rawBarcode: String,
    ): BarcodeResolutionResult {
        val normalized = BarcodeNormalizer.normalize(barcodeType, rawBarcode)
        val listing = lookup.findListingId(organizationId, outletId, barcodeType, normalized)
            ?.let { catalog.getManagedListing(organizationId, outletId, it) }
        return BarcodeResolutionResult(barcodeType, normalized, listing)
    }
}
