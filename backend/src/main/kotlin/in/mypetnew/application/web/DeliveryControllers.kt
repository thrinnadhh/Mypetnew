package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.DeliveryAddressSnapshot
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.Quote
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.delivery.domain.DeliveryPricingPolicy
import `in`.mypetnew.delivery.domain.DispatchJob
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.delivery.domain.DispatchStatus
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class DeliveryQuoteRequest(
    val outletId: UUID,
    val addressId: UUID,
    val lines: List<OrderLineRequest>,
)

data class CustomerCaptainProjection(
    val captainId: UUID,
    val assignedAt: Instant?,
)

data class CustomerCaptainLocationProjection(
    val latitude: Double,
    val longitude: Double,
    val observedAt: Instant,
)

data class CustomerOrderTrackingResponse(
    val orderId: UUID,
    val status: OrderStatus,
    val flowStep: String,
    val paymentStatus: String,
    val fulfilmentMode: String,
    val captain: CustomerCaptainProjection?,
    val etaMinutes: Int?,
    val deliveryStatus: String?,
    val lastLocation: CustomerCaptainLocationProjection?,
)

@RestController
@RequestMapping("/api/v1/customer")
class CustomerDeliveryApiController(
    private val providers: ProviderService,
    private val catalog: CatalogService,
    private val inventory: InventoryService,
    private val customerData: CustomerDataService,
    private val quotes: QuoteService,
    private val orders: OrderService,
    private val pricing: DeliveryPricingPolicy,
    private val dispatch: DispatchService,
) {
    @PostMapping("/quotes/delivery")
    fun quote(
        authentication: Authentication,
        @RequestBody request: DeliveryQuoteRequest,
    ): Quote {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val address = customerData.getAddress(customer.actorId, request.addressId)
        val outlet = providers.getOutlet(request.outletId)
        if (
            outlet.status != ProviderStatus.ACTIVE ||
            ProviderCapability.PRODUCT_STORE !in outlet.capabilities
        ) unavailable()
        if (address.pincode !in outlet.servicePinCodes) {
            throw DomainException("OUTLET_NOT_SERVICEABLE", "The selected outlet does not serve this delivery PIN code")
        }
        if (outlet.latitude == null || outlet.longitude == null) {
            throw DomainException("DELIVERY_DISPATCH_ORIGIN_REQUIRED", "The outlet is not configured for Captain dispatch")
        }
        val lines = request.lines.associate { line ->
            val listing = catalog.getListing(line.listingId)
            if (
                listing.outletId != outlet.id ||
                listing.commerceMode != CommerceMode.COMMERCE ||
                line.quantity <= 0 ||
                inventory.available(listing.id) < line.quantity
            ) {
                throw DomainException("LISTING_UNAVAILABLE", "A cart item is unavailable")
            }
            listing.id to Pair(line.quantity, listing.sellingPricePaise)
        }
        if (lines.size != request.lines.size) {
            throw DomainException("CART_INVALID", "The cart contains duplicate lines")
        }
        val estimate = pricing.estimate()
        return quotes.createDeliveryQuote(
            customerId = customer.actorId,
            outletId = outlet.id,
            lines = lines,
            deliveryAddress = DeliveryAddressSnapshot(
                addressId = address.id,
                recipientName = address.recipientName,
                phoneNumber = address.phoneNumber,
                line1 = address.line1,
                line2 = address.line2,
                city = address.city,
                state = address.state,
                pincode = address.pincode,
            ),
            deliveryFeePaise = estimate.deliveryFeePaise,
            etaMinutes = estimate.etaMinutes,
        )
    }

    @GetMapping("/orders/{orderId}/tracking")
    fun tracking(
        authentication: Authentication,
        @PathVariable orderId: UUID,
    ): CustomerOrderTrackingResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val order = orders.get(orderId)
        if (order.customerId != customer.actorId) unavailable()
        val quote = quotes.get(order.quoteId)
        val job = dispatch.tracking(order.id)
        val captainId = job?.assignedCaptainId
        val mayDiscloseLiveLocation = job?.status == DispatchStatus.ASSIGNED || job?.status == DispatchStatus.PICKED_UP
        val location = if (mayDiscloseLiveLocation) captainId?.let(dispatch::captainLocation) else null
        return CustomerOrderTrackingResponse(
            orderId = order.id,
            status = order.status,
            flowStep = flowStep(order.status, job),
            paymentStatus = order.paymentStatus,
            fulfilmentMode = order.fulfilmentMode,
            captain = captainId?.let { CustomerCaptainProjection(it, job.assignedAt) },
            etaMinutes = quote.etaMinutes,
            deliveryStatus = job?.status?.name,
            lastLocation = location?.let {
                CustomerCaptainLocationProjection(it.latitude, it.longitude, it.observedAt)
            },
        )
    }

    private fun flowStep(status: OrderStatus, job: DispatchJob?): String = when (status) {
        OrderStatus.PLACED -> "placed"
        OrderStatus.ACCEPTED -> "confirmed"
        OrderStatus.PREPARING -> "preparing"
        OrderStatus.READY_FOR_PICKUP -> if (job?.assignedCaptainId != null) "assigned" else "readyForPickup"
        OrderStatus.PICKED_UP -> "outForDelivery"
        OrderStatus.DELIVERED -> "delivered"
        OrderStatus.REJECTED, OrderStatus.CANCELLED -> "cancelled"
    }
}

