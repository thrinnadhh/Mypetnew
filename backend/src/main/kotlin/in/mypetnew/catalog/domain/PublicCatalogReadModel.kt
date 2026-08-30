package `in`.mypetnew.catalog.domain

import java.time.Instant
import java.util.UUID

const val MAX_PUBLIC_CATALOG_PAGE_SIZE = 50
const val MAX_PUBLIC_CATALOG_OFFSET = 100_000
const val MAX_PUBLIC_CART_REVALIDATION_LINES = 50

data class PublicCatalogReadQuery(
    val page: Int,
    val pageSize: Int,
    val search: String? = null,
    val outletId: UUID? = null,
    val kind: ListingKind? = null,
    val category: String? = null,
    val brand: String? = null,
    val petType: String? = null,
    val lifeStage: String? = null,
    val commerceMode: CommerceMode? = null,
    val availability: String? = null,
    val sort: String,
    val pincode: String? = null,
)

data class PublicCatalogReadRow(
    val id: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val outletName: String,
    val name: String,
    val kind: ListingKind,
    val category: String,
    val brand: String?,
    val description: String?,
    val petType: String?,
    val lifeStage: String?,
    val packLabel: String?,
    val sku: String?,
    val mrpPaise: Long,
    val sellingPricePaise: Long,
    val commerceMode: CommerceMode,
    val availableQuantity: Int,
    val pickupEnabled: Boolean,
    val listingActive: Boolean,
    val outletActive: Boolean,
    val serviceable: Boolean,
    val imageUrls: List<String>,
    val createdAt: Instant,
)

data class PublicCatalogReadPage(
    val items: List<PublicCatalogReadRow>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

interface PublicCatalogReadRepository {
    fun search(query: PublicCatalogReadQuery): PublicCatalogReadPage

    /** Returns null only when the listing itself does not exist. */
    fun detail(listingId: UUID, pincode: String?): PublicCatalogReadRow?

    /**
     * Reads all requested listing snapshots in bounded SQL. Missing ids are intentionally absent
     * from the returned map so callers can fail closed without exposing foreign/non-public data.
     */
    fun snapshots(listingIds: Collection<UUID>, pincode: String): Map<UUID, PublicCatalogReadRow>
}
