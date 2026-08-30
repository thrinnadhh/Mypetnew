package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.MAX_PUBLIC_CART_REVALIDATION_LINES
import `in`.mypetnew.catalog.domain.MAX_PUBLIC_CATALOG_OFFSET
import `in`.mypetnew.catalog.domain.MAX_PUBLIC_CATALOG_PAGE_SIZE
import `in`.mypetnew.catalog.domain.PublicCatalogReadQuery
import `in`.mypetnew.catalog.domain.PublicCatalogReadRepository
import `in`.mypetnew.catalog.domain.PublicCatalogReadRow
import `in`.mypetnew.catalog.domain.PublicOutletReadQuery
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
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
        val offset = page.toLong() * pageSize.toLong()
        if (page < 0 || pageSize !in 1..MAX_PUBLIC_CATALOG_PAGE_SIZE || offset > MAX_PUBLIC_CATALOG_OFFSET) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    fun <T> paginate(items: List<T>, page: Int, pageSize: Int): PageResponse<T> {
        validate(page, pageSize)
        val total = items.size.toLong()
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= total) return PageResponse(emptyList(), page, pageSize, false)
        val from = offset.toInt()
        val to = (offset + pageSize.toLong()).coerceAtMost(total).toInt()
        return PageResponse(items.subList(from, to), page, pageSize, to.toLong() < total)
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

private fun normalizeOptionalFilter(value: String?, maxLength: Int = 160): String? {
    val normalized = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (normalized.length > maxLength) {
        throw DomainException("CATALOG_SEARCH_INVALID", "Catalog filter is too long")
    }
    return normalized.lowercase()
}

@RestController
@RequestMapping("/api/v1/public/outlets")
class PublicOutletController(
    private val providers: ProviderService,
    private val publicReads: PublicCatalogReadRepository? = null,
) {
    @GetMapping
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
        @RequestParam(required = false) capability: ProviderCapability?,
        @RequestParam(required = false) pincode: String?,
        @RequestParam(required = false) q: String?,
    ): PageResponse<PublicOutletSummary> {
        PaginationHelper.validate(page, pageSize)
        val pincodeFilter = normalizeOptionalPincode(pincode)
        val query = normalizeOptionalFilter(q)
        publicReads?.let { reads ->
            val result = reads.searchOutlets(PublicOutletReadQuery(page, pageSize, capability, pincodeFilter, query))
            return PageResponse(
                result.items.map { PublicOutletSummary(it.id.toString(), it.organizationId.toString(), it.name, it.capabilities, it.pickupEnabled) },
                result.page,
                result.pageSize,
                result.hasNext,
            )
        }

        val visible = providers.allOutlets()
            .filter { outlet ->
                outlet.status == ProviderStatus.ACTIVE &&
                    (capability == null || capability in outlet.capabilities) &&
                    (pincodeFilter == null || pincodeFilter in outlet.servicePinCodes) &&
                    (query == null || outlet.name.lowercase().contains(query))
            }
            .sortedWith(compareBy<ProviderOutlet> { it.name.lowercase() }.thenBy { it.id.toString() })
            .map { PublicOutletSummary(it.id.toString(), it.organizationId.toString(), it.name, it.capabilities.sortedBy { c -> c.name }, it.pickupEnabled) }
        return PaginationHelper.paginate(visible, page, pageSize)
    }

    @GetMapping("/{outletId}")
    fun get(
        @PathVariable outletId: UUID,
        @RequestParam(required = false) capability: ProviderCapability?,
        @RequestParam(required = false) pincode: String?,
    ): PublicOutletSummary {
        val pincodeFilter = normalizeOptionalPincode(pincode)
        publicReads?.let { reads ->
            val outlet = reads.outlet(outletId, capability, pincodeFilter)
                ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
            return PublicOutletSummary(outlet.id.toString(), outlet.organizationId.toString(), outlet.name, outlet.capabilities, outlet.pickupEnabled)
        }
        val outlet = providers.allOutlets().find { it.id == outletId }
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        if (outlet.status != ProviderStatus.ACTIVE ||
            (capability != null && capability !in outlet.capabilities) ||
            (pincodeFilter != null && pincodeFilter !in outlet.servicePinCodes)
        ) throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        return PublicOutletSummary(outlet.id.toString(), outlet.organizationId.toString(), outlet.name, outlet.capabilities.sortedBy { it.name }, outlet.pickupEnabled)
    }
}

