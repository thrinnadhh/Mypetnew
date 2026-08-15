package `in`.mypetnew.commerce.domain

import java.time.Instant
import java.util.UUID

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
)

interface CustomerOrderQuery {
    fun list(
        customerId: UUID,
        status: OrderStatus?,
        page: Int,
        pageSize: Int,
    ): CustomerOrderSummaryPage
}
