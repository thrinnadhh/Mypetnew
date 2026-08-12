package `in`.mypetnew.application.web

import `in`.mypetnew.commerce.domain.OrderActor
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/api/v1/customer/orders")
class CustomerOrderCancellationController(
    private val orders: OrderService,
) {
    @PostMapping("/{orderId}/cancel")
    fun cancel(
        authentication: Authentication,
        @PathVariable orderId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
    ): ProductOrder {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val order = orders.get(orderId)
        if (order.customerId != customer.actorId) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return orders.transition(
            orderId = order.id,
            target = OrderStatus.CANCELLED,
            idempotencyKey = idempotencyKey,
            actor = OrderActor.CUSTOMER,
        )
    }
}