@RestController
@RequestMapping("/api/v1/public/catalog")
class PublicCatalogController(
    private val catalog: CatalogService,
    private val inventory: InventoryService,
    private val providers: ProviderService,
    private val publicReads: PublicCatalogReadRepository? = null,
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
        @RequestParam(required = false) pincode: String?,
    ): PageResponse<PublicListingSummary> {
        PaginationHelper.validate(page, pageSize)
        val pincodeFilter = normalizeOptionalPincode(pincode)
        val query = normalizeOptionalFilter(q)
        val categoryFilter = normalizeOptionalFilter(category, 80)
        val brandFilter = normalizeOptionalFilter(brand, 100)
        val petTypeFilter = normalizeOptionalFilter(petType, 40)
        val lifeStageFilter = normalizeOptionalFilter(lifeStage, 40)

        publicReads?.let { reads ->
            val result = reads.search(
                PublicCatalogReadQuery(
                    page = page,
                    pageSize = pageSize,
                    search = query,
                    outletId = outletId,
                    kind = kind,
                    category = categoryFilter,
                    brand = brandFilter,
                    petType = petTypeFilter,
                    lifeStage = lifeStageFilter,
                    commerceMode = commerceMode,
                    availability = availability?.name,
                    sort = (sort ?: CatalogSortOption.NAME).name,
                    pincode = pincodeFilter,
                ),
            )
            return PageResponse(result.items.map(::summary), result.page, result.pageSize, result.hasNext)
        }

        val activeOutlets = providers.allOutlets().filter {
            it.status == ProviderStatus.ACTIVE && (pincodeFilter == null || pincodeFilter in it.servicePinCodes)
        }.associateBy { it.id }
        val filtered = catalog.allListings().mapNotNull { listing ->
            val outlet = activeOutlets[listing.outletId] ?: return@mapNotNull null
            ListingWithDetails(listing, outlet, inventory.available(listing.id))
        }.filter { item ->
            val listing = item.listing
            (outletId == null || listing.outletId == outletId) &&
                (kind == null || listing.kind == kind) &&
                (categoryFilter == null || listing.category.lowercase() == categoryFilter) &&
                (brandFilter == null || listing.brand?.lowercase() == brandFilter) &&
                (petTypeFilter == null || listing.petType?.lowercase() == petTypeFilter) &&
                (lifeStageFilter == null || listing.lifeStage?.lowercase() == lifeStageFilter) &&
                (commerceMode == null || listing.commerceMode == commerceMode) &&
                (query == null || matchesQuery(listing, item.outlet, query)) &&
                matchesAvailability(availability, item.availableQuantity)
        }
        val summaries = sortListings(filtered, sort ?: CatalogSortOption.NAME).map { item ->
            val l = item.listing
            val o = item.outlet
            PublicListingSummary(l.id.toString(), l.organizationId.toString(), l.outletId.toString(), o.name, l.name, l.kind,
                l.category, l.brand, l.petType, l.lifeStage, l.packLabel, l.mrpPaise, l.sellingPricePaise, "INR",
                l.commerceMode, item.availableQuantity, o.pickupEnabled, l.imageUrls.firstOrNull(), l.createdAt)
        }
        return PaginationHelper.paginate(summaries, page, pageSize)
    }

    @GetMapping("/{listingId}")
    fun getDetail(
        @PathVariable listingId: UUID,
        @RequestParam(required = false) pincode: String?,
    ): PublicListingDetail {
        val pincodeFilter = normalizeOptionalPincode(pincode)
        publicReads?.let { reads ->
            val row = reads.detail(listingId, pincodeFilter)
                ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
            if (!row.listingActive || !row.outletActive || (pincodeFilter != null && !row.serviceable)) {
                throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
            }
            return detail(row)
        }
        val listing = catalog.allListings().find { it.id == listingId }
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        val outlet = providers.allOutlets().find { it.id == listing.outletId }
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        if (outlet.status != ProviderStatus.ACTIVE || (pincodeFilter != null && pincodeFilter !in outlet.servicePinCodes)) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return PublicListingDetail(
            listing.id.toString(), listing.organizationId.toString(), listing.outletId.toString(), outlet.name, listing.name,
            listing.kind, listing.category, listing.brand, listing.petType, listing.lifeStage, listing.packLabel, listing.mrpPaise,
            listing.sellingPricePaise, "INR", listing.commerceMode, inventory.available(listing.id), outlet.pickupEnabled,
            listing.imageUrls.firstOrNull(), listing.createdAt, listing.description, listing.sku, listing.imageUrls,
        )
    }

    private data class ListingWithDetails(val listing: Listing, val outlet: ProviderOutlet, val availableQuantity: Int)
    private fun matchesQuery(listing: Listing, outlet: ProviderOutlet, query: String): Boolean =
        listing.name.lowercase().contains(query) || listing.brand?.lowercase()?.contains(query) == true ||
            listing.category.lowercase().contains(query) || outlet.name.lowercase().contains(query)
    private fun matchesAvailability(filter: AvailabilityFilter?, availableQuantity: Int): Boolean = when (filter) {
        AvailabilityFilter.IN_STOCK -> availableQuantity > 0
        AvailabilityFilter.OUT_OF_STOCK -> availableQuantity <= 0
        AvailabilityFilter.ANY, null -> true
    }
    private fun sortListings(items: List<ListingWithDetails>, sort: CatalogSortOption): List<ListingWithDetails> {
        val comparator = when (sort) {
            CatalogSortOption.NAME -> compareBy<ListingWithDetails> { it.listing.name.lowercase() }.thenBy { it.listing.id.toString() }
            CatalogSortOption.PRICE_ASC -> compareBy<ListingWithDetails> { it.listing.sellingPricePaise }.thenBy { it.listing.name.lowercase() }.thenBy { it.listing.id.toString() }
            CatalogSortOption.PRICE_DESC -> compareByDescending<ListingWithDetails> { it.listing.sellingPricePaise }.thenBy { it.listing.name.lowercase() }.thenBy { it.listing.id.toString() }
            CatalogSortOption.NEWEST -> compareByDescending<ListingWithDetails> { it.listing.createdAt }.thenBy { it.listing.name.lowercase() }.thenBy { it.listing.id.toString() }
        }
        return items.sortedWith(comparator)
    }
}

