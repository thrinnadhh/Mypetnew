package `in`.mypetnew.customer.domain

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class CustomerFavourite(
    val customerId: UUID,
    val listingId: UUID,
    val createdAt: Instant,
)

data class CustomerFavouritePage(
    val items: List<CustomerFavourite>,
    val hasNext: Boolean,
)

interface CustomerFavouritePersistence {
    fun list(customerId: UUID, page: Int, pageSize: Int): CustomerFavouritePage
    fun put(favourite: CustomerFavourite): CustomerFavourite
    fun delete(customerId: UUID, listingId: UUID): Boolean
    fun eraseAll(customerId: UUID)
}

class InMemoryCustomerFavouritePersistence : CustomerFavouritePersistence {
    private val favourites = mutableMapOf<Pair<UUID, UUID>, CustomerFavourite>()

    @Synchronized
    override fun list(customerId: UUID, page: Int, pageSize: Int): CustomerFavouritePage {
        val ordered = favourites.values
            .filter { it.customerId == customerId }
            .sortedWith(compareByDescending<CustomerFavourite> { it.createdAt }.thenByDescending { it.listingId.toString() })
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= ordered.size.toLong()) return CustomerFavouritePage(emptyList(), false)
        val rows = ordered.drop(offset.toInt()).take(pageSize + 1)
        return CustomerFavouritePage(rows.take(pageSize), rows.size > pageSize)
    }

    @Synchronized
    override fun put(favourite: CustomerFavourite): CustomerFavourite {
        val key = favourite.customerId to favourite.listingId
        return favourites[key] ?: favourite.also { favourites[key] = it }
    }

    @Synchronized
    override fun delete(customerId: UUID, listingId: UUID): Boolean =
        favourites.remove(customerId to listingId) != null

    @Synchronized
    override fun eraseAll(customerId: UUID) {
        favourites.entries.removeIf { it.value.customerId == customerId }
    }
}

class CustomerFavouriteService(
    private val persistence: CustomerFavouritePersistence,
    private val catalog: CatalogService,
    private val providers: ProviderService,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun list(customerId: UUID, page: Int, pageSize: Int): CustomerFavouritePage {
        validatePagination(page, pageSize)
        return persistence.list(customerId, page, pageSize)
    }

    fun add(customerId: UUID, listingId: UUID): CustomerFavourite {
        val listing = catalog.getListing(listingId)
        val outlet = providers.getOutlet(listing.outletId)
        if (outlet.status != ProviderStatus.ACTIVE) unavailable()
        return persistence.put(
            CustomerFavourite(
                customerId = customerId,
                listingId = listingId,
                createdAt = clock.instant(),
            ),
        )
    }

    fun remove(customerId: UUID, listingId: UUID) {
        // DELETE is intentionally idempotent. Ownership is implicit in the composite key.
        persistence.delete(customerId, listingId)
    }

    fun eraseAll(customerId: UUID) = persistence.eraseAll(customerId)

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    private fun unavailable(): Nothing =
        throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
}
