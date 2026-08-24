package `in`.mypetnew.catalog.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import java.time.Instant
import java.util.UUID
import kotlin.math.abs

enum class StockReason {
    OPENING_BALANCE,
    MANUAL_INCREASE,
    MANUAL_DECREASE,
    RECEIPT,
    COUNT_CORRECTION,
    ORDER_RESERVE,
    ORDER_RELEASE,
    ORDER_FULFIL,
    POS_SALE,
}

data class InventoryScope(
    val organizationId: UUID,
    val outletId: UUID,
    val listingId: UUID,
)

data class InventoryBalance(
    val organizationId: UUID,
    val outletId: UUID,
    val listingId: UUID,
    val onHand: Int,
    val reserved: Int,
    val version: Long,
    val updatedAt: Instant,
) {
    val available: Int get() = onHand - reserved
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
    val organizationId: UUID? = null,
    val outletId: UUID? = null,
    val actorId: UUID = UUID(0L, 0L),
    val idempotencyKey: String = "",
    val sourceType: String = "",
)

data class InventoryHistoryPage(
    val items: List<StockMovement>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

interface InventoryPersistence {
    fun adjust(
        listingId: UUID,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement

    fun adjustScoped(
        scope: InventoryScope,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String?,
        referenceId: String?,
    ): StockMovement = adjust(scope.listingId, delta, reason, idempotencyKey, actorId, traceId).copy(
        organizationId = scope.organizationId,
        outletId = scope.outletId,
        actorId = actorId,
        idempotencyKey = idempotencyKey,
        sourceType = referenceType ?: reason.name,
        sourceReference = referenceId ?: idempotencyKey,
    )

    fun reserve(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement

    fun release(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement

    fun fulfil(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement

    fun sell(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement

    fun available(listingId: UUID): Int
    fun reserved(listingId: UUID): Int
    fun history(listingId: UUID): List<StockMovement>

    fun balance(scope: InventoryScope): InventoryBalance {
        val reserved = reserved(scope.listingId)
        val available = available(scope.listingId)
        return InventoryBalance(
            organizationId = scope.organizationId,
            outletId = scope.outletId,
            listingId = scope.listingId,
            onHand = Math.addExact(available, reserved),
            reserved = reserved,
            version = 0,
            updatedAt = Instant.EPOCH,
        )
    }

    fun history(scope: InventoryScope, page: Int, pageSize: Int): InventoryHistoryPage {
        val boundedSize = pageSize.coerceIn(1, 100)
        val boundedPage = page.coerceAtLeast(0)
        val all = history(scope.listingId).asReversed()
        val start = (boundedPage.toLong() * boundedSize.toLong()).coerceAtMost(all.size.toLong()).toInt()
        val selected = all.drop(start).take(boundedSize + 1)
        return InventoryHistoryPage(
            items = selected.take(boundedSize),
            page = boundedPage,
            pageSize = boundedSize,
            hasNext = selected.size > boundedSize,
        )
    }

    fun requireReconciled(scope: InventoryScope): InventoryBalance {
        val balance = balance(scope)
        val ledgerOnHand = history(scope.listingId).sumOf { it.quantityDelta.toLong() }
        if (ledgerOnHand != balance.onHand.toLong()) {
            throw DomainException("INVENTORY_INTEGRITY_ERROR", "Inventory ledger and balance do not reconcile")
        }
        return balance
    }
}

class InventoryService(
    private val persistence: InventoryPersistence = InMemoryInventoryPersistence(),
) {
    fun adjust(
        listingId: UUID,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
        traceId: String = SYSTEM_TRACE_ID,
    ): StockMovement {
        requireNonZeroDelta(delta)
        return persistence.adjust(listingId, delta, reason, idempotencyKey, actorId, traceId)
    }

    fun adjustMerchant(
        scope: InventoryScope,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String? = null,
        referenceId: String? = null,
    ): StockMovement {
        validateMerchantAdjustment(delta, reason, referenceType, referenceId)
        return persistence.adjustScoped(
            scope,
            delta,
            reason,
            idempotencyKey,
            actorId,
            traceId,
            referenceType,
            referenceId,
        )
    }

    fun reserve(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
        traceId: String = SYSTEM_TRACE_ID,
    ): StockMovement = persistence.reserve(listingId, quantity, sourceReference, actorId, traceId)

    fun release(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
        traceId: String = SYSTEM_TRACE_ID,
    ): StockMovement = persistence.release(listingId, quantity, sourceReference, actorId, traceId)

    fun fulfil(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
        traceId: String = SYSTEM_TRACE_ID,
    ): StockMovement = persistence.fulfil(listingId, quantity, sourceReference, actorId, traceId)

    fun sell(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID = SYSTEM_ACTOR_ID,
        traceId: String = SYSTEM_TRACE_ID,
    ): StockMovement = persistence.sell(listingId, quantity, sourceReference, actorId, traceId)

    fun available(listingId: UUID): Int = persistence.available(listingId)
    fun reserved(listingId: UUID): Int = persistence.reserved(listingId)
    fun history(listingId: UUID): List<StockMovement> = persistence.history(listingId)
    fun balance(scope: InventoryScope): InventoryBalance = persistence.balance(scope)
    fun history(scope: InventoryScope, page: Int = 0, pageSize: Int = 25): InventoryHistoryPage =
        persistence.history(scope, page, pageSize)

    fun requireReconciled(scope: InventoryScope): InventoryBalance = persistence.requireReconciled(scope)

    private fun validateMerchantAdjustment(
        delta: Int,
        reason: StockReason,
        referenceType: String?,
        referenceId: String?,
    ) {
        requireNonZeroDelta(delta)
        if (abs(delta.toLong()) > MAX_MANUAL_ADJUSTMENT_UNITS) invalidQuantity()
        when (reason) {
            StockReason.MANUAL_INCREASE -> if (delta <= 0) invalidReason()
            StockReason.MANUAL_DECREASE -> if (delta >= 0) invalidReason()
            else -> invalidReason()
        }
        if ((referenceType == null) != (referenceId == null)) invalidReference()
        if (referenceType != null && !referenceType.matches(REFERENCE_TYPE_PATTERN)) invalidReference()
        if (referenceId != null && (referenceId.isBlank() || referenceId.length > 160)) invalidReference()
    }

    private fun requireNonZeroDelta(delta: Int) {
        if (delta == 0) invalidQuantity()
    }

    private fun invalidQuantity(): Nothing = throw DomainException(
        "INVENTORY_QUANTITY_INVALID",
        "Inventory quantity delta is invalid",
    )

    private fun invalidReason(): Nothing = throw DomainException(
        "INVENTORY_REASON_INVALID",
        "Inventory movement reason is invalid for this command",
    )

    private fun invalidReference(): Nothing = throw DomainException(
        "INVENTORY_REFERENCE_INVALID",
        "Inventory movement reference is invalid",
    )

    companion object {
        val SYSTEM_ACTOR_ID: UUID = UUID(0L, 0L)
        const val SYSTEM_TRACE_ID: String = "system"
        const val MAX_MANUAL_ADJUSTMENT_UNITS: Long = 1_000_000L
        private val REFERENCE_TYPE_PATTERN = Regex("[A-Z][A-Z0-9_]{0,39}")
    }
}

private class InMemoryInventoryPersistence : InventoryPersistence {
    private data class StockState(
        var onHand: Int = 0,
        var reserved: Int = 0,
        var version: Long = 0,
        val movements: MutableList<StockMovement> = mutableListOf(),
    )

    private val stocks = mutableMapOf<UUID, StockState>()
    private val movementKeys = IdempotencyStore<StockMovement>()

    @Synchronized
    override fun adjust(
        listingId: UUID,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        val fingerprint = "$listingId:$delta:$reason"
        return movementKeys.execute("stock-adjust", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(listingId) { StockState() }
            val newOnHand = try {
                Math.addExact(state.onHand, delta)
            } catch (_: ArithmeticException) {
                invalidQuantity()
            }
            if (newOnHand < state.reserved || newOnHand < 0) insufficient()
            state.onHand = newOnHand
            state.version += 1
            movement(state, listingId, reason, delta, idempotencyKey, actorId, idempotencyKey, reason.name)
        }
    }

    @Synchronized
    override fun adjustScoped(
        scope: InventoryScope,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String?,
        referenceId: String?,
    ): StockMovement {
        val fingerprint = listOf(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            delta,
            reason,
            referenceType,
            referenceId,
        ).joinToString(":")
        return movementKeys.execute("inventory:${scope.organizationId}:$actorId", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(scope.listingId) { StockState() }
            val newOnHand = try {
                Math.addExact(state.onHand, delta)
            } catch (_: ArithmeticException) {
                invalidQuantity()
            }
            if (newOnHand < state.reserved || newOnHand < 0) insufficient()
            state.onHand = newOnHand
            state.version += 1
            movement(
                state,
                scope.listingId,
                reason,
                delta,
                referenceId ?: idempotencyKey,
                actorId,
                idempotencyKey,
                referenceType ?: "MERCHANT_ADJUSTMENT",
                scope.organizationId,
                scope.outletId,
            )
        }
    }

    @Synchronized
    override fun reserve(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-reserve", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.onHand - state.reserved < quantity) insufficient()
            state.reserved = Math.addExact(state.reserved, quantity)
            state.version += 1
            movement(state, listingId, StockReason.ORDER_RESERVE, 0, sourceReference, actorId, sourceReference, StockReason.ORDER_RESERVE.name)
        }
    }

    @Synchronized
    override fun release(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-release", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.reserved < quantity) {
                throw DomainException("STOCK_RESERVATION_MISSING", "The stock reservation is unavailable")
            }
            state.reserved -= quantity
            state.version += 1
            movement(state, listingId, StockReason.ORDER_RELEASE, 0, sourceReference, actorId, sourceReference, StockReason.ORDER_RELEASE.name)
        }
    }

    @Synchronized
    override fun fulfil(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-fulfil", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.reserved < quantity || state.onHand < quantity) insufficient()
            state.reserved -= quantity
            state.onHand -= quantity
            state.version += 1
            movement(state, listingId, StockReason.ORDER_FULFIL, -quantity, sourceReference, actorId, sourceReference, StockReason.ORDER_FULFIL.name)
        }
    }

    @Synchronized
    override fun sell(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return movementKeys.execute("stock-pos", sourceReference, "$listingId:$quantity") {
            val state = stocks.getOrPut(listingId) { StockState() }
            if (state.onHand - state.reserved < quantity) insufficient()
            state.onHand -= quantity
            state.version += 1
            movement(state, listingId, StockReason.POS_SALE, -quantity, sourceReference, actorId, sourceReference, StockReason.POS_SALE.name)
        }
    }

    @Synchronized
    override fun available(listingId: UUID): Int = stocks[listingId]?.let { it.onHand - it.reserved } ?: 0

    @Synchronized
    override fun reserved(listingId: UUID): Int = stocks[listingId]?.reserved ?: 0

    @Synchronized
    override fun history(listingId: UUID): List<StockMovement> = stocks[listingId]?.movements?.toList().orEmpty()

    @Synchronized
    override fun balance(scope: InventoryScope): InventoryBalance {
        val state = stocks[scope.listingId] ?: StockState()
        return InventoryBalance(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            state.onHand,
            state.reserved,
            state.version,
            Instant.now(),
        )
    }

    @Synchronized
    override fun history(scope: InventoryScope, page: Int, pageSize: Int): InventoryHistoryPage {
        val boundedSize = pageSize.coerceIn(1, 100)
        val boundedPage = page.coerceAtLeast(0)
        val all = stocks[scope.listingId]?.movements.orEmpty()
            .filter { (it.organizationId == null || it.organizationId == scope.organizationId) && (it.outletId == null || it.outletId == scope.outletId) }
            .sortedWith(compareByDescending<StockMovement> { it.occurredAt }.thenByDescending { it.id.toString() })
        val start = (boundedPage.toLong() * boundedSize.toLong()).coerceAtMost(all.size.toLong()).toInt()
        val selected = all.drop(start).take(boundedSize + 1)
        return InventoryHistoryPage(selected.take(boundedSize), boundedPage, boundedSize, selected.size > boundedSize)
    }

    private fun movement(
        state: StockState,
        listingId: UUID,
        reason: StockReason,
        delta: Int,
        sourceReference: String,
        actorId: UUID,
        idempotencyKey: String,
        sourceType: String,
        organizationId: UUID? = null,
        outletId: UUID? = null,
    ): StockMovement = StockMovement(
        id = UUID.randomUUID(),
        listingId = listingId,
        reason = reason,
        quantityDelta = delta,
        resultingOnHand = state.onHand,
        resultingReserved = state.reserved,
        sourceReference = sourceReference,
        organizationId = organizationId,
        outletId = outletId,
        actorId = actorId,
        idempotencyKey = idempotencyKey,
        sourceType = sourceType,
    ).also(state.movements::add)

    private fun requirePositive(quantity: Int) {
        if (quantity <= 0) throw DomainException("QUANTITY_INVALID", "Quantity must be positive")
    }

    private fun invalidQuantity(): Nothing = throw DomainException(
        "INVENTORY_QUANTITY_INVALID",
        "Inventory quantity delta is invalid",
    )

    private fun insufficient(): Nothing = throw DomainException("INSUFFICIENT_STOCK", "Stock is unavailable")
}
