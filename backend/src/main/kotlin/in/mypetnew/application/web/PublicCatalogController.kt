package `in`.mypetnew.application.web

import `in`.mypetnew.common.error.DomainException
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
class PublicCatalogController {
    @GetMapping
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
    ): PageResponse<PublicListingSummary> {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
        return PageResponse(emptyList(), page, pageSize, false)
    }
}

