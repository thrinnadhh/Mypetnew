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
    RECEIVING,
    DAMAGE,
    EXPIRY,
    SHRINKAGE,
    RETURN,
    CUSTOMER_RETURN,
    VENDOR_RETURN,
    TRANSFER_OUT,
    TRANSFER_IN,
    COUNT_CORRECTION,
    COUNT_ADJUSTMENT,
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

enum class CountSessionStatus {
    OPEN,
    SUBMITTED,
    REVIEW_REQUIRED,
    CANCELLED,
}

data class InventoryCountLine(
    val listingId: UUID,
    val countedQuantity: Int,
    val cutoffOnHand: Int,
    val reconciledDelta: Int? = null,
    val resultingOnHand: Int? = null,
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now(),
)

data class InventoryCountSession(
    val id: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val status: CountSessionStatus,
    val cutoffSequenceNumber: Long,
    val cutoffTimestamp: Instant,
    val actorId: UUID,
    val submitIdempotencyKey: String? = null,
    val reconciliationSummary: String? = null,
    val lines: List<InventoryCountLine> = emptyList(),
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now(),
    val submittedAt: Instant? = null,
)

data class CountLineInput(
    val listingId: UUID,
    val countedQuantity: Int,
)

data class CountReconciliationLineResult(
    val listingId: UUID,
    val countedQuantity: Int,
    val cutoffOnHand: Int,
    val deltaAfterCutoff: Int,
    val targetCurrentOnHand: Int,
    val currentOnHandBeforeAdjustment: Int,
    val countAdjustmentDelta: Int,
    val resultingOnHand: Int,
    val movementId: UUID? = null,
)

data class CountReconciliationResult(
    val sessionId: UUID,
    val status: CountSessionStatus,
    val lines: List<CountReconciliationLineResult>,
    val submittedAt: Instant,
)

enum class TransferStatus {
    COMPLETED,
    CANCELLED,
    FAILED,
}

data class InventoryTransfer(
    val id: UUID,
    val organizationId: UUID,
    val sourceOutletId: UUID,
    val destinationOutletId: UUID,
    val sourceListingId: UUID,
    val destinationListingId: UUID,
    val quantity: Int,
    val status: TransferStatus,
    val actorId: UUID,
    val idempotencyKey: String,
    val sourceMovementId: UUID,
    val destinationMovementId: UUID,
    val createdAt: Instant = Instant.now(),
)

data class TransferRequest(
    val sourceOutletId: UUID,
    val destinationOutletId: UUID,
    val sourceListingId: UUID,
    val destinationListingId: UUID? = null,
    val quantity: Int,
)

data class TransferResult(
    val transfer: InventoryTransfer,
    val sourceMovement: StockMovement,
    val destinationMovement: StockMovement,
)

enum class ReturnType {
    CUSTOMER_RETURN,
    VENDOR_RETURN,
}

data class InventoryReceivingInput(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val referenceType: String? = null,
    val referenceId: String? = null,
    val batchNumber: String? = null,
    val expiryDate: String? = null,
)

data class InventoryDamageInput(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val reasonDetails: String? = null,
    val referenceId: String? = null,
)

data class InventoryExpiryInput(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val batchReference: String? = null,
    val expiryDate: String? = null,
)

data class InventoryShrinkageInput(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val notes: String? = null,
    val referenceId: String? = null,
)

