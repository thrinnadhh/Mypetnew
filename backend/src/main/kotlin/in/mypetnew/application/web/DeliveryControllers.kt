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
import `in`.mypetnew.delivery.domain.CaptainDeliveryHistoryItem
import `in`.mypetnew.delivery.domain.CaptainDeliveryState
import `in`.mypetnew.delivery.domain.CaptainEarningsService
import `in`.mypetnew.delivery.domain.CaptainEarningsSummary
import `in`.mypetnew.delivery.domain.CaptainOnboardingService
import `in`.mypetnew.delivery.domain.CaptainSupportService
import `in`.mypetnew.delivery.domain.CreateSupportTicketCommand
import `in`.mypetnew.delivery.domain.DeliveryPricingPolicy
import `in`.mypetnew.delivery.domain.DeliveryProof
import `in`.mypetnew.delivery.domain.DispatchJob
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.delivery.domain.DispatchStatus
import `in`.mypetnew.delivery.domain.OnboardingBankDetails
import `in`.mypetnew.delivery.domain.OnboardingConsentDetails
import `in`.mypetnew.delivery.domain.OnboardingIdentityDetails
import `in`.mypetnew.delivery.domain.OnboardingPersonalDetails
import `in`.mypetnew.delivery.domain.OnboardingStatus
import `in`.mypetnew.delivery.domain.OnboardingVehicleDetails
import `in`.mypetnew.delivery.domain.SaveOnboardingDraftCommand
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
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
    val paymentMethod: String? = null,
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
    val deliveryPin: String? = null,
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
        val address = try {
            customerData.getAddress(customer.actorId, request.addressId)
        } catch (error: DomainException) {
            if (error.code == "RESOURCE_NOT_FOUND") {
                throw DomainException("ADDRESS_NOT_FOUND", "The selected delivery address is unavailable")
            }
            throw error
        }
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
            paymentMethod = request.paymentMethod,
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
        val deliveryPin = if (captainId != null && (job.status == DispatchStatus.ASSIGNED || job.status == DispatchStatus.PICKED_UP)) {
            job.deliveryPin
        } else {
            null
        }
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
            deliveryPin = deliveryPin,
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
    val accuracy: Double? = null,
    val capturedAt: Instant? = null,
    val heading: Double? = null,
    val speed: Double? = null,
)

