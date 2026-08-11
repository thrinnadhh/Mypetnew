package `in`.mypetnew.application.web

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

data class PublicListingSummary(
    val id: String,
    val outletId: String,
    val name: String,
    val sellingPricePaise: Long,
    val currency: String,
    val commerceMode: String,
)

data class PageResponse<T>(
    val items: List<T>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

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
    ): PageResponse<PublicListingSummary> {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
        val visible = catalog.allListings()
            .asSequence()
            .filter { listing ->
                val outlet = providers.getOutlet(listing.outletId)
                outlet.status == ProviderStatus.ACTIVE && (listing.commerceMode.name == "VIEW_ONLY" || inventory.available(listing.id) > 0)
            }
            .sortedBy(PublicListingSort::name)
            .toList()
        val from = (page * pageSize).coerceAtMost(visible.size)
        val to = (from + pageSize).coerceAtMost(visible.size)
        val items = visible.subList(from, to).map { listing ->
            PublicListingSummary(
                listing.id.toString(),
                listing.outletId.toString(),
                listing.name,
                listing.sellingPricePaise,
                "INR",
                listing.commerceMode.name,
            )
        }
        return PageResponse(items, page, pageSize, to < visible.size)
    }

    private object PublicListingSort {
        fun name(listing: `in`.mypetnew.catalog.domain.Listing): String = listing.name.lowercase()
    }
}
