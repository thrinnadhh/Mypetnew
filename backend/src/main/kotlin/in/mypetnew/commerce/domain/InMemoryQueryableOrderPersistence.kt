package `in`.mypetnew.commerce.domain

import `in`.mypetnew.common.error.DomainException
import java.time.Instant
import java.util.UUID

class InMemoryQueryableOrderPersistence : OrderPersistence, CustomerOrderQuery {
    override val rollsBackOnFailure: Boolean = false

    private val monitor = Any()
    private val orders = mutableMapOf<UUID, ProductOrder>()
    private val lineSnapshots = mutableMapOf<UUID, List<OrderLineSnapshot>>()
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
        lineSnapshots[order.id] = lines.toList()
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
            lineSnapshots.remove(orderId)
            reservations.keys.removeIf { it.first == orderId }
            checkoutKeys.entries.removeIf { it.value.second == orderId }
        }
    }

    override fun get(orderId: UUID): ProductOrder = synchronized(monitor) {
        orders[orderId] ?: notFound()
    }

    override fun list(
        customerId: UUID,
        status: OrderStatus?,
        page: Int,
        pageSize: Int,
        category: CustomerOrderCategory?,
        cursor: CustomerOrderCursor?,
    ): CustomerOrderSummaryPage = synchronized(monitor) {
        validatePagination(page, pageSize)
        if (status != null && category != null) {
            throw DomainException("ORDER_FILTER_INVALID", "Choose either an order status or category filter")
        }
        val allowedStatuses = category?.let(::statuses)
        val ordered = orders.values
            .asSequence()
            .filter { it.customerId == customerId }
            .filter { status == null || it.status == status }
            .filter { allowedStatuses == null || it.status in allowedStatuses }
            .map { it.toSummary() }
            .sortedWith(
                compareByDescending<CustomerOrderSummary> { it.placedAt }
                    .thenByDescending { it.orderId.toString() },
            )
            .filter { summary ->
                cursor == null || summary.placedAt < cursor.placedAt ||
                    (summary.placedAt == cursor.placedAt && summary.orderId.toString() < cursor.orderId.toString())
            }
            .toList()

        val offset = if (cursor == null) page.toLong() * pageSize.toLong() else 0L
        if (offset >= ordered.size.toLong()) {
            return@synchronized CustomerOrderSummaryPage(emptyList(), false)
        }
        val candidates = ordered.drop(offset.toInt()).take(pageSize + 1)
        val items = candidates.take(pageSize)
        CustomerOrderSummaryPage(
            items = items,
            hasNext = candidates.size > pageSize,
            nextCursor = if (candidates.size > pageSize && items.isNotEmpty()) {
                items.last().let { CustomerOrderCursor(it.placedAt, it.orderId) }
            } else {
                null
            },
        )
    }

    override fun detail(customerId: UUID, orderId: UUID): CustomerOrderDetailSnapshot? = synchronized(monitor) {
        val order = orders[orderId]?.takeIf { it.customerId == customerId } ?: return@synchronized null
        CustomerOrderDetailSnapshot(
            orderId = order.id,
            orderNumber = order.orderNumber,
            outletId = order.outletId,
            quoteId = order.quoteId,
            items = lineSnapshots[order.id].orEmpty().map { line ->
                CustomerOrderLineSnapshot(
                    listingId = line.listingId,
                    listingName = line.listingName,
                    quantity = line.quantity,
                    unitPricePaise = line.unitPricePaise,
                )
            },
            grandTotalPaise = order.grandTotalPaise,
            platformFeePaise = order.platformFeePaise,
            paymentMethod = order.paymentMethod,
            paymentStatus = order.paymentStatus,
            fulfilmentMode = order.fulfilmentMode,
            status = order.status,
            placedAt = order.history.firstOrNull()?.occurredAt,
            statusHistory = order.history,
        )
    }

    private fun ProductOrder.toSummary(): CustomerOrderSummary {
        val placedAt = history.firstOrNull()?.occurredAt ?: Instant.EPOCH
        val lastUpdatedAt = history.lastOrNull()?.occurredAt ?: placedAt
        return CustomerOrderSummary(
            orderId = id,
            outletId = outletId,
            itemCount = lines.values.sum(),
            grandTotalPaise = grandTotalPaise,
            fulfilmentMode = fulfilmentMode,
            paymentMethod = paymentMethod,
            paymentStatus = paymentStatus,
            status = status,
            placedAt = placedAt,
            lastUpdatedAt = lastUpdatedAt,
        )
    }

    private fun statuses(category: CustomerOrderCategory): Set<OrderStatus> = when (category) {
        CustomerOrderCategory.ACTIVE -> setOf(
            OrderStatus.PLACED,
            OrderStatus.ACCEPTED,
            OrderStatus.PREPARING,
            OrderStatus.READY_FOR_PICKUP,
            OrderStatus.PICKED_UP,
        )
        CustomerOrderCategory.PAST -> setOf(
            OrderStatus.DELIVERED,
            OrderStatus.REJECTED,
            OrderStatus.CANCELLED,
        )
    }

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    private fun notFound(): Nothing = throw DomainException("ORDER_NOT_FOUND", "The order is unavailable")
}