data class InventoryReturnInput(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val returnType: ReturnType,
    val referenceType: String? = null,
    val referenceId: String? = null,
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
        referenceType: String? = null,
        referenceId: String? = null,
    ): StockMovement = adjust(scope.listingId, delta, reason, idempotencyKey, actorId, traceId).copy(
        organizationId = scope.organizationId,
        outletId = scope.outletId,
        actorId = actorId,
        idempotencyKey = idempotencyKey,
        sourceType = referenceType ?: reason.name,
        sourceReference = referenceId ?: idempotencyKey,
    )

    fun receive(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String? = null,
        referenceId: String? = null,
        batchNumber: String? = null,
        expiryDate: String? = null,
    ): StockMovement

    fun damage(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        reasonDetails: String? = null,
        referenceId: String? = null,
    ): StockMovement

    fun expire(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        batchReference: String? = null,
        expiryDate: String? = null,
    ): StockMovement

    fun shrink(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        notes: String? = null,
        referenceId: String? = null,
    ): StockMovement

    fun returnStock(
        scope: InventoryScope,
        quantity: Int,
        returnType: ReturnType,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String? = null,
        referenceId: String? = null,
    ): StockMovement

    fun transfer(
        organizationId: UUID,
        sourceOutletId: UUID,
        destinationOutletId: UUID,
        sourceListingId: UUID,
        destinationListingId: UUID?,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): TransferResult

    fun startCountSession(
        organizationId: UUID,
        outletId: UUID,
        actorId: UUID,
        traceId: String,
        initialCutoffSequence: Long? = null,
    ): InventoryCountSession

    fun getCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
    ): InventoryCountSession

    fun updateCountLines(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        lines: List<CountLineInput>,
    ): InventoryCountSession

    fun submitCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): CountReconciliationResult

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

    fun findExistingMovementByReceipt(organizationId: UUID, actorId: UUID, idempotencyKey: String): StockMovement? = null

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
    fun findExistingMovementByReceipt(organizationId: UUID, actorId: UUID, idempotencyKey: String): StockMovement? =
        persistence.findExistingMovementByReceipt(organizationId, actorId, idempotencyKey)

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

    fun receive(
        scope: InventoryScope,
        input: InventoryReceivingInput,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(input.quantity)
        return persistence.receive(
            scope = scope,
            quantity = input.quantity,
            idempotencyKey = idempotencyKey,
            actorId = actorId,
            traceId = traceId,
            referenceType = input.referenceType,
            referenceId = input.referenceId,
            batchNumber = input.batchNumber,
            expiryDate = input.expiryDate,
        )
    }

    fun damage(
        scope: InventoryScope,
        input: InventoryDamageInput,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(input.quantity)
        return persistence.damage(
            scope = scope,
            quantity = input.quantity,
            idempotencyKey = idempotencyKey,
            actorId = actorId,
            traceId = traceId,
            reasonDetails = input.reasonDetails,
            referenceId = input.referenceId,
        )
    }

    fun expire(
        scope: InventoryScope,
        input: InventoryExpiryInput,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(input.quantity)
        return persistence.expire(
            scope = scope,
            quantity = input.quantity,
            idempotencyKey = idempotencyKey,
            actorId = actorId,
            traceId = traceId,
            batchReference = input.batchReference,
            expiryDate = input.expiryDate,
        )
    }

    fun shrink(
        scope: InventoryScope,
        input: InventoryShrinkageInput,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(input.quantity)
        return persistence.shrink(
            scope = scope,
            quantity = input.quantity,
            idempotencyKey = idempotencyKey,
            actorId = actorId,
            traceId = traceId,
            notes = input.notes,
            referenceId = input.referenceId,
        )
    }

    fun returnStock(
        scope: InventoryScope,
        input: InventoryReturnInput,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(input.quantity)
        return persistence.returnStock(
            scope = scope,
            quantity = input.quantity,
            returnType = input.returnType,
            idempotencyKey = idempotencyKey,
            actorId = actorId,
            traceId = traceId,
            referenceType = input.referenceType,
            referenceId = input.referenceId,
        )
    }

    fun transfer(
        organizationId: UUID,
        request: TransferRequest,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): TransferResult {
        requirePositive(request.quantity)
        if (request.sourceOutletId == request.destinationOutletId) {
            throw DomainException("INVALID_TRANSFER", "Source and destination outlet must be distinct")
        }
        return persistence.transfer(
            organizationId = organizationId,
            sourceOutletId = request.sourceOutletId,
            destinationOutletId = request.destinationOutletId,
            sourceListingId = request.sourceListingId,
            destinationListingId = request.destinationListingId,
            quantity = request.quantity,
            idempotencyKey = idempotencyKey,
            actorId = actorId,
            traceId = traceId,
        )
    }

    fun startCountSession(
        organizationId: UUID,
        outletId: UUID,
        actorId: UUID,
        traceId: String,
        initialCutoffSequence: Long? = null,
    ): InventoryCountSession = persistence.startCountSession(
        organizationId = organizationId,
        outletId = outletId,
        actorId = actorId,
        traceId = traceId,
        initialCutoffSequence = initialCutoffSequence,
    )

    fun getCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
    ): InventoryCountSession = persistence.getCountSession(
        organizationId = organizationId,
        outletId = outletId,
        sessionId = sessionId,
    )

    fun updateCountLines(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        lines: List<CountLineInput>,
    ): InventoryCountSession {
        lines.forEach { requireNonNegative(it.countedQuantity) }
        return persistence.updateCountLines(
            organizationId = organizationId,
            outletId = outletId,
            sessionId = sessionId,
            lines = lines,
        )
    }

    fun submitCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): CountReconciliationResult = persistence.submitCountSession(
        organizationId = organizationId,
        outletId = outletId,
        sessionId = sessionId,
        idempotencyKey = idempotencyKey,
        actorId = actorId,
        traceId = traceId,
    )

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
            StockReason.MANUAL_INCREASE, StockReason.RECEIVING, StockReason.CUSTOMER_RETURN -> if (delta <= 0) invalidReason()
            StockReason.MANUAL_DECREASE, StockReason.DAMAGE, StockReason.EXPIRY, StockReason.SHRINKAGE, StockReason.VENDOR_RETURN -> if (delta >= 0) invalidReason()
            StockReason.COUNT_CORRECTION, StockReason.COUNT_ADJUSTMENT -> { /* permitted signed delta */ }
            else -> invalidReason()
        }
        if ((referenceType == null) != (referenceId == null)) invalidReference()
        if (referenceType != null && !referenceType.matches(REFERENCE_TYPE_PATTERN)) invalidReference()
        if (referenceId != null && (referenceId.isBlank() || referenceId.length > 160)) invalidReference()
    }

    private fun requireNonZeroDelta(delta: Int) {
        if (delta == 0) invalidQuantity()
    }

    private fun requirePositive(quantity: Int) {
        if (quantity <= 0) invalidQuantity()
    }

    private fun requireNonNegative(quantity: Int) {
        if (quantity < 0) invalidQuantity()
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

        fun computeFingerprint(vararg parts: Any?): String {
            val canonical = parts.joinToString("|") { part ->
                val value = part?.toString() ?: "<null>"
                "${value.length}:$value"
            }
            return java.security.MessageDigest.getInstance("SHA-256")
                .digest(canonical.toByteArray(java.nio.charset.StandardCharsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        }
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
    private val countSessions = mutableMapOf<UUID, InventoryCountSession>()
    private val countSubmitKeys = IdempotencyStore<CountReconciliationResult>()
    private val transferKeys = IdempotencyStore<TransferResult>()

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
    override fun receive(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String?,
        referenceId: String?,
        batchNumber: String?,
        expiryDate: String?,
    ): StockMovement {
        val fingerprint = listOf(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.RECEIVING.name,
            referenceType,
            referenceId,
            batchNumber,
            expiryDate,
        ).joinToString(":")
        return movementKeys.execute("inventory-receiving:${scope.organizationId}:$actorId", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(scope.listingId) { StockState() }
            val newOnHand = safeAdd(state.onHand, quantity)
            state.onHand = newOnHand
            state.version += 1
            movement(
                state,
                scope.listingId,
                StockReason.RECEIVING,
                quantity,
                referenceId ?: idempotencyKey,
                actorId,
                idempotencyKey,
                referenceType ?: "RECEIVING",
                scope.organizationId,
                scope.outletId,
            )
        }
    }

    @Synchronized
    override fun damage(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        reasonDetails: String?,
        referenceId: String?,
    ): StockMovement {
        val fingerprint = listOf(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.DAMAGE.name,
            reasonDetails,
            referenceId,
        ).joinToString(":")
        return movementKeys.execute("inventory-damage:${scope.organizationId}:$actorId", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(scope.listingId) { StockState() }
            if (state.onHand - state.reserved < quantity) insufficient()
            val newOnHand = state.onHand - quantity
            state.onHand = newOnHand
            state.version += 1
            movement(
                state,
                scope.listingId,
                StockReason.DAMAGE,
                -quantity,
                referenceId ?: idempotencyKey,
                actorId,
                idempotencyKey,
                "DAMAGE",
                scope.organizationId,
                scope.outletId,
            )
        }
    }

    @Synchronized
    override fun expire(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        batchReference: String?,
        expiryDate: String?,
    ): StockMovement {
        val fingerprint = listOf(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.EXPIRY.name,
            batchReference,
            expiryDate,
        ).joinToString(":")
        return movementKeys.execute("inventory-expiry:${scope.organizationId}:$actorId", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(scope.listingId) { StockState() }
            if (state.onHand - state.reserved < quantity) insufficient()
            val newOnHand = state.onHand - quantity
            state.onHand = newOnHand
            state.version += 1
            movement(
                state,
                scope.listingId,
                StockReason.EXPIRY,
                -quantity,
                batchReference ?: idempotencyKey,
                actorId,
                idempotencyKey,
                "EXPIRY",
                scope.organizationId,
                scope.outletId,
            )
        }
    }

    @Synchronized
    override fun shrink(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        notes: String?,
        referenceId: String?,
    ): StockMovement {
        val fingerprint = listOf(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.SHRINKAGE.name,
            notes,
            referenceId,
        ).joinToString(":")
        return movementKeys.execute("inventory-shrinkage:${scope.organizationId}:$actorId", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(scope.listingId) { StockState() }
            if (state.onHand - state.reserved < quantity) insufficient()
            val newOnHand = state.onHand - quantity
            state.onHand = newOnHand
            state.version += 1
            movement(
                state,
                scope.listingId,
                StockReason.SHRINKAGE,
                -quantity,
                referenceId ?: idempotencyKey,
                actorId,
                idempotencyKey,
                "SHRINKAGE",
                scope.organizationId,
                scope.outletId,
            )
        }
    }

    @Synchronized
    override fun returnStock(
        scope: InventoryScope,
        quantity: Int,
        returnType: ReturnType,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String?,
        referenceId: String?,
    ): StockMovement {
        val reason = if (returnType == ReturnType.CUSTOMER_RETURN) StockReason.CUSTOMER_RETURN else StockReason.VENDOR_RETURN
        val delta = if (returnType == ReturnType.CUSTOMER_RETURN) quantity else -quantity
        val fingerprint = listOf(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            returnType.name,
            referenceType,
            referenceId,
        ).joinToString(":")
        return movementKeys.execute("inventory-return:${scope.organizationId}:$actorId", idempotencyKey, fingerprint) {
            val state = stocks.getOrPut(scope.listingId) { StockState() }
            if (delta < 0 && state.onHand - state.reserved < quantity) insufficient()
            val newOnHand = safeAdd(state.onHand, delta)
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
                referenceType ?: returnType.name,
                scope.organizationId,
                scope.outletId,
            )
        }
    }

    @Synchronized
    override fun transfer(
        organizationId: UUID,
        sourceOutletId: UUID,
        destinationOutletId: UUID,
        sourceListingId: UUID,
        destinationListingId: UUID?,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): TransferResult {
        val destListing = destinationListingId ?: sourceListingId
        val fingerprint = listOf(
            organizationId,
            sourceOutletId,
            destinationOutletId,
            sourceListingId,
            destListing,
            quantity,
        ).joinToString(":")
        return transferKeys.execute("inventory-transfer:$organizationId:$actorId", idempotencyKey, fingerprint) {
            val sourceState = stocks.getOrPut(sourceListingId) { StockState() }
            if (sourceState.onHand - sourceState.reserved < quantity) insufficient()
            val destState = stocks.getOrPut(destListing) { StockState() }

            sourceState.onHand -= quantity
            sourceState.version += 1
            val outMovement = movement(
                sourceState,
                sourceListingId,
                StockReason.TRANSFER_OUT,
                -quantity,
                "transfer-out:$idempotencyKey",
                actorId,
                "transfer-out:$idempotencyKey",
                "OUTLET_TRANSFER",
                organizationId,
                sourceOutletId,
            )

            destState.onHand = safeAdd(destState.onHand, quantity)
            destState.version += 1
            val inMovement = movement(
                destState,
                destListing,
                StockReason.TRANSFER_IN,
                quantity,
                "transfer-in:$idempotencyKey",
                actorId,
                "transfer-in:$idempotencyKey",
                "OUTLET_TRANSFER",
                organizationId,
                destinationOutletId,
            )

            val transferRecord = InventoryTransfer(
                id = UUID.randomUUID(),
                organizationId = organizationId,
                sourceOutletId = sourceOutletId,
                destinationOutletId = destinationOutletId,
                sourceListingId = sourceListingId,
                destinationListingId = destListing,
                quantity = quantity,
                status = TransferStatus.COMPLETED,
                actorId = actorId,
                idempotencyKey = idempotencyKey,
                sourceMovementId = outMovement.id,
                destinationMovementId = inMovement.id,
            )

            TransferResult(
                transfer = transferRecord,
                sourceMovement = outMovement,
                destinationMovement = inMovement,
            )
        }
    }

    @Synchronized
    override fun startCountSession(
        organizationId: UUID,
        outletId: UUID,
        actorId: UUID,
        traceId: String,
        initialCutoffSequence: Long?,
    ): InventoryCountSession {
        val sessionId = UUID.randomUUID()
        val session = InventoryCountSession(
            id = sessionId,
            organizationId = organizationId,
            outletId = outletId,
            status = CountSessionStatus.OPEN,
            cutoffSequenceNumber = initialCutoffSequence ?: 0L,
            cutoffTimestamp = Instant.now(),
            actorId = actorId,
        )
        countSessions[sessionId] = session
        return session
    }

    @Synchronized
    override fun getCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
    ): InventoryCountSession {
        val session = countSessions[sessionId] ?: throw DomainException("RESOURCE_NOT_FOUND", "Count session not found")
        if (session.organizationId != organizationId || session.outletId != outletId) {
            throw DomainException("RESOURCE_NOT_FOUND", "Count session not found")
        }
        return session
    }

    @Synchronized
    override fun updateCountLines(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        lines: List<CountLineInput>,
    ): InventoryCountSession {
        val session = getCountSession(organizationId, outletId, sessionId)
        if (session.status != CountSessionStatus.OPEN) {
            throw DomainException("INVALID_COUNT_STATE", "Count session is not open for modifications")
        }
        val currentLinesMap = session.lines.associateBy { it.listingId }.toMutableMap()
        for (input in lines) {
            val cutoff = currentLinesMap[input.listingId]?.cutoffOnHand
                ?: stocks[input.listingId]?.onHand
                ?: 0
            currentLinesMap[input.listingId] = InventoryCountLine(
                listingId = input.listingId,
                countedQuantity = input.countedQuantity,
                cutoffOnHand = cutoff,
                updatedAt = Instant.now(),
            )
        }
        val updatedSession = session.copy(
            lines = currentLinesMap.values.toList(),
            updatedAt = Instant.now(),
        )
        countSessions[sessionId] = updatedSession
        return updatedSession
    }

    @Synchronized
    override fun submitCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): CountReconciliationResult {
        val session = getCountSession(organizationId, outletId, sessionId)
        val fingerprint = "$organizationId:$outletId:$sessionId:${session.lines.size}"
        return countSubmitKeys.execute("count-submit:$organizationId:$actorId", idempotencyKey, fingerprint) {
            if (session.status == CountSessionStatus.SUBMITTED) {
                throw DomainException("COUNT_ALREADY_SUBMITTED", "Count session already submitted")
            }
            val results = mutableListOf<CountReconciliationLineResult>()
            val updatedLines = mutableListOf<InventoryCountLine>()

            for (line in session.lines) {
                val state = stocks.getOrPut(line.listingId) { StockState() }
                // Calculate movements occurring after cutoff
                val deltaAfterCutoff = state.movements
                    .filter { it.occurredAt.isAfter(session.cutoffTimestamp) }
                    .sumOf { it.quantityDelta }
                val targetCurrent = line.countedQuantity + deltaAfterCutoff
                val currentOnHand = state.onHand
                val countAdjustment = targetCurrent - currentOnHand

                if (targetCurrent < state.reserved || targetCurrent < 0) {
                    val reviewSession = session.copy(
                        status = CountSessionStatus.REVIEW_REQUIRED,
                        updatedAt = Instant.now(),
                    )
                    countSessions[sessionId] = reviewSession
                    throw DomainException("COUNT_CUTOFF_CONFLICT", "Count reconciliation violated stock policy; requires review")
                }

                var movementId: UUID? = null
                if (countAdjustment != 0) {
                    state.onHand = targetCurrent
                    state.version += 1
                    val mov = movement(
                        state,
                        line.listingId,
                        StockReason.COUNT_ADJUSTMENT,
                        countAdjustment,
                        sessionId.toString(),
                        actorId,
                        "$idempotencyKey:${line.listingId}",
                        "COUNT_SESSION",
                        organizationId,
                        outletId,
                    )
                    movementId = mov.id
                }

                results.add(
                    CountReconciliationLineResult(
                        listingId = line.listingId,
                        countedQuantity = line.countedQuantity,
                        cutoffOnHand = line.cutoffOnHand,
                        deltaAfterCutoff = deltaAfterCutoff,
                        targetCurrentOnHand = targetCurrent,
                        currentOnHandBeforeAdjustment = currentOnHand,
                        countAdjustmentDelta = countAdjustment,
                        resultingOnHand = state.onHand,
                        movementId = movementId,
                    ),
                )
                updatedLines.add(
                    line.copy(
                        reconciledDelta = countAdjustment,
                        resultingOnHand = state.onHand,
                        updatedAt = Instant.now(),
                    ),
                )
            }

            val submittedSession = session.copy(
                status = CountSessionStatus.SUBMITTED,
                submitIdempotencyKey = idempotencyKey,
                lines = updatedLines,
                submittedAt = Instant.now(),
                updatedAt = Instant.now(),
            )
            countSessions[sessionId] = submittedSession

            CountReconciliationResult(
                sessionId = sessionId,
                status = CountSessionStatus.SUBMITTED,
                lines = results,
                submittedAt = submittedSession.submittedAt ?: Instant.now(),
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

    private fun safeAdd(left: Int, right: Int): Int = try {
        Math.addExact(left, right)
    } catch (_: ArithmeticException) {
        invalidQuantity()
    }

    private fun invalidQuantity(): Nothing = throw DomainException(
        "INVENTORY_QUANTITY_INVALID",
        "Inventory quantity delta is invalid",
    )

    private fun insufficient(): Nothing = throw DomainException("INSUFFICIENT_STOCK", "Stock is unavailable")
}
