package `in`.mypetnew.application.web

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.recurring.domain.RecurringOrderConfirmation
import `in`.mypetnew.recurring.domain.RecurringOrderService
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
import `in`.mypetnew.recurring.domain.RecurringOrderSubscription
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class CreateRecurringOrderRequest(
    val sourceOrderId: UUID,
    val cadenceDays: Int,
    val quantityMultiplier: Int = 1,
)

data class UpdateRecurringOrderRequest(
    val action: String,
    val cadenceDays: Int? = null,
    val quantityMultiplier: Int? = null,
    val deliveryAddressId: UUID? = null,
)

data class RecurringOrderResponse(
    val subscriptionId: UUID,
    val customerId: UUID,
    val providerId: UUID,
    val sourceOrderId: UUID,
    val deliveryAddressId: UUID,
    val cadenceDays: Int,
    val quantityMultiplier: Int,
    val status: RecurringOrderStatus,
    val nextOrderAt: Instant,
    val lastRemindedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class RecurringRevalidationItemResponse(
    val offeringId: UUID,
    val offeringName: String,
    val unitPrice: Double,
    val quantity: Int,
    val isAvailable: Boolean,
    val message: String?,
)

data class RecurringReorderResponse(
    val originalOrderId: UUID,
    val providerId: UUID,
    val isProviderServiceable: Boolean,
    val items: List<RecurringRevalidationItemResponse>,
    val canReorder: Boolean,
)

data class RecurringOrderConfirmationResponse(
    val subscription: RecurringOrderResponse,
    val reorder: RecurringReorderResponse,
    val createdOrderId: UUID? = null,
)

@RestController
@RequestMapping("/api/v1/customer/recurring-orders")
class CustomerRecurringOrderController(
    private val recurring: RecurringOrderService,
) {
    @GetMapping
    fun list(
        authentication: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
    ): PageResponse<RecurringOrderResponse> {
        val customerId = customer(authentication)
        val result = recurring.list(customerId, page, pageSize)
        return PageResponse(result.items.map(::response), page, pageSize, result.hasNext)
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(
        authentication: Authentication,
        @RequestBody request: CreateRecurringOrderRequest,
    ): RecurringOrderResponse = response(
        recurring.create(
            customer(authentication),
            request.sourceOrderId,
            request.cadenceDays,
            request.quantityMultiplier,
        ),
    )

    @PatchMapping("/{subscriptionId}")
    fun update(
        authentication: Authentication,
        @PathVariable subscriptionId: UUID,
        @RequestBody request: UpdateRecurringOrderRequest,
    ): RecurringOrderResponse = response(
        recurring.update(
            customer(authentication),
            subscriptionId,
            request.action,
            request.cadenceDays,
            request.quantityMultiplier,
            request.deliveryAddressId,
        ),
    )

    @PostMapping("/{subscriptionId}/confirm")
    fun confirm(
        authentication: Authentication,
        @PathVariable subscriptionId: UUID,
    ): RecurringOrderConfirmationResponse = confirmation(
        recurring.confirm(customer(authentication), subscriptionId),
    )

    private fun customer(authentication: Authentication): UUID {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.CUSTOMER)
        return principal.actorId
    }
}

private fun response(value: RecurringOrderSubscription) = RecurringOrderResponse(
    subscriptionId = value.id,
    customerId = value.customerId,
    providerId = value.providerId,
    sourceOrderId = value.sourceOrderId,
    deliveryAddressId = value.deliveryAddressId,
    cadenceDays = value.cadenceDays,
    quantityMultiplier = value.quantityMultiplier,
    status = value.status,
    nextOrderAt = value.nextOrderAt,
    lastRemindedAt = value.lastRemindedAt,
    createdAt = value.createdAt,
    updatedAt = value.updatedAt,
)

private fun confirmation(value: RecurringOrderConfirmation) = RecurringOrderConfirmationResponse(
    subscription = response(value.subscription),
    reorder = RecurringReorderResponse(
        originalOrderId = value.originalOrderId,
        providerId = value.providerId,
        isProviderServiceable = value.providerServiceable,
        items = value.items.map { item ->
            RecurringRevalidationItemResponse(
                offeringId = item.offeringId,
                offeringName = item.offeringName,
                unitPrice = item.unitPricePaise / 100.0,
                quantity = item.quantity,
                isAvailable = item.available,
                message = item.message,
            )
        },
        canReorder = value.canReorder,
    ),
)
