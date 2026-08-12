package `in`.mypetnew.commerce.domain

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

enum class OrderStatus {
    PLACED,
    ACCEPTED,
    PREPARING,
    READY_FOR_PICKUP,
    PICKED_UP,
    DELIVERED,
    REJECTED,
    CANCELLED,
}

enum class OrderActor {
    CUSTOMER,
    MERCHANT,
    SYSTEM,
}

data class OrderHistoryEntry(
    val status: OrderStatus,
    val fromStatus: OrderStatus? = null,
    val actorRole: OrderActor,
    val occurredAt: Instant = Instant.now(),
    val commandKey: String,
    val fromStatus: OrderStatus? = null,
    val actorId: UUID = InventoryService.SYSTEM_ACTOR_ID,
    val actorRole: Role = Role.MERCHANT,
    val reason: String? = null,
    val traceId: String = InventoryService.SYSTEM_TRACE_ID,
)

data class ProductOrder(
    val id: UUID,
    val customerId: UUID,
    val outletId: UUID,
    val lines: Map<UUID, Int>,
    val grandTotalPaise: Long,
    val platformFeePaise: Long = 1_000,
    val merchantCommissionPaise: Long = 1_000,
    val paymentMethod: String = "PAY_ON_FULFILMENT",
    val status: OrderStatus,
    val history: List<OrderHistoryEntry>,
    val orderNumber: String = "MP-${id.toString().replace("-", "").take(12).uppercase()}",
    val organizationId: UUID = UUID(0L, 0L),
    val quoteId: UUID = UUID(0L, 0L),
    val fulfilmentMode: String = "STORE_PICKUP",
    val paymentStatus: String = "PENDING_EXTERNAL_COLLECTION",
)

data class OrderLineSnapshot(
    val listingId: UUID,
    val listingName: String,
    val quantity: Int,
    val unitPricePaise: Long,
)

data class PersistedCheckout(
    val requestFingerprint: String,
    val order: ProductOrder,
)

interface OrderPersistence {
    val rollsBackOnFailure: Boolean

    fun <T> inTransaction(block: () -> T): T
    fun findCheckout(customerId: UUID, idempotencyKey: String): PersistedCheckout?
    fun insertOrder(
        order: ProductOrder,
        lines: List<OrderLineSnapshot>,
        idempotencyKey: String,
        requestFingerprint: String,
        initialHistory: OrderHistoryEntry,
    )
    fun insertReservation(orderId: UUID, listingId: UUID, quantity: Int)
    fun updateReservations(orderId: UUID, status: String)
    fun findTransition(orderId: UUID, idempotencyKey: String): OrderHistoryEntry?
    fun lock(orderId: UUID): ProductOrder
    fun saveTransition(previousStatus: OrderStatus, order: ProductOrder, entry: OrderHistoryEntry)
    fun deleteOrder(orderId: UUID)
    fun get(orderId: UUID): ProductOrder
}

class CheckoutIdempotencyRace : RuntimeException()

