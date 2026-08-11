package `in`.mypetnew.commerce.domain

import `in`.mypetnew.common.error.DomainException
import java.util.UUID

data class Cart(
    val ownerId: UUID,
    val outletId: UUID,
    val lines: Map<UUID, Int>,
)

sealed interface CartAddResult {
    data class Added(val cart: Cart) : CartAddResult
    data class OutletConflict(val currentOutletId: UUID, val requestedOutletId: UUID) : CartAddResult
}

class CartService {
    private val carts = mutableMapOf<UUID, Cart>()

    @Synchronized
    fun add(ownerId: UUID, outletId: UUID, listingId: UUID, quantity: Int): CartAddResult {
        if (quantity <= 0 || quantity > 100) {
            throw DomainException("QUANTITY_INVALID", "Quantity must be between 1 and 100")
        }
        val existing = carts[ownerId]
        if (existing != null && existing.outletId != outletId) {
            return CartAddResult.OutletConflict(existing.outletId, outletId)
        }
        val lines = existing?.lines.orEmpty().toMutableMap()
        lines[listingId] = Math.addExact(lines[listingId] ?: 0, quantity)
        val updated = Cart(ownerId, outletId, lines.toMap())
        carts[ownerId] = updated
        return CartAddResult.Added(updated)
    }

    @Synchronized
    fun get(ownerId: UUID): Cart = carts[ownerId]
        ?: throw DomainException("CART_NOT_FOUND", "The cart is empty")
}