data class CaptainLocationRequest(
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracy: Double? = null,
    val capturedAt: Instant? = null,
    val heading: Double? = null,
    val speed: Double? = null,
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

data class CaptainJobResponse(
    val jobId: UUID,
    val orderId: UUID,
    val outletId: UUID,
    val status: String,
    val assignedCaptainId: UUID,
    val assignedAt: Instant?,
    val pickedUpAt: Instant?,
    val deliveredAt: Instant?,
    val failureReason: String?,
    val updatedAt: Instant,
)

data class CaptainAssignmentProjection(
    val accepted: Boolean,
    val jobId: UUID?,
    val orderId: UUID?,
    val outletId: UUID?,
    val outletName: String?,
    val originLatitude: Double?,
    val originLongitude: Double?,
    val deliveryAddress: CaptainDeliveryAddressProjection?,
)

data class CaptainActiveJobResponse(
    val jobId: UUID,
    val orderId: UUID,
    val orderReference: String,
    val outletId: UUID,
    val outletName: String,
    val originLatitude: Double,
    val originLongitude: Double,
    val deliveryAddress: CaptainDeliveryAddressProjection,
    val state: String,
    val itemCount: Int,
    val assignedAt: Instant,
    val pickedUpAt: Instant?,
    val deliveredAt: Instant?,
    val failureReason: String?,
)

data class DeliveryProofRequest(
    val type: String = "PIN",
    val pinCode: String = "",
    val capturedAt: Instant? = null,
)

data class CaptainJobProofBody(
    val proof: DeliveryProofRequest = DeliveryProofRequest(),
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
        dispatch.updateAvailability(
            captain.actorId,
            request.online,
            request.latitude,
            request.longitude,
            request.accuracy,
            request.capturedAt,
            request.heading,
            request.speed,
        )
    }

    @PostMapping("/location")
    fun location(
        authentication: Authentication,
        @RequestBody request: CaptainLocationRequest,
    ) = authentication.domainPrincipal().let { captain ->
        Authorizer.requireRole(captain, Role.CAPTAIN)
        dispatch.updateLocation(
            captain.actorId,
            request.latitude,
            request.longitude,
            request.accuracy,
            request.capturedAt,
            request.heading,
            request.speed,
        )
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
        if (!accepted) {
            return CaptainAssignmentProjection(false, null, null, null, null, null, null, null)
        }
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
            originLatitude = job.originLatitude,
            originLongitude = job.originLongitude,
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

    @GetMapping("/dispatch/{jobId}")
    fun getJob(
        authentication: Authentication,
        @PathVariable jobId: UUID,
    ): CaptainJobResponse {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val job = dispatch.getCaptainJob(captain.actorId, jobId)
        return CaptainJobResponse(
            jobId = job.id,
            orderId = job.orderId,
            outletId = job.outletId,
            status = job.status.name,
            assignedCaptainId = job.assignedCaptainId ?: captain.actorId,
            assignedAt = job.assignedAt,
            pickedUpAt = job.pickedUpAt,
            deliveredAt = job.deliveredAt,
            failureReason = job.failureReason,
            updatedAt = job.updatedAt,
        )
    }

    @GetMapping("/dispatch/active")
    fun getActiveJob(authentication: Authentication): ResponseEntity<CaptainActiveJobResponse> {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val job = dispatch.findActiveJob(captain.actorId) ?: return ResponseEntity.noContent().build()
        val order = orders.get(job.orderId)
        val quote = quotes.get(order.quoteId)
        val outlet = providers.getOutlet(order.outletId)
        val address = quote.deliveryAddress
            ?: throw DomainException("DELIVERY_ADDRESS_REQUIRED", "The assigned delivery address is unavailable")
        return ResponseEntity.ok(
            CaptainActiveJobResponse(
                jobId = job.id,
                orderId = job.orderId,
                orderReference = order.orderNumber,
                outletId = job.outletId,
                outletName = outlet.name,
                originLatitude = job.originLatitude,
                originLongitude = job.originLongitude,
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
                state = job.status.name,
                itemCount = order.lines.values.sum(),
                assignedAt = job.assignedAt ?: job.updatedAt,
                pickedUpAt = job.pickedUpAt,
                deliveredAt = job.deliveredAt,
                failureReason = job.failureReason,
            ),
        )
    }

    @PostMapping("/dispatch/{jobId}/picked-up")
    fun pickedUp(
        authentication: Authentication,
        @PathVariable jobId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: CaptainJobProofBody,
    ): DispatchJob {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        return dispatch.markPickedUp(
            captainId = captain.actorId,
            jobId = jobId,
            proof = DeliveryProof(
                type = request.proof.type,
                pinCode = request.proof.pinCode,
                capturedAt = request.proof.capturedAt ?: Instant.now(),
            ),
            idempotencyKey = idempotencyKey,
        )
    }

    @PostMapping("/dispatch/{jobId}/delivered")
    fun delivered(
        authentication: Authentication,
        @PathVariable jobId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: CaptainJobProofBody,
    ): DispatchJob {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        return dispatch.markDelivered(
            captainId = captain.actorId,
            jobId = jobId,
            proof = DeliveryProof(
                type = request.proof.type,
                pinCode = request.proof.pinCode,
                capturedAt = request.proof.capturedAt ?: Instant.now(),
            ),
            idempotencyKey = idempotencyKey,
        )
    }
}

data class VehicleProfileProjection(
    val type: String,
    val model: String?,
    val registrationNumber: String?,
    val verified: Boolean,
)

data class BankProfileProjection(
    val accountHolder: String?,
    val accountNumberMasked: String?,
    val ifscMasked: String?,
    val bankName: String?,
    val verified: Boolean,
)

data class CaptainProfileResponse(
    val captainId: UUID,
    val mobile: String,
    val name: String?,
    val status: String,
    val approved: Boolean,
    val online: Boolean,
    val busy: Boolean,
    val rejectionReason: String? = null,
    val joiningDate: Instant,
    val city: String? = null,
    val vehicle: VehicleProfileProjection? = null,
    val bank: BankProfileProjection? = null,
    val lastLocationAt: Instant? = null,
)

@RestController
@RequestMapping("/api/v1/captain")
class CaptainProfileApiController(
    private val dispatch: DispatchService,
    private val onboarding: CaptainOnboardingService,
    private val sessions: `in`.mypetnew.identity.domain.SessionStore,
) {
    @GetMapping("/me")
    fun me(authentication: Authentication): CaptainProfileResponse {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val identity = sessions.identityFor(captain.actorId) ?: unavailable()

        val state = dispatch.captainState(captain.actorId)
        val draft = onboarding.getDraft(captain.actorId)

        val approvalStatus = when {
            identity.status == "SUSPENDED" -> "SUSPENDED"
            state?.approved == true -> "ACTIVE"
            draft.status == OnboardingStatus.SUBMITTED -> "UNDER_REVIEW"
            draft.status == OnboardingStatus.REJECTED -> "REJECTED"
            draft.status == OnboardingStatus.APPROVED -> "ACTIVE"
            else -> "DRAFT"
        }

        val vehicle = draft.vehicle.registrationNumber?.let { reg ->
            VehicleProfileProjection(
                type = draft.vehicle.vehicleType ?: "BIKE",
                model = draft.vehicle.model,
                registrationNumber = reg,
                verified = state?.approved == true,
            )
        }

        val bank = draft.bank.accountHolder?.let { holder ->
            BankProfileProjection(
                accountHolder = holder,
                accountNumberMasked = draft.bank.accountNumber,
                ifscMasked = draft.bank.ifsc,
                bankName = draft.bank.bankName,
                verified = state?.approved == true,
            )
        }

        return CaptainProfileResponse(
            captainId = captain.actorId,
            mobile = identity.mobileE164,
            name = draft.personal.fullName,
            status = approvalStatus,
            approved = state?.approved == true,
            online = state?.online == true,
            busy = state?.busy == true,
            rejectionReason = draft.rejectionReason,
            joiningDate = draft.createdAt,
            city = draft.personal.city,
            vehicle = vehicle,
            bank = bank,
            lastLocationAt = state?.lastLocationAt,
        )
    }
}

data class CaptainOnboardingDraftResponse(
    val personal: OnboardingPersonalDetails?,
    val identity: OnboardingIdentityDetails?,
    val vehicle: OnboardingVehicleDetails?,
    val bank: OnboardingBankDetails?,
    val consent: OnboardingConsentDetails?,
    val stepCompleted: Int,
    val status: String,
)

data class CaptainOnboardingDraftRequest(
    val personal: OnboardingPersonalDetails? = null,
    val identity: OnboardingIdentityDetails? = null,
    val vehicle: OnboardingVehicleDetails? = null,
    val bank: OnboardingBankDetails? = null,
    val consent: OnboardingConsentDetails? = null,
    val stepCompleted: Int? = null,
)

data class CaptainOnboardingSubmitResponse(
    val success: Boolean,
    val status: String,
)

@RestController
@RequestMapping("/api/v1/captain/onboarding")
class CaptainOnboardingApiController(
    private val onboarding: CaptainOnboardingService,
) {
    @GetMapping("/draft")
    fun getDraft(authentication: Authentication): CaptainOnboardingDraftResponse {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val record = onboarding.getDraft(captain.actorId)
        return CaptainOnboardingDraftResponse(
            personal = record.personal,
            identity = record.identity,
            vehicle = record.vehicle,
            bank = record.bank,
            consent = record.consent,
            stepCompleted = record.stepCompleted,
            status = record.status.name,
        )
    }

    @PutMapping("/draft")
    fun saveDraft(
        authentication: Authentication,
        @RequestBody request: CaptainOnboardingDraftRequest,
    ): CaptainOnboardingDraftResponse {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val record = onboarding.saveDraft(
            captain.actorId,
            SaveOnboardingDraftCommand(
                personal = request.personal,
                identity = request.identity,
                vehicle = request.vehicle,
                bank = request.bank,
                consent = request.consent,
                stepCompleted = request.stepCompleted,
            ),
        )
        return CaptainOnboardingDraftResponse(
            personal = record.personal,
            identity = record.identity,
            vehicle = record.vehicle,
            bank = record.bank,
            consent = record.consent,
            stepCompleted = record.stepCompleted,
            status = record.status.name,
        )
    }

    @PostMapping("/submit")
    fun submit(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key", required = false) idempotencyKey: String?,
    ): CaptainOnboardingSubmitResponse {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val record = onboarding.submit(captain.actorId, idempotencyKey)
        return CaptainOnboardingSubmitResponse(
            success = true,
            status = record.status.name,
        )
    }
}

@RestController
@RequestMapping("/api/v1/captain")
class CaptainEarningsApiController(
    private val earnings: CaptainEarningsService,
) {
    @GetMapping("/earnings")
    fun getEarnings(authentication: Authentication): CaptainEarningsSummary {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        return earnings.getSummary(captain.actorId)
    }

    @GetMapping("/deliveries/history")
    fun getHistory(authentication: Authentication): List<CaptainDeliveryHistoryItem> {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        return earnings.getDeliveryHistory(captain.actorId)
    }
}

data class CaptainSupportTicketRequest(
    val category: String,
    val subject: String,
    val description: String,
    val jobId: UUID? = null,
    val orderReference: String? = null,
)

data class CaptainSupportTicketResponse(
    val ticketId: UUID,
    val status: String,
    val createdAt: Instant,
)

@RestController
@RequestMapping("/api/v1/captain/support")
class CaptainSupportApiController(
    private val support: CaptainSupportService,
) {
    @PostMapping("/tickets")
    fun createTicket(
        authentication: Authentication,
        @RequestBody request: CaptainSupportTicketRequest,
    ): CaptainSupportTicketResponse {
        val captain = authentication.domainPrincipal()
        Authorizer.requireRole(captain, Role.CAPTAIN)
        val ticket = support.createTicket(
            captain.actorId,
            CreateSupportTicketCommand(
                category = request.category,
                subject = request.subject,
                description = request.description,
                jobId = request.jobId,
                orderReference = request.orderReference,
            ),
        )
        return CaptainSupportTicketResponse(
            ticketId = ticket.id,
            status = ticket.status.name,
            createdAt = ticket.createdAt,
        )
    }
}

@RestController
@RequestMapping("/api/v1/admin/captains")
class CaptainApprovalApiController(
    private val dispatch: DispatchService,
    private val onboarding: CaptainOnboardingService,
) {
    @PostMapping("/{captainId}/approve")
    fun approve(authentication: Authentication, @PathVariable captainId: UUID): CaptainDeliveryState =
        authentication.domainPrincipal().let { admin ->
            Authorizer.requireAdminPermission(admin, AdminPermission.CAPTAIN_REVIEW)
            onboarding.approve(captainId)
            dispatch.approveCaptain(captainId)
        }
}

private fun unavailable(): Nothing = throw DomainException(
    "RESOURCE_NOT_FOUND",
    "The requested resource is unavailable",
)
