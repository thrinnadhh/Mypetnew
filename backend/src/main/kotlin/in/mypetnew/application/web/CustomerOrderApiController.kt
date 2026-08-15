package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
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
data class CustomerOrderItemView(val listingId: UUID, val name: String?, val quantity: Int)
data class CustomerOrderHistoryView(
    val fromStatus: OrderStatus?,
    val toStatus: OrderStatus,
    val changedAt: Instant,
    val reason: String?,
)
data class CustomerOrderView(
    val orderId: UUID,
    val orderNumber: String,
    val outletId: UUID,
    val organizationId: UUID,
    val outletName: String,
    val items: List<CustomerOrderItemView>,
    val grandTotalPaise: Long,
    val platformFeePaise: Long,
    val paymentMethod: String,
    val paymentStatus: String,
    val fulfilmentMode: String,
    val status: OrderStatus,
    val placedAt: Instant?,
    val statusHistory: List<CustomerOrderHistoryView>,
)

data class CustomerOrderOutletSummary(
    val id: UUID,
    val name: String,
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

@RestController
@RequestMapping("/api/v1/customer/orders")
class CustomerOrderApiController(
    private val orders: OrderService,
    private val orderQuery: CustomerOrderQuery,
    private val providers: ProviderService,
    private val catalog: CatalogService,
) {
    @GetMapping
    fun list(
        authentication: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
        @RequestParam(required = false) status: OrderStatus?,
    ): PageResponse<CustomerOrderSummaryResponse> {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        PaginationHelper.validate(page, pageSize)

        val result = orderQuery.list(customer.actorId, status, page, pageSize)
        return PageResponse(
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
        )
    }

    @GetMapping("/{orderId}")
    fun get(authentication: Authentication, @PathVariable orderId: UUID): CustomerOrderView {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return view(ownedOrder(customer.actorId, orderId))
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
        ownedOrder(customer.actorId, orderId)
        return view(
            orders.transition(
                orderId = orderId,
                target = OrderStatus.CANCELLED,
                idempotencyKey = idempotencyKey,
                actorId = customer.actorId,
                actorRole = Role.CUSTOMER,
                reason = request.reason,
                traceId = MDC.get("traceId") ?: InventoryService.SYSTEM_TRACE_ID,
            ),
        )
    }

    private fun ownedOrder(customerId: UUID, orderId: UUID): ProductOrder {
        val order = try {
            orders.get(orderId)
        } catch (error: DomainException) {
            if (error.code == "ORDER_NOT_FOUND") {
                throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
            }
            throw error
        }
        if (order.customerId != customerId) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return order
    }

    private fun listingName(listingId: UUID): String? = try {
        catalog.getListing(listingId).name
    } catch (error: DomainException) {
        if (error.code == "RESOURCE_NOT_FOUND") null else throw error
    }

    private fun view(order: ProductOrder): CustomerOrderView {
        val outlet = providers.getOutlet(order.outletId)
        return CustomerOrderView(
            orderId = order.id,
            orderNumber = order.orderNumber,
            outletId = order.outletId,
            organizationId = order.organizationId,
            outletName = outlet.name,
            items = order.lines.map { (listingId, quantity) ->
                CustomerOrderItemView(
                    listingId = listingId,
                    name = listingName(listingId),
                    quantity = quantity,
                )
            },
            grandTotalPaise = order.grandTotalPaise,
            platformFeePaise = order.platformFeePaise,
            paymentMethod = order.paymentMethod,
            paymentStatus = order.paymentStatus,
            fulfilmentMode = order.fulfilmentMode,
            status = order.status,
            placedAt = order.history.firstOrNull()?.occurredAt,
            statusHistory = order.history.map { entry ->
                CustomerOrderHistoryView(
                    fromStatus = entry.fromStatus,
                    toStatus = entry.status,
                    changedAt = entry.occurredAt,
                    reason = entry.reason,
                )
            },
        )
    }
}