enum class CartRevalidationChange {
    PRICE_CHANGED,
    QUANTITY_REDUCED,
    PRODUCT_UNAVAILABLE,
    STORE_UNAVAILABLE,
    SERVICEABILITY_CHANGED,
}

data class PublicCartRevalidationLineRequest(
    val listingId: UUID,
    val quantity: Int,
    val observedUnitPricePaise: Long? = null,
)

data class PublicCartRevalidationRequest(
    val outletId: UUID,
    val pincode: String,
    val lines: List<PublicCartRevalidationLineRequest>,
)

data class PublicCartRevalidationLineResult(
    val listingId: String,
    val requestedQuantity: Int,
    val acceptedQuantity: Int,
    val changes: List<CartRevalidationChange>,
    val canonical: PublicListingDetail?,
)

data class PublicCartRevalidationResponse(
    val outletId: String,
    val pincode: String,
    val lines: List<PublicCartRevalidationLineResult>,
    val materialChanged: Boolean,
    val checkoutAllowed: Boolean,
)

@RestController
@RequestMapping("/api/v1/public/cart")
class PublicCartRevalidationController(
    private val catalog: CatalogService,
    private val inventory: InventoryService,
    private val providers: ProviderService,
    private val publicReads: PublicCatalogReadRepository? = null,
) {
    @PostMapping("/revalidate")
    fun revalidate(@RequestBody request: PublicCartRevalidationRequest): PublicCartRevalidationResponse {
        val pincode = normalizeOptionalPincode(request.pincode)
            ?: throw DomainException("PIN_CODE_INVALID", "PIN code is required")
        validateRequest(request)
        val ids = request.lines.map { it.listingId }
        val snapshots = publicReads?.snapshots(ids, pincode) ?: fallbackSnapshots(ids, pincode)
        if (snapshots.values.any { it.outletId != request.outletId }) {
            throw DomainException("CART_INVALID", "Cart lines must belong to one outlet")
        }
        val requestedById = request.lines.associateBy { it.listingId }
        val results = ids.sortedBy(UUID::toString).map { listingId ->
            val input = requestedById.getValue(listingId)
            val row = snapshots[listingId]
            when {
                row == null || !row.listingActive || row.commerceMode != CommerceMode.COMMERCE -> unavailable(input, CartRevalidationChange.PRODUCT_UNAVAILABLE)
                !row.outletActive -> unavailable(input, CartRevalidationChange.STORE_UNAVAILABLE)
                !row.serviceable -> unavailable(input, CartRevalidationChange.SERVICEABILITY_CHANGED)
                else -> {
                    val accepted = input.quantity.coerceAtMost(row.availableQuantity.coerceAtLeast(0))
                    val changes = buildList {
                        if (input.observedUnitPricePaise != null && input.observedUnitPricePaise != row.sellingPricePaise) add(CartRevalidationChange.PRICE_CHANGED)
                        if (accepted < input.quantity) add(CartRevalidationChange.QUANTITY_REDUCED)
                        if (accepted == 0) add(CartRevalidationChange.PRODUCT_UNAVAILABLE)
                    }.distinct()
                    PublicCartRevalidationLineResult(
                        listingId.toString(), input.quantity, accepted, changes,
                        if (accepted > 0) detail(row) else null,
                    )
                }
            }
        }
        return PublicCartRevalidationResponse(
            request.outletId.toString(),
            pincode,
            results,
            results.any { it.changes.isNotEmpty() },
            results.all { it.acceptedQuantity > 0 && it.changes.none { change -> change in setOf(CartRevalidationChange.PRODUCT_UNAVAILABLE, CartRevalidationChange.STORE_UNAVAILABLE, CartRevalidationChange.SERVICEABILITY_CHANGED) } },
        )
    }

    private fun validateRequest(request: PublicCartRevalidationRequest) {
        if (request.lines.isEmpty() || request.lines.size > MAX_PUBLIC_CART_REVALIDATION_LINES) {
            throw DomainException("CART_INVALID", "Cart line count is outside the allowed range")
        }
        if (request.lines.map { it.listingId }.distinct().size != request.lines.size) {
            throw DomainException("CART_INVALID", "Duplicate cart lines are not allowed")
        }
        request.lines.forEach { line ->
            if (line.quantity !in 1..999 || line.observedUnitPricePaise?.let { it < 0 || !isSafePaise(it) } == true) {
                throw DomainException("CART_INVALID", "Cart line values are invalid")
            }
        }
    }

    private fun isSafePaise(value: Long): Boolean = value <= 9_000_000_000_000_000L

    private fun unavailable(input: PublicCartRevalidationLineRequest, change: CartRevalidationChange) =
        PublicCartRevalidationLineResult(input.listingId.toString(), input.quantity, 0, listOf(change), null)

    private fun fallbackSnapshots(ids: List<UUID>, pincode: String): Map<UUID, PublicCatalogReadRow> {
        val outlets = providers.allOutlets().associateBy { it.id }
        return catalog.allListings().filter { it.id in ids }.associate { listing ->
            val outlet = outlets[listing.outletId] ?: return@associate listing.id to fallbackMissingProvider(listing)
            listing.id to PublicCatalogReadRow(
                listing.id, listing.organizationId, listing.outletId, outlet.name, listing.name, listing.kind, listing.category,
                listing.brand, listing.description, listing.petType, listing.lifeStage, listing.packLabel, listing.sku,
                listing.mrpPaise, listing.sellingPricePaise, listing.commerceMode, inventory.available(listing.id),
                outlet.pickupEnabled, true, outlet.status == ProviderStatus.ACTIVE, pincode in outlet.servicePinCodes,
                listing.imageUrls, listing.createdAt,
            )
        }
    }

    private fun fallbackMissingProvider(listing: Listing) = PublicCatalogReadRow(
        listing.id, listing.organizationId, listing.outletId, "", listing.name, listing.kind, listing.category, listing.brand,
        listing.description, listing.petType, listing.lifeStage, listing.packLabel, listing.sku, listing.mrpPaise,
        listing.sellingPricePaise, listing.commerceMode, 0, false, true, false, false, listing.imageUrls, listing.createdAt,
    )
}

private fun summary(row: PublicCatalogReadRow) = PublicListingSummary(
    row.id.toString(), row.organizationId.toString(), row.outletId.toString(), row.outletName, row.name, row.kind,
    row.category, row.brand, row.petType, row.lifeStage, row.packLabel, row.mrpPaise, row.sellingPricePaise, "INR",
    row.commerceMode, row.availableQuantity, row.pickupEnabled, row.imageUrls.firstOrNull(), row.createdAt,
)

private fun detail(row: PublicCatalogReadRow) = PublicListingDetail(
    row.id.toString(), row.organizationId.toString(), row.outletId.toString(), row.outletName, row.name, row.kind,
    row.category, row.brand, row.petType, row.lifeStage, row.packLabel, row.mrpPaise, row.sellingPricePaise, "INR",
    row.commerceMode, row.availableQuantity, row.pickupEnabled, row.imageUrls.firstOrNull(), row.createdAt,
    row.description, row.sku, row.imageUrls,
)
