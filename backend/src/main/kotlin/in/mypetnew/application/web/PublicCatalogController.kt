package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class PublicOutletSummary(
    val id: String,
    val organizationId: String,
    val name: String,
    val capabilities: List<ProviderCapability>,
    val pickupEnabled: Boolean,
)

data class PublicListingSummary(
    val id: String,
    val organizationId: String,
    val outletId: String,
    val outletName: String,
    val name: String,
    val kind: ListingKind,
    val category: String,
    val brand: String?,
    val petType: String?,
    val lifeStage: String?,
    val packLabel: String?,
    val mrpPaise: Long,
    val sellingPricePaise: Long,
    val currency: String = "INR",
    val commerceMode: CommerceMode,
    val availableQuantity: Int,
    val pickupEnabled: Boolean,
    val primaryImageUrl: String?,
    val createdAt: Instant,
)

data class PublicListingDetail(
    val id: String,
    val organizationId: String,
    val outletId: String,
    val outletName: String,
    val name: String,
    val kind: ListingKind,
    val category: String,
    val brand: String?,
    val petType: String?,
    val lifeStage: String?,
    val packLabel: String?,
    val mrpPaise: Long,
    val sellingPricePaise: Long,
    val currency: String = "INR",
    val commerceMode: CommerceMode,
    val availableQuantity: Int,
    val pickupEnabled: Boolean,
    val primaryImageUrl: String?,
    val createdAt: Instant,
    val description: String?,
    val sku: String?,
    val imageUrls: List<String>,
)

enum class AvailabilityFilter { ANY, IN_STOCK, OUT_OF_STOCK }

enum class CatalogSortOption { NAME, PRICE_ASC, PRICE_DESC, NEWEST }

data class PageResponse<T>(
    val items: List<T>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

object PaginationHelper {
    fun validate(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    fun <T> paginate(items: List<T>, page: Int, pageSize: Int): PageResponse<T> {
        validate(page, pageSize)
        val total = items.size.toLong()
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= total) {
            return PageResponse(
                items = emptyList(),
                page = page,
                pageSize = pageSize,
                hasNext = false,
            )
        }
        val from = offset.toInt()
        val to = (offset + pageSize.toLong()).coerceAtMost(total).toInt()
        val pagedItems = items.subList(from, to)
        return PageResponse(
            items = pagedItems,
            page = page,
            pageSize = pageSize,
            hasNext = to.toLong() < total,
        )
    }
}

private fun normalizeOptionalPincode(pincode: String?): String? {
    if (pincode == null) return null
    val normalized = pincode.trim()
    if (!normalized.matches(Regex("[1-9][0-9]{5}"))) {
        throw DomainException("PIN_CODE_INVALID", "PIN code must contain exactly six digits")
    }
    return normalized
}

@RestController
@RequestMapping("/api/v1/public/outlets")
class PublicOutletController(
    private val providers: ProviderService,
) {
    @GetMapping
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
        @RequestParam(required = false) capability: ProviderCapability?,
        @RequestParam(required = false) pincode: String?,
        @RequestParam(required = false) q: String?,
    ): PageResponse<PublicOutletSummary> {
        val query = q?.trim()?.lowercase()
        val pincodeFilter = normalizeOptionalPincode(pincode)
        val visible = providers.allOutlets()
            .filter { outlet ->
                outlet.status == ProviderStatus.ACTIVE &&
                (capability == null || capability in outlet.capabilities) &&
                (pincodeFilter == null || pincodeFilter in outlet.servicePinCodes) &&
                (query.isNullOrEmpty() || outlet.name.lowercase().contains(query))
            }
            .sortedWith(compareBy<ProviderOutlet> { it.name.lowercase() }.thenBy { it.id.toString() })
            .map { outlet ->
                PublicOutletSummary(
                    id = outlet.id.toString(),
                    organizationId = outlet.organizationId.toString(),
                    name = outlet.name,
                    capabilities = outlet.capabilities.sortedBy { it.name },
                    pickupEnabled = outlet.pickupEnabled,
                )
            }

        return PaginationHelper.paginate(visible, page, pageSize)
    }

    @GetMapping("/{outletId}")
    fun get(@PathVariable outletId: UUID): PublicOutletSummary {
        val outlet = providers.allOutlets().find { it.id == outletId }
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        if (outlet.status != ProviderStatus.ACTIVE) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return PublicOutletSummary(
            id = outlet.id.toString(),
            organizationId = outlet.organizationId.toString(),
            name = outlet.name,
            capabilities = outlet.capabilities.sortedBy { it.name },
            pickupEnabled = outlet.pickupEnabled,
        )
    }
}