class OrderService(
    private val inventory: InventoryService,
    private val persistence: OrderPersistence = InMemoryOrderPersistence(),
) {
    fun checkout(
        quote: Quote,
        organizationId: UUID,
        listingNames: Map<UUID, String>,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): ProductOrder {
        validateIdempotencyKey(idempotencyKey)
        validateTraceId(traceId)
        if (quote.fulfilmentMode != "STORE_PICKUP" || quote.paymentMethod != "PAY_ON_FULFILMENT") {
            throw DomainException("CHECKOUT_MODE_INVALID", "Sprint 1 supports store pickup with pay on fulfilment")
        }
        if (quote.lines.isEmpty() || quote.lines.values.any { it.first <= 0 }) {
            throw DomainException("CART_INVALID", "The cart cannot be checked out")
        }
        if (quote.pricing.grandTotalPaise < 0) {
            throw DomainException("PRICE_INVALID", "The server quote total is invalid")
        }
        val snapshots = quote.lines.entries
            .sortedBy { it.key.toString() }
            .map { (listingId, line) ->
                OrderLineSnapshot(
                    listingId = listingId,
                    listingName = listingNames[listingId]
                        ?: throw DomainException("LISTING_UNAVAILABLE", "A quoted listing is unavailable"),
                    quantity = line.first,
                    unitPricePaise = line.second,
                )
            }
        val fingerprint = checkoutFingerprint(quote, organizationId)
        replayCheckout(quote.customerId, idempotencyKey, fingerprint)?.let { return it }

        try {
            return persistence.inTransaction {
                replayCheckout(quote.customerId, idempotencyKey, fingerprint)?.let { return@inTransaction it }
                val order = ProductOrder(
                    id = UUID.randomUUID(),
                    customerId = quote.customerId,
                    organizationId = organizationId,
                    outletId = quote.outletId,
                    quoteId = quote.id,
                    lines = snapshots.associate { it.listingId to it.quantity },
                    grandTotalPaise = quote.pricing.grandTotalPaise,
                    platformFeePaise = quote.pricing.platformFeePaise,
                    merchantCommissionPaise = quote.pricing.merchantCommissionPaise,
                    paymentMethod = quote.paymentMethod,
                    fulfilmentMode = quote.fulfilmentMode,
                    paymentStatus = "PENDING_EXTERNAL_COLLECTION",
                    status = OrderStatus.PLACED,
                    history = emptyList(),
                )
                val initialHistory = OrderHistoryEntry(
                    status = OrderStatus.PLACED,
                    commandKey = idempotencyKey,
                    actorId = actorId,
                    actorRole = Role.CUSTOMER,
                    traceId = traceId,
                )
                persistence.insertOrder(order, snapshots, idempotencyKey, fingerprint, initialHistory)
                val reserved = mutableListOf<OrderLineSnapshot>()
                try {
                    snapshots.forEach { line ->
                        inventory.reserve(
                            line.listingId,
                            line.quantity,
                            "order:${order.id}:reserve:${line.listingId}",
                            actorId,
                            traceId,
                        )
                        persistence.insertReservation(order.id, line.listingId, line.quantity)
                        reserved += line
                    }
                } catch (error: RuntimeException) {
                    if (!persistence.rollsBackOnFailure) {
                        reserved.asReversed().forEach { line ->
                            runCatching {
                                inventory.release(
                                    line.listingId,
                                    line.quantity,
                                    "order:${order.id}:rollback:${line.listingId}",
                                    actorId,
                                    traceId,
                                )
                            }.onFailure(error::addSuppressed)
                        }
                        persistence.deleteOrder(order.id)
                    }
                    throw error
                }
                persistence.get(order.id)
            }
        } catch (race: CheckoutIdempotencyRace) {
            return replayCheckout(quote.customerId, idempotencyKey, fingerprint)
                ?: throw DomainException("CHECKOUT_CONFLICT", "Checkout raced with another request; retry")
        }
    }

    internal fun checkout(
        customerId: UUID,
        outletId: UUID,
        lines: Map<UUID, Int>,
        grandTotalPaise: Long,
        idempotencyKey: String,
    ): ProductOrder {
        val quote = Quote(
            id = UUID.randomUUID(),
            customerId = customerId,
            outletId = outletId,
            lines = lines.mapValues { (_, quantity) -> Pair(quantity, 0L) },
            cartSignature = "legacy-test-only",
            pricing = PricingSnapshot(
                itemSubtotalPaise = (grandTotalPaise - 1_000).coerceAtLeast(0),
                grandTotalPaise = grandTotalPaise,
            ),
            expiresAt = Instant.MAX,
        )
        return checkout(
            quote,
            UUID(0L, 0L),
            lines.keys.associateWith { it.toString() },
            idempotencyKey,
            InventoryService.SYSTEM_ACTOR_ID,
            InventoryService.SYSTEM_TRACE_ID,
        )
    }

    fun transition(
        orderId: UUID,
        target: OrderStatus,
        idempotencyKey: String,
        actorId: UUID = InventoryService.SYSTEM_ACTOR_ID,
        actorRole: Role = Role.MERCHANT,
        reason: String? = null,
        traceId: String = InventoryService.SYSTEM_TRACE_ID,
    ): ProductOrder {
        validateIdempotencyKey(idempotencyKey)
        validateTraceId(traceId)
        val normalizedReason = reason?.trim()?.takeIf(String::isNotEmpty)
        if ((target == OrderStatus.REJECTED || target == OrderStatus.CANCELLED) && normalizedReason == null) {
            throw DomainException("ORDER_REASON_REQUIRED", "A reason is required for this order transition")
        }
        if ((normalizedReason?.length ?: 0) > 240) {
            throw DomainException("ORDER_REASON_INVALID", "The order transition reason is too long")
        }

        return persistence.inTransaction {
            val replay = persistence.findTransition(orderId, idempotencyKey)
            if (replay != null) {
                if (replay.status != target || replay.reason != normalizedReason) {
                    throw DomainException(
                        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                        "The idempotency key was already used for another request",
                    )
                }
                return@inTransaction persistence.get(orderId)
            }

            val order = persistence.lock(orderId)
            if (target !in allowedTargets(order.status, actorRole)) {
                throw DomainException("ORDER_TRANSITION_INVALID", "The order cannot move to the requested state")
            }

            when (target) {
                OrderStatus.CANCELLED, OrderStatus.REJECTED -> {
                    order.lines.forEach { (listingId, quantity) ->
                        inventory.release(
                            listingId,
                            quantity,
                            "order:$orderId:release:$listingId:$target",
                            actorId,
                            traceId,
                        )
                    }
                    persistence.updateReservations(orderId, "RELEASED")
                }
                OrderStatus.PICKED_UP -> {
                    order.lines.forEach { (listingId, quantity) ->
                        inventory.fulfil(
                            listingId,
                            quantity,
                            "order:$orderId:fulfil:$listingId",
                            actorId,
                            traceId,
                        )
                    }
                    persistence.updateReservations(orderId, "FULFILLED")
                }
                else -> Unit
            }

            val entry = OrderHistoryEntry(
                status = target,
                commandKey = idempotencyKey,
                fromStatus = order.status,
                actorId = actorId,
                actorRole = actorRole,
                reason = normalizedReason,
                traceId = traceId,
            )
            val updated = order.copy(
                status = target,
                history = order.history + entry,
            )
            persistence.saveTransition(order.status, updated, entry)
            persistence.get(orderId)
        }
    }

    fun get(orderId: UUID): ProductOrder = persistence.get(orderId)

    private fun replayCheckout(customerId: UUID, idempotencyKey: String, fingerprint: String): ProductOrder? {
        val existing = persistence.findCheckout(customerId, idempotencyKey) ?: return null
        if (existing.requestFingerprint != fingerprint) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return existing.order
    }

    private fun allowedTargets(status: OrderStatus, actorRole: Role): Set<OrderStatus> = when (actorRole) {
        Role.CUSTOMER -> when (status) {
            OrderStatus.PLACED -> setOf(OrderStatus.CANCELLED)
            else -> emptySet()
        }
        Role.MERCHANT -> when (status) {
            OrderStatus.PLACED -> setOf(OrderStatus.ACCEPTED, OrderStatus.REJECTED)
            OrderStatus.ACCEPTED -> setOf(OrderStatus.PREPARING, OrderStatus.CANCELLED)
            OrderStatus.PREPARING -> setOf(OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED)
            OrderStatus.READY_FOR_PICKUP -> setOf(OrderStatus.PICKED_UP, OrderStatus.CANCELLED)
            OrderStatus.PICKED_UP -> setOf(OrderStatus.DELIVERED)
            OrderStatus.DELIVERED, OrderStatus.REJECTED, OrderStatus.CANCELLED -> emptySet()
        }
        Role.CAPTAIN, Role.ADMIN -> emptySet()
    }

    private fun checkoutFingerprint(quote: Quote, organizationId: UUID): String {
        val canonical = buildString {
            append(quote.id).append(':')
            append(quote.customerId).append(':')
            append(organizationId).append(':')
            append(quote.outletId).append(':')
            append(quote.cartSignature).append(':')
            append(quote.fulfilmentMode).append(':')
            append(quote.paymentMethod).append(':')
            append(quote.pricing.grandTotalPaise)
        }
        return sha256(canonical)
    }

    private fun validateIdempotencyKey(key: String) {
        if (!key.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun validateTraceId(traceId: String) {
        if (!traceId.matches(Regex("[A-Za-z0-9._:-]{1,64}"))) {
            throw DomainException("TRACE_ID_INVALID", "The trace identifier is invalid")
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

private class InMemoryOrderPersistence : OrderPersistence {
    override val rollsBackOnFailure: Boolean = false
    private val monitor = Any()
    private val orders = mutableMapOf<UUID, ProductOrder>()
    private val checkoutKeys = mutableMapOf<Pair<UUID, String>, Pair<String, UUID>>()
    private val reservations = mutableMapOf<Pair<UUID, UUID>, Pair<Int, String>>()

    override fun <T> inTransaction(block: () -> T): T = synchronized(monitor) { block() }

    override fun findCheckout(customerId: UUID, idempotencyKey: String): PersistedCheckout? = synchronized(monitor) {
        val stored = checkoutKeys[customerId to idempotencyKey] ?: return@synchronized null
        PersistedCheckout(stored.first, get(stored.second))
    }

    override fun insertOrder(
        order: ProductOrder,
        lines: List<OrderLineSnapshot>,
        idempotencyKey: String,
        requestFingerprint: String,
        initialHistory: OrderHistoryEntry,
    ) = synchronized(monitor) {
        val key = order.customerId to idempotencyKey
        if (checkoutKeys.containsKey(key)) throw CheckoutIdempotencyRace()
        orders[order.id] = order.copy(history = listOf(initialHistory))
        checkoutKeys[key] = requestFingerprint to order.id
    }

    override fun insertReservation(orderId: UUID, listingId: UUID, quantity: Int) = synchronized(monitor) {
        reservations[orderId to listingId] = quantity to "RESERVED"
    }

    override fun updateReservations(orderId: UUID, status: String) = synchronized(monitor) {
        reservations.entries.filter { it.key.first == orderId }.forEach { entry ->
            entry.setValue(entry.value.first to status)
        }
    }

    override fun findTransition(orderId: UUID, idempotencyKey: String): OrderHistoryEntry? = synchronized(monitor) {
        orders[orderId]?.history?.firstOrNull { it.commandKey == idempotencyKey }
    }

    override fun lock(orderId: UUID): ProductOrder = get(orderId)

    override fun saveTransition(previousStatus: OrderStatus, order: ProductOrder, entry: OrderHistoryEntry) = synchronized(monitor) {
        val current = orders[order.id] ?: notFound()
        if (current.status != previousStatus) {
            throw DomainException("ORDER_CONFLICT", "The order changed concurrently; refresh and retry")
        }
        orders[order.id] = order
    }

    override fun deleteOrder(orderId: UUID) {
        synchronized(monitor) {
            orders.remove(orderId)
            reservations.keys.removeIf { it.first == orderId }
            checkoutKeys.entries.removeIf { it.value.second == orderId }
        }
    }

    override fun get(orderId: UUID): ProductOrder = synchronized(monitor) {
        orders[orderId] ?: notFound()
    }

    private fun notFound(): Nothing = throw DomainException("ORDER_NOT_FOUND", "The order is unavailable")
}
