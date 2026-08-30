package `in`.mypetnew.commerce.domain

import `in`.mypetnew.catalog.domain.CommerceMode
import java.util.UUID

data class CommerceListingSnapshot(
    val id: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val name: String,
    val commerceMode: CommerceMode,
    val active: Boolean,
    val sellingPricePaise: Long,
)

fun interface CommerceListingAuthority {
    /**
     * Locks requested catalog rows in deterministic listing-id order for the caller's transaction.
     * Production implementations must return inactive rows too so commerce can fail stale state explicitly.
     */
    fun lockForCommerce(listingIds: Collection<UUID>): Map<UUID, CommerceListingSnapshot>
}