@RestController
@RequestMapping("/api/v1/public/catalog")
class PublicCatalogController(
    private val catalog: CatalogService,
    private val inventory: InventoryService,
    private val providers: ProviderService,
) {
    @GetMapping
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) outletId: UUID?,
        @RequestParam(required = false) kind: ListingKind?,
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) brand: String?,
        @RequestParam(required = false) petType: String?,
        @RequestParam(required = false) lifeStage: String?,
        @RequestParam(required = false) commerceMode: CommerceMode?,
        @RequestParam(required = false) availability: AvailabilityFilter?,
        @RequestParam(required = false) sort: CatalogSortOption?,
    ): PageResponse<PublicListingSummary> {
        val activeOutlets = providers.allOutlets()
            .filter { it.status == ProviderStatus.ACTIVE }
            .associateBy { it.id }

        val query = q?.trim()?.lowercase()
        val categoryFilter = category?.trim()?.lowercase()
        val brandFilter = brand?.trim()?.lowercase()
        val petTypeFilter = petType?.trim()?.lowercase()
        val lifeStageFilter = lifeStage?.trim()?.lowercase()

        val filtered = catalog.allListings()
            .mapNotNull { listing ->
                val outlet = activeOutlets[listing.outletId] ?: return@mapNotNull null
                val availableQty = inventory.available(listing.id)
                ListingWithDetails(listing, outlet, availableQty)
            }
            .filter { item ->
                val listing = item.listing
                val outlet = item.outlet
                val availableQty = item.availableQuantity

                (outletId == null || listing.outletId == outletId) &&
                (kind == null || listing.kind == kind) &&
                (categoryFilter.isNullOrEmpty() || listing.category.lowercase() == categoryFilter) &&
                (brandFilter.isNullOrEmpty() || listing.brand?.lowercase() == brandFilter) &&
                (petTypeFilter.isNullOrEmpty() || listing.petType?.lowercase() == petTypeFilter) &&
                (lifeStageFilter.isNullOrEmpty() || listing.lifeStage?.lowercase() == lifeStageFilter) &&
                (commerceMode == null || listing.commerceMode == commerceMode) &&
                (query.isNullOrEmpty() || matchesQuery(listing, outlet, query)) &&
                matchesAvailability(availability, availableQty)
            }

        val sorted = sortListings(filtered, sort ?: CatalogSortOption.NAME)

        val summaries = sorted.map { item ->
            val l = item.listing
            val o = item.outlet
            PublicListingSummary(
                id = l.id.toString(),
                organizationId = l.organizationId.toString(),
                outletId = l.outletId.toString(),
                outletName = o.name,
                name = l.name,
                kind = l.kind,
                category = l.category,
                brand = l.brand,
                petType = l.petType,
                lifeStage = l.lifeStage,
                packLabel = l.packLabel,
                mrpPaise = l.mrpPaise,
                sellingPricePaise = l.sellingPricePaise,
                currency = "INR",
                commerceMode = l.commerceMode,
                availableQuantity = item.availableQuantity,
                pickupEnabled = o.pickupEnabled,
                primaryImageUrl = l.imageUrls.firstOrNull(),
                createdAt = l.createdAt,
            )
        }
        return PaginationHelper.paginate(summaries, page, pageSize)
    }

    @GetMapping("/{listingId}")
    fun getDetail(@PathVariable listingId: UUID): PublicListingDetail {
        val listing = catalog.allListings().find { it.id == listingId }
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        val outlet = providers.allOutlets().find { it.id == listing.outletId }
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        if (outlet.status != ProviderStatus.ACTIVE) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        val availableQty = inventory.available(listing.id)

        return PublicListingDetail(
            id = listing.id.toString(),
            organizationId = listing.organizationId.toString(),
            outletId = listing.outletId.toString(),
            outletName = outlet.name,
            name = listing.name,
            kind = listing.kind,
            category = listing.category,
            brand = listing.brand,
            petType = listing.petType,
            lifeStage = listing.lifeStage,
            packLabel = listing.packLabel,
            mrpPaise = listing.mrpPaise,
            sellingPricePaise = listing.sellingPricePaise,
            currency = "INR",
            commerceMode = listing.commerceMode,
            availableQuantity = availableQty,
            pickupEnabled = outlet.pickupEnabled,
            primaryImageUrl = listing.imageUrls.firstOrNull(),
            createdAt = listing.createdAt,
            description = listing.description,
            sku = listing.sku,
            imageUrls = listing.imageUrls,
        )
    }

    private data class ListingWithDetails(
        val listing: Listing,
        val outlet: ProviderOutlet,
        val availableQuantity: Int,
    )

    private fun matchesQuery(listing: Listing, outlet: ProviderOutlet, query: String): Boolean {
        return listing.name.lowercase().contains(query) ||
               (listing.brand != null && listing.brand.lowercase().contains(query)) ||
               listing.category.lowercase().contains(query) ||
               outlet.name.lowercase().contains(query)
    }

    private fun matchesAvailability(filter: AvailabilityFilter?, availableQuantity: Int): Boolean {
        return when (filter) {
            AvailabilityFilter.IN_STOCK -> availableQuantity > 0
            AvailabilityFilter.OUT_OF_STOCK -> availableQuantity <= 0
            AvailabilityFilter.ANY, null -> true
        }
    }

    private fun sortListings(
        items: List<ListingWithDetails>,
        sort: CatalogSortOption,
    ): List<ListingWithDetails> {
        val comparator = when (sort) {
            CatalogSortOption.NAME -> compareBy<ListingWithDetails> { it.listing.name.lowercase() }
                .thenBy { it.listing.id.toString() }
            CatalogSortOption.PRICE_ASC -> compareBy<ListingWithDetails> { it.listing.sellingPricePaise }
                .thenBy { it.listing.name.lowercase() }
                .thenBy { it.listing.id.toString() }
            CatalogSortOption.PRICE_DESC -> compareByDescending<ListingWithDetails> { it.listing.sellingPricePaise }
                .thenBy { it.listing.name.lowercase() }
                .thenBy { it.listing.id.toString() }
            CatalogSortOption.NEWEST -> compareByDescending<ListingWithDetails> { it.listing.createdAt }
                .thenBy { it.listing.name.lowercase() }
                .thenBy { it.listing.id.toString() }
        }
        return items.sortedWith(comparator)
    }
}