data class DispatchOriginRequest(val latitude: Double, val longitude: Double)

@RestController
@RequestMapping("/api/v1/merchant/outlets")
class MerchantDeliveryConfigurationApiController(private val providers: ProviderService) {
    @PutMapping("/{outletId}/dispatch-origin")
    fun configureOrigin(
        authentication: Authentication,
        @PathVariable outletId: UUID,
        @RequestBody request: DispatchOriginRequest,
    ) = providers.configureDispatchOrigin(
        authentication.domainPrincipal(),
        outletId,
        request.latitude,
        request.longitude,
    )
}

data class CaptainAvailabilityRequest(
    val online: Boolean,
    val latitude: Double? = null,
    val longitude: Double? = null,
)

enum class CaptainOfferAction { ACCEPT, REJECT }
data class CaptainOfferResponseRequest(val action: CaptainOfferAction)

data class CaptainOfferProjection(
    val offerId: UUID,
    val jobId: UUID,
    val expiresAt: Instant,
)

data class CaptainDeliveryAddressProjection(
    val addressId: UUID,
    val recipientName: String,
    val phoneNumber: String,
    val line1: String,
    val line2: String?,
    val city: String,
    val state: String,
    val pincode: String,
)

data class CaptainAssignmentProjection(
    val accepted: Boolean,
    val jobId: UUID?,
    val orderId: UUID?,
    val outletId: UUID?,
    val outletName: String?,
    val deliveryAddress: CaptainDeliveryAddressProjection?,
)

@RestController
@RequestMapping("/api/v1/captain")
class CaptainDeliveryApiController(
    private val dispatch: DispatchService,
    private val orders: OrderService,
    private val quotes: QuoteService,
    private val providers: ProviderService,
) {
    @PutMapping("/availability")
    fun availability(
        authentication: Authentication,
        @RequestBody request: CaptainAvailabilityRequest,
    ) = authentication.domainPrincipal().let { captain ->
        Authorizer.requireRole(captain, Role.CAPTAIN)
        dispatch.updateAvailability(captain.actorId, request.online, request.latitude, request.longitude)
    }

    @GetMapping("/dispatch/offers")
    fun offers(authentication: Authentication): List<CaptainOfferProjection> {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        return dispatch.pendingOffers(captain.actorId).map {
            CaptainOfferProjection(it.id, it.jobId, it.expiresAt)
        }
    }

    @PostMapping("/dispatch/offers/{offerId}/respond")
    fun respond(
        authentication: Authentication,
        @PathVariable offerId: UUID,
        @RequestBody request: CaptainOfferResponseRequest,
    ): CaptainAssignmentProjection {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val accepted = request.action == CaptainOfferAction.ACCEPT
        val job = dispatch.respondToOffer(captain.actorId, offerId, accepted)
        if (!accepted) return CaptainAssignmentProjection(false, null, null, null, null, null)
        val order = orders.get(job.orderId)
        val quote = quotes.get(order.quoteId)
        val outlet = providers.getOutlet(order.outletId)
        val address = quote.deliveryAddress
            ?: throw DomainException("DELIVERY_ADDRESS_REQUIRED", "The assigned delivery address is unavailable")
        return CaptainAssignmentProjection(
            accepted = true,
            jobId = job.id,
            orderId = order.id,
            outletId = outlet.id,
            outletName = outlet.name,
            deliveryAddress = CaptainDeliveryAddressProjection(
                addressId = address.addressId,
                recipientName = address.recipientName,
                phoneNumber = address.phoneNumber,
                line1 = address.line1,
                line2 = address.line2,
                city = address.city,
                state = address.state,
                pincode = address.pincode,
            ),
        )
    }

    @PostMapping("/dispatch/{jobId}/picked-up")
    fun pickedUp(
        authentication: Authentication,
        @PathVariable jobId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
    ): DispatchJob {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        return dispatch.markPickedUp(captain.actorId, jobId, idempotencyKey)
    }

    @PostMapping("/dispatch/{jobId}/delivered")
    fun delivered(
        authentication: Authentication,
        @PathVariable jobId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
    ): DispatchJob {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        return dispatch.markDelivered(captain.actorId, jobId, idempotencyKey)
    }
}

@RestController
@RequestMapping("/api/v1/admin/captains")
class CaptainApprovalApiController(private val dispatch: DispatchService) {
    @PostMapping("/{captainId}/approve")
    fun approve(authentication: Authentication, @PathVariable captainId: UUID) =
        authentication.domainPrincipal().let { admin ->
            Authorizer.requireAdminPermission(admin, AdminPermission.CAPTAIN_REVIEW)
            dispatch.approveCaptain(captainId)
        }
}

private fun unavailable(): Nothing = throw DomainException(
    "RESOURCE_NOT_FOUND",
    "The requested resource is unavailable",
)
