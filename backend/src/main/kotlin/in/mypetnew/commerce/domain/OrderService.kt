package `in`.mypetnew.commerce.domain

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
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
)

class OrderService(private val inventory: InventoryService) {
    private val orders = mutableMapOf<UUID, ProductOrder>()
    private val checkoutKeys = IdempotencyStore<ProductOrder>()
    private val transitionKeys = IdempotencyStore<ProductOrder>()

    @Synchronized
    fun checkout(
        customerId: UUID,
        outletId: UUID,
        lines: Map<UUID, Int>,
        grandTotalPaise: Long,
        idempotencyKey: String,
    ): ProductOrder {
        val fingerprint = "$customerId:$outletId:${canonicalLines(lines)}:$grandTotalPaise"
        return checkoutKeys.execute("checkout:$customerId", idempotencyKey, fingerprint) {
            if (lines.isEmpty() || lines.values.any { it <= 0 }) {
                throw DomainException("CART_INVALID", "The cart cannot be checked out")
            }
            val id = UUID.randomUUID()
            val reserved = mutableListOf<Pair<UUID, Int>>()
            try {
                lines.toSortedMap(compareBy(UUID::toString)).forEach { (listingId, quantity) ->
                    inventory.reserve(listingId, quantity, "$id:$listingId")
                    reserved += listingId to quantity
                }
            } catch (error: RuntimeException) {
                reserved.asReversed().forEach { (listingId, quantity) ->
                    inventory.release(listingId, quantity, "rollback:$id:$listingId")
                }
                throw error
            }
            ProductOrder(
                id = id,
                customerId = customerId,
                outletId = outletId,
                lines = lines.toMap(),
                grandTotalPaise = grandTotalPaise,
                status = OrderStatus.PLACED,
                history = listOf(
                    OrderHistoryEntry(
                        status = OrderStatus.PLACED,
                        actorRole = OrderActor.CUSTOMER,
                        commandKey = idempotencyKey,
                    ),
                ),
            ).also { orders[id] = it }
        }
    }

    @Synchronized
    fun transition(
        orderId: UUID,
        target: OrderStatus,
        idempotencyKey: String,
        actor: OrderActor = OrderActor.MERCHANT,
    ): ProductOrder {
        val fingerprint = "$orderId:$actor:$target"
        return transitionKeys.execute("order-transition:$orderId", idempotencyKey, fingerprint) {
            val order = orders[orderId] ?: throw DomainException("ORDER_NOT_FOUND", "The order is unavailable")
            if (target !in allowedTargets(order.status, actor)) {
                throw DomainException("ORDER_TRANSITION_INVALID", "The order cannot move to the requested state")
            }
            if (target == OrderStatus.CANCELLED || target == OrderStatus.REJECTED) {
                order.lines.forEach { (listingId, quantity) ->
                    inventory.release(listingId, quantity, "$orderId:$listingId:$target")
                }
            }
            if (target == OrderStatus.DELIVERED) {
                order.lines.forEach { (listingId, quantity) ->
                    inventory.fulfil(listingId, quantity, "$orderId:$listingId:FULFIL")
                }
            }
            order.copy(
                status = target,
                history = order.history + OrderHistoryEntry(
                    status = target,
                    fromStatus = order.status,
                    actorRole = actor,
                    commandKey = idempotencyKey,
                ),
            ).also { orders[orderId] = it }
        }
    }

    @Synchronized
    fun get(orderId: UUID): ProductOrder = orders[orderId]
        ?: throw DomainException("ORDER_NOT_FOUND", "The order is unavailable")

    private fun allowedTargets(status: OrderStatus, actor: OrderActor): Set<OrderStatus> = when (actor) {
        OrderActor.CUSTOMER -> when (status) {
            OrderStatus.PLACED -> setOf(OrderStatus.CANCELLED)
            else -> emptySet()
        }
        OrderActor.MERCHANT -> when (status) {
            OrderStatus.PLACED -> setOf(OrderStatus.ACCEPTED, OrderStatus.REJECTED)
            OrderStatus.ACCEPTED -> setOf(OrderStatus.PREPARING, OrderStatus.CANCELLED)
            OrderStatus.PREPARING -> setOf(OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED)
            OrderStatus.READY_FOR_PICKUP -> setOf(OrderStatus.DELIVERED, OrderStatus.CANCELLED)
            OrderStatus.PICKED_UP,
            OrderStatus.DELIVERED,
            OrderStatus.REJECTED,
            OrderStatus.CANCELLED -> emptySet()
        }
        OrderActor.SYSTEM -> emptySet()
    }

    private fun canonicalLines(lines: Map<UUID, Int>): String = lines
        .toSortedMap(compareBy(UUID::toString))
        .entries
        .joinToString(",") { "${it.key}=${it.value}" }
}
