package `in`.mypetnew.application.web

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.customer.domain.CustomerFavourite
import `in`.mypetnew.customer.domain.CustomerFavouriteService
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class CustomerFavouriteResponse(
    val listingId: UUID,
    val createdAt: Instant,
)

@RestController
@RequestMapping("/api/v1/customer/favourites")
class CustomerFavouriteController(
    private val favourites: CustomerFavouriteService,
) {
    @GetMapping
    fun list(
        authentication: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
    ): PageResponse<CustomerFavouriteResponse> {
        val customerId = customerId(authentication)
        val result = favourites.list(customerId, page, pageSize)
        return PageResponse(
            items = result.items.map(::response),
            page = page,
            pageSize = pageSize,
            hasNext = result.hasNext,
        )
    }

    @PutMapping("/{listingId}")
    fun add(
        authentication: Authentication,
        @PathVariable listingId: UUID,
    ): CustomerFavouriteResponse = response(favourites.add(customerId(authentication), listingId))

    @DeleteMapping("/{listingId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(
        authentication: Authentication,
        @PathVariable listingId: UUID,
    ) {
        favourites.remove(customerId(authentication), listingId)
    }

    private fun customerId(authentication: Authentication): UUID {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.CUSTOMER)
        return principal.actorId
    }

    private fun response(favourite: CustomerFavourite) = CustomerFavouriteResponse(
        listingId = favourite.listingId,
        createdAt = favourite.createdAt,
    )
}
