package `in`.mypetnew.catalog.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import java.time.Instant
import java.util.UUID

enum class StockReason {
    RECEIPT,
    COUNT_CORRECTION,
    ORDER_RESERVE,
    ORDER_RELEASE,
    ORDER_FULFIL,
    POS_SALE,
}

data class StockMovement(
    val id: UUID,
    val listingId: UUID,
    val reason: StockReason,
    val quantityDelta: Int,
    val resultingOnHand: Int,
    val resultingReserved: Int,
    val sourceReference: String,
    val occurredAt: Instant = Instant.now(),
)

class InventoryService {
    private data class StockState(
        var onHand: Int = 0,
        var reserved: Int = 0,
        val movements: MutableList<StockMovement> = mutableListOf(),
    )

    private val stocks = mutableMapOf<UUID, StockState>()
    private val movementKeys = IdempotencyStore<StockMovement>()

    @Synchronized
    fun adjust(listingId: UUID, delta: Int, reason: StockReason, idempotencyKey: String): StockMovement {
        val fingerprint = "$listingId:$delta:$reason"
        return movementKeys.execute("stock-adjust", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.onHand + delta < state.reserved || state.onHand + delta < 0) insufficient()
            state.onHand += delta
            movement(state, listingId, reason, delta, idempotencyKey)
        }
    }

    @Synchronized
    fun reserve(listingId: UUID, quantity: Int, sourceReference: String): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-reserve", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.onHand - state.reserved < quantity) insufficient()
            state.reserved += quantity
            movement(state, listingId, StockReason.ORDER_RESERVE, 0, sourceReference)
        }
    }

    @Synchronized
    fun release(listingId: UUID, quantity: Int, sourceReference: String): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-release", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.reserved < quantity) {
                throw DomainException("STOCK_RESERVATION_MISSING", "The stock reservation is unavailable")
            }
            state.reserved -= quantity
            movement(state, listingId, StockReason.ORDER_RELEASE, 0, sourceReference)
        }
    }

    @Synchronized
    fun fulfil(listingId: UUID, quantity: Int, sourceReference: String): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-fulfil", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.reserved < quantity || state.onHand < quantity) insufficient()
            state.reserved -= quantity
            state.onHand -= quantity
            movement(state, listingId, StockReason.ORDER_FULFIL, -quantity, sourceReference)
        }
    }

    @Synchronized
    fun sell(listingId: UUID, quantity: Int, sourceReference: String): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-pos", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.onHand - state.reserved < quantity) insufficient()
            state.onHand -= quantity
            movement(state, listingId, StockReason.POS_SALE, -quantity, sourceReference)
        }
    }

    @Synchronized
    fun available(listingId: UUID): Int = stocks[listingId]?.let { it.onHand - it.reserved } ?: 0

    @Synchronized
    fun reserved(listingId: UUID): Int = stocks[listingId]?.reserved ?: 0

    @Synchronized
    fun history(listingId: UUID): List<StockMovement> = stocks[listingId]?.movements?.toList().orEmpty()

    private fun movement(
        state: StockState,
        listingId: UUID,
        reason: StockReason,
        delta: Int,
        sourceReference: String,
    ): StockMovement = StockMovement(
        id = UUID.randomUUID(),
        listingId = listingId,
        reason = reason,
        quantityDelta = delta,
        resultingOnHand = state.onHand,
        resultingReserved = state.reserved,
        sourceReference = sourceReference,
    ).also(state.movements::add)

    private fun requirePositive(quantity: Int) {
        if (quantity <= 0) throw DomainException("QUANTITY_INVALID", "Quantity must be positive")
    }

    private fun insufficient(): Nothing = throw DomainException("INSUFFICIENT_STOCK", "Stock is unavailable")
}

