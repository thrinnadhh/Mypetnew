package `in`.mypetnew.commerce.domain

import java.time.Instant
import java.util.UUID

enum class CustomerOrderCategory {
    ACTIVE,
    PAST,
}

data class CustomerOrderCursor(
    val placedAt: Instant,
    val orderId: UUID,
)

data class CustomerOrderSummary(
    val orderId: UUID,
    val outletId: UUID,
    val itemCount: Int,
    val grandTotalPaise: Long,
    val fulfilmentMode: String,
    val paymentMethod: String,
    val paymentStatus: String,
    val status: OrderStatus,
    val placedAt: Instant,
    val lastUpdatedAt: Instant,
)

data class CustomerOrderSummaryPage(
    val items: List<CustomerOrderSummary>,
    val hasNext: Boolean,
    val nextCursor: CustomerOrderCursor? = null,
)

data class CustomerOrderLineSnapshot(
    val listingId: UUID,
    val listingName: String,
    val quantity: Int,
    val unitPricePaise: Long,
)

data class CustomerOrderDetailSnapshot(
    val orderId: UUID,
    val orderNumber: String,
    val outletId: UUID,
    val quoteId: UUID,
    val items: List<CustomerOrderLineSnapshot>,
    val grandTotalPaise: Long,
    val platformFeePaise: Long,
    val paymentMethod: String,
    val paymentStatus: String,
    val fulfilmentMode: String,
    val status: OrderStatus,
    val placedAt: Instant?,
    val statusHistory: List<OrderHistoryEntry>,
)

interface CustomerOrderQuery {
    fun list(
        customerId: UUID,
        status: OrderStatus?,
        page: Int,
        pageSize: Int,
        category: CustomerOrderCategory? = null,
        cursor: CustomerOrderCursor? = null,
    ): CustomerOrderSummaryPage

    fun detail(customerId: UUID, orderId: UUID): CustomerOrderDetailSnapshot?
}
