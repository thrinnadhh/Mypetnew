package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.CustomerOrderCategory
import `in`.mypetnew.commerce.domain.CustomerOrderCursor
import `in`.mypetnew.commerce.domain.CustomerOrderDetailSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderService
import org.slf4j.MDC
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class CustomerOrderCancelRequest(val reason: String)
data class CustomerOrderItemView(
    val listingId: UUID,
    val name: String,
    val quantity: Int,
    val unitPricePaise: Long,
    val lineTotalPaise: Long,
)
data class CustomerOrderHistoryView(
    val fromStatus: OrderStatus?,
    val toStatus: OrderStatus,
    val changedAt: Instant,
    val reason: String?,
)
data class CustomerOrderPricingView(
    val itemSubtotalPaise: Long,
    val platformFeePaise: Long,
    val deliveryFeePaise: Long,
    val grandTotalPaise: Long,
    val currency: String,
)
data class CustomerOrderDeliveryAddressView(
    val addressId: UUID,
    val recipientName: String,
    val phoneNumber: String,
    val line1: String,
    val line2: String?,
    val city: String,
    val state: String,
    val pincode: String,
)
data class CustomerOrderCancellationView(
    val cancelled: Boolean,
    val reason: String?,
    val cancelledAt: Instant?,
)
data class CustomerOrderOutletSummary(
    val id: UUID,
    val name: String,
)
data class CustomerOrderView(
    val orderId: UUID,
    val orderNumber: String,
    val outlet: CustomerOrderOutletSummary,
    val items: List<CustomerOrderItemView>,
    val pricing: CustomerOrderPricingView,
    val paymentMethod: String,
    val paymentStatus: String,
    val fulfilmentMode: String,
    val status: OrderStatus,
    val placedAt: Instant?,
    val statusHistory: List<CustomerOrderHistoryView>,
    val deliveryAddress: CustomerOrderDeliveryAddressView?,
    val canCancel: Boolean,
    val cancellation: CustomerOrderCancellationView,
)

data class CustomerOrderSummaryResponse(
    val orderId: UUID,
    val outlet: CustomerOrderOutletSummary,
    val itemCount: Int,
    val grandTotalPaise: Long,
    val fulfilmentMode: String,
    val paymentMethod: String,
    val paymentStatus: String,
    val status: OrderStatus,
    val placedAt: Instant,
    val lastUpdatedAt: Instant,
)

data class CustomerOrderCursorResponse(
    val placedAt: Instant,
    val orderId: UUID,
)

data class CustomerOrderPageResponse(
    val items: List<CustomerOrderSummaryResponse>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
    val nextCursor: CustomerOrderCursorResponse?,
)

