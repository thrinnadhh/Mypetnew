package `in`.mypetnew.commerce.domain

import `in`.mypetnew.common.error.DomainException
import java.time.Instant
import java.util.UUID

class InMemoryQueryableOrderPersistence : OrderPersistence, CustomerOrderQuery {
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

    override fun list(
        customerId: UUID,
        status: OrderStatus?,
        page: Int,
        pageSize: Int,
    ): CustomerOrderSummaryPage = synchronized(monitor) {
        validatePagination(page, pageSize)
        val ordered = orders.values
            .asSequence()
            .filter { it.customerId == customerId }
            .filter { status == null || it.status == status }
            .map { it.toSummary() }
            .sortedWith(
                compareByDescending<CustomerOrderSummary> { it.placedAt }
                    .thenByDescending { it.orderId.toString() },
            )
            .toList()

        val offset = page.toLong() * pageSize.toLong()
        if (offset >= ordered.size.toLong()) {
            return@synchronized CustomerOrderSummaryPage(emptyList(), false)
        }
        val from = offset.toInt()
        val candidates = ordered.drop(from).take(pageSize + 1)
        CustomerOrderSummaryPage(
            items = candidates.take(pageSize),
            hasNext = candidates.size > pageSize,
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

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    private fun notFound(): Nothing = throw DomainException("ORDER_NOT_FOUND", "The order is unavailable")
}
