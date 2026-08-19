package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.recurring.domain.RecurringOrderConfirmation
import `in`.mypetnew.recurring.domain.RecurringOrderService
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
import `in`.mypetnew.recurring.domain.RecurringOrderSubscription
import `in`.mypetnew.recurring.domain.RenewalProposal
import `in`.mypetnew.recurring.domain.RenewalProposalStatus
import org.slf4j.MDC
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
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

data class CompleteRecurringProposalRequest(val orderId: UUID)

data class RecurringOrderResponse(
    val subscriptionId: UUID,
    val customerId: UUID,
    val providerId: UUID,
    val sourceOrderId: UUID,
    val deliveryAddressId: UUID?,
    val fulfilmentMode: String,
    val cadenceDays: Int,
    val quantityMultiplier: Int,
    val status: RecurringOrderStatus,
    val nextOrderAt: Instant,
    val lastRemindedAt: Instant?,
    val timeZone: String,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class RenewalProposalResponse(
    val proposalId: UUID,
    val subscriptionId: UUID,
    val providerId: UUID,
    val sourceOrderId: UUID,
    val deliveryAddressId: UUID?,
    val fulfilmentMode: String,
    val cadenceDays: Int,
    val quantityMultiplier: Int,
    val dueCycleAt: Instant,
    val status: RenewalProposalStatus,
    val expiresAt: Instant,
    val revalidatedAt: Instant?,
    val confirmedAt: Instant?,
    val orderId: UUID?,
    val failureReason: String?,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class RecurringRevalidationItemResponse(
    val offeringId: UUID,
    val offeringName: String,
    val unitPricePaise: Long,
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
    val proposal: RenewalProposalResponse,
    val reorder: RecurringReorderResponse,
    val createdOrderId: UUID? = null,
)

@RestController
@RequestMapping("/api/v1/customer/recurring-orders")
class CustomerRecurringOrderController(
    private val recurring: RecurringOrderService,
    private val orders: OrderService,
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

    @GetMapping("/proposals")
    fun proposals(
        authentication: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
    ): PageResponse<RenewalProposalResponse> {
        val customerId = customer(authentication)
        val result = recurring.listProposals(customerId, page, pageSize)
        return PageResponse(result.items.map(::proposalResponse), page, pageSize, result.hasNext)
    }

    @GetMapping("/{subscriptionId}/proposals/{proposalId}")
    fun proposal(
        authentication: Authentication,
        @PathVariable subscriptionId: UUID,
        @PathVariable proposalId: UUID,
    ): RenewalProposalResponse = proposalResponse(
        recurring.getProposal(customer(authentication), subscriptionId, proposalId),
    )

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: CreateRecurringOrderRequest,
    ): RecurringOrderResponse = response(
        recurring.create(
            customer(authentication),
            request.sourceOrderId,
            request.cadenceDays,
            request.quantityMultiplier,
            idempotencyKey,
            currentTraceId(),
        ),
    )

    @PatchMapping("/{subscriptionId}")
    fun update(
        authentication: Authentication,
        @PathVariable subscriptionId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: UpdateRecurringOrderRequest,
    ): RecurringOrderResponse = response(
        recurring.update(
            customer(authentication),
            subscriptionId,
            request.action,
            request.cadenceDays,
            request.quantityMultiplier,
            request.deliveryAddressId,
            idempotencyKey,
            currentTraceId(),
        ),
    )

    @PostMapping("/{subscriptionId}/proposals/{proposalId}/confirm")
    fun confirm(
        authentication: Authentication,
        @PathVariable subscriptionId: UUID,
        @PathVariable proposalId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
    ): RecurringOrderConfirmationResponse = confirmation(
        recurring.confirm(
            customer(authentication),
            subscriptionId,
            proposalId,
            idempotencyKey,
            currentTraceId(),
        ),
    )

    @PostMapping("/{subscriptionId}/proposals/{proposalId}/complete")
    fun complete(
        authentication: Authentication,
        @PathVariable subscriptionId: UUID,
        @PathVariable proposalId: UUID,
        @RequestHeader("Idempotency-Key") checkoutIdempotencyKey: String,
        @RequestBody request: CompleteRecurringProposalRequest,
    ): RenewalProposalResponse {
        val customerId = customer(authentication)
        recurring.getProposal(customerId, subscriptionId, proposalId)
        val order = orders.get(request.orderId)
        if (order.customerId != customerId) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return proposalResponse(
            recurring.completeWithOrder(
                customerId,
                proposalId,
                order,
                checkoutIdempotencyKey,
                currentTraceId(),
            ),
        )
    }

    private fun customer(authentication: Authentication): UUID {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.CUSTOMER)
        return principal.actorId
    }

    private fun currentTraceId(): String = MDC.get("traceId") ?: InventoryService.SYSTEM_TRACE_ID
}

private fun response(value: RecurringOrderSubscription) = RecurringOrderResponse(
    subscriptionId = value.id,
    customerId = value.customerId,
    providerId = value.providerId,
    sourceOrderId = value.sourceOrderId,
    deliveryAddressId = value.deliveryAddressId,
    fulfilmentMode = value.fulfilmentMode,
    cadenceDays = value.cadenceDays,
    quantityMultiplier = value.quantityMultiplier,
    status = value.status,
    nextOrderAt = value.nextOrderAt,
    lastRemindedAt = value.lastRemindedAt,
    timeZone = value.timeZone,
    version = value.version,
    createdAt = value.createdAt,
    updatedAt = value.updatedAt,
)

private fun proposalResponse(value: RenewalProposal) = RenewalProposalResponse(
    proposalId = value.id,
    subscriptionId = value.subscriptionId,
    providerId = value.providerId,
    sourceOrderId = value.sourceOrderId,
    deliveryAddressId = value.deliveryAddressId,
    fulfilmentMode = value.fulfilmentMode,
    cadenceDays = value.cadenceDays,
    quantityMultiplier = value.quantityMultiplier,
    dueCycleAt = value.dueCycleAt,
    status = value.status,
    expiresAt = value.expiresAt,
    revalidatedAt = value.revalidatedAt,
    confirmedAt = value.confirmedAt,
    orderId = value.orderId,
    failureReason = value.failureReason,
    version = value.version,
    createdAt = value.createdAt,
    updatedAt = value.updatedAt,
)

private fun confirmation(value: RecurringOrderConfirmation) = RecurringOrderConfirmationResponse(
    subscription = response(value.subscription),
    proposal = proposalResponse(value.proposal),
    reorder = RecurringReorderResponse(
        originalOrderId = value.originalOrderId,
        providerId = value.providerId,
        isProviderServiceable = value.providerServiceable,
        items = value.items.map { item ->
            RecurringRevalidationItemResponse(
                offeringId = item.listingId,
                offeringName = item.name,
                unitPricePaise = item.unitPricePaise,
                quantity = item.quantity,
                isAvailable = item.available,
                message = item.failureReason,
            )
        },
        canReorder = value.canReorder,
    ),
    createdOrderId = value.createdOrderId,
)