@RestController
@RequestMapping("/api/v1/customer/orders")
class CustomerOrderApiController(
    private val orders: OrderService,
    private val orderQuery: CustomerOrderQuery,
    private val providers: ProviderService,
    private val quotes: QuoteService,
) {
    @GetMapping
    fun list(
        authentication: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
        @RequestParam(required = false) status: OrderStatus?,
        @RequestParam(required = false) category: CustomerOrderCategory?,
        @RequestParam(required = false) beforePlacedAt: Instant?,
        @RequestParam(required = false) beforeOrderId: UUID?,
    ): CustomerOrderPageResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        PaginationHelper.validate(page, pageSize)
        if ((beforePlacedAt == null) != (beforeOrderId == null)) {
            throw DomainException("ORDER_CURSOR_INVALID", "The order cursor is incomplete")
        }
        val cursor = if (beforePlacedAt != null && beforeOrderId != null) {
            CustomerOrderCursor(beforePlacedAt, beforeOrderId)
        } else {
            null
        }

        val result = orderQuery.list(customer.actorId, status, page, pageSize, category, cursor)
        return CustomerOrderPageResponse(
            items = result.items.map { summary ->
                val outlet = providers.getOutlet(summary.outletId)
                CustomerOrderSummaryResponse(
                    orderId = summary.orderId,
                    outlet = CustomerOrderOutletSummary(outlet.id, outlet.name),
                    itemCount = summary.itemCount,
                    grandTotalPaise = summary.grandTotalPaise,
                    fulfilmentMode = summary.fulfilmentMode,
                    paymentMethod = summary.paymentMethod,
                    paymentStatus = summary.paymentStatus,
                    status = summary.status,
                    placedAt = summary.placedAt,
                    lastUpdatedAt = summary.lastUpdatedAt,
                )
            },
            page = page,
            pageSize = pageSize,
            hasNext = result.hasNext,
            nextCursor = result.nextCursor?.let { CustomerOrderCursorResponse(it.placedAt, it.orderId) },
        )
    }

    @GetMapping("/{orderId}")
    fun get(authentication: Authentication, @PathVariable orderId: UUID): CustomerOrderView {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return view(customer.actorId, ownedSnapshot(customer.actorId, orderId))
    }

    @PostMapping("/{orderId}/cancel")
    fun cancel(
        authentication: Authentication,
        @PathVariable orderId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: CustomerOrderCancelRequest,
    ): CustomerOrderView {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        ownedSnapshot(customer.actorId, orderId)
        orders.transition(
            orderId = orderId,
            target = OrderStatus.CANCELLED,
            idempotencyKey = idempotencyKey,
            actorId = customer.actorId,
            actorRole = Role.CUSTOMER,
            reason = request.reason,
            traceId = MDC.get("traceId") ?: InventoryService.SYSTEM_TRACE_ID,
        )
        return view(customer.actorId, ownedSnapshot(customer.actorId, orderId))
    }

    private fun ownedSnapshot(customerId: UUID, orderId: UUID): CustomerOrderDetailSnapshot =
        orderQuery.detail(customerId, orderId)
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    private fun view(customerId: UUID, order: CustomerOrderDetailSnapshot): CustomerOrderView {
        val outlet = providers.getOutlet(order.outletId)
        val quote = quotes.get(order.quoteId)
        if (quote.customerId != customerId || quote.outletId != order.outletId) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        val cancellationEntry = order.statusHistory.lastOrNull { it.status == OrderStatus.CANCELLED }
        return CustomerOrderView(
            orderId = order.orderId,
            orderNumber = order.orderNumber,
            outlet = CustomerOrderOutletSummary(outlet.id, outlet.name),
            items = order.items.map { item ->
                CustomerOrderItemView(
                    listingId = item.listingId,
                    name = item.listingName,
                    quantity = item.quantity,
                    unitPricePaise = item.unitPricePaise,
                    lineTotalPaise = Math.multiplyExact(item.unitPricePaise, item.quantity.toLong()),
                )
            },
            pricing = CustomerOrderPricingView(
                itemSubtotalPaise = quote.pricing.itemSubtotalPaise,
                platformFeePaise = quote.pricing.platformFeePaise,
                deliveryFeePaise = quote.pricing.deliveryFeePaise,
                grandTotalPaise = order.grandTotalPaise,
                currency = quote.pricing.currency,
            ),
            paymentMethod = order.paymentMethod,
            paymentStatus = order.paymentStatus,
            fulfilmentMode = order.fulfilmentMode,
            status = order.status,
            placedAt = order.placedAt,
            statusHistory = order.statusHistory.map { entry ->
                CustomerOrderHistoryView(
                    fromStatus = entry.fromStatus,
                    toStatus = entry.status,
                    changedAt = entry.occurredAt,
                    reason = entry.reason,
                )
            },
            deliveryAddress = quote.deliveryAddress?.let { address ->
                CustomerOrderDeliveryAddressView(
                    addressId = address.addressId,
                    recipientName = address.recipientName,
                    phoneNumber = address.phoneNumber,
                    line1 = address.line1,
                    line2 = address.line2,
                    city = address.city,
                    state = address.state,
                    pincode = address.pincode,
                )
            },
            canCancel = order.status == OrderStatus.PLACED,
            cancellation = CustomerOrderCancellationView(
                cancelled = order.status == OrderStatus.CANCELLED,
                reason = cancellationEntry?.reason,
                cancelledAt = cancellationEntry?.occurredAt,
            ),
        )
    }
}
