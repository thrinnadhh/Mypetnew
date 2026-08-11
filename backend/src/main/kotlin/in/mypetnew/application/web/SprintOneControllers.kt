package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.SafeRoute
import `in`.mypetnew.pos.domain.CustomerAssociationChallengeService
import `in`.mypetnew.pos.domain.PaymentDeclaration
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class SubmitOutletRequest(
    val name: String,
    val capabilities: Set<ProviderCapability>,
    val servicePinCodes: Set<String>,
)

@RestController
class ProviderApiController(private val providers: ProviderService) {
    @PostMapping("/api/v1/merchant/outlets")
    fun submit(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: SubmitOutletRequest,
    ) = providers.submitOutlet(
        authentication.domainPrincipal(),
        request.name,
        request.capabilities,
        request.servicePinCodes,
        idempotencyKey,
    )

    @PostMapping("/api/v1/admin/outlets/{outletId}/approve")
    fun approve(
        authentication: Authentication,
        @PathVariable outletId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
    ) = providers.approveOutlet(authentication.domainPrincipal(), outletId, idempotencyKey)
}

data class CreateListingRequest(
    val outletId: UUID,
    val barcodeType: BarcodeType,
    val barcode: String,
    val name: String,
    val kind: ListingKind,
    val mrpPaise: Long,
    val sellingPricePaise: Long,
)

@RestController
@RequestMapping("/api/v1/merchant")
class CatalogInventoryApiController(
    private val providers: ProviderService,
    private val catalog: CatalogService,
    private val inventory: InventoryService,
) {
    @PostMapping("/listings")
    fun createListing(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: CreateListingRequest,
    ): `in`.mypetnew.catalog.domain.Listing {
        val principal = authentication.domainPrincipal()
        val outlet = authorizedActiveOutlet(principal, request.outletId, providers)
        return catalog.createListing(
            CreateListingCommand(
                organizationId = outlet.organizationId,
                outletId = outlet.id,
                barcodeType = request.barcodeType,
                barcode = request.barcode,
                name = request.name,
                kind = request.kind,
                mrpPaise = request.mrpPaise,
                sellingPricePaise = request.sellingPricePaise,
                capabilities = outlet.capabilities,
            ),
            idempotencyKey,
        )
    }

    data class ReceiveStockRequest(val outletId: UUID, val listingId: UUID, val quantity: Int)

    @PostMapping("/inventory/receive")
    fun receive(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: ReceiveStockRequest,
    ): `in`.mypetnew.catalog.domain.StockMovement {
        val principal = authentication.domainPrincipal()
        authorizedActiveOutlet(principal, request.outletId, providers)
        val listing = catalog.getListing(request.listingId)
        if (listing.outletId != request.outletId) resourceUnavailable()
        if (request.quantity <= 0) throw DomainException("QUANTITY_INVALID", "Quantity must be positive")
        return inventory.adjust(listing.id, request.quantity, StockReason.RECEIPT, idempotencyKey)
    }
}

data class OrderLineRequest(val listingId: UUID, val quantity: Int)
data class PickupQuoteRequest(val outletId: UUID, val lines: List<OrderLineRequest>)
data class CheckoutRequest(val quoteId: UUID, val cartSignature: String)

@RestController
@RequestMapping("/api/v1/customer")
class CustomerCommerceApiController(
    private val providers: ProviderService,
    private val catalog: CatalogService,
    private val inventory: InventoryService,
    private val quotes: QuoteService,
    private val orders: OrderService,
    private val loyalty: LoyaltyService,
    private val associations: CustomerAssociationChallengeService,
    private val notifications: NotificationService,
) {
    @PostMapping("/quotes/pickup")
    fun quote(
        authentication: Authentication,
        @RequestBody request: PickupQuoteRequest,
    ): `in`.mypetnew.commerce.domain.Quote {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val outlet = providers.getOutlet(request.outletId)
        if (outlet.status != ProviderStatus.ACTIVE || !outlet.capabilities.contains(ProviderCapability.PRODUCT_STORE)) {
            resourceUnavailable()
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
        if (lines.size != request.lines.size) throw DomainException("CART_INVALID", "The cart contains duplicate lines")
        return quotes.createPickupQuote(customer.actorId, outlet.id, lines)
    }

    @PostMapping("/orders")
    fun checkout(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: CheckoutRequest,
    ): ProductOrder {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val quote = quotes.requireValid(request.quoteId, request.cartSignature)
        if (quote.customerId != customer.actorId) resourceUnavailable()
        val order = orders.checkout(
            customer.actorId,
            quote.outletId,
            quote.lines.mapValues { it.value.first },
            quote.pricing.grandTotalPaise,
            idempotencyKey,
        )
        val outlet = providers.getOutlet(order.outletId)
        notifications.enqueue(
            sourceEventId = order.id,
            recipientId = outlet.ownerActorId,
            templateVersion = "pickup-order-placed-v1",
            title = "New pickup order",
            body = "Open MyPet Merchant to review a new pickup order.",
            route = SafeRoute.MERCHANT_ORDER,
            resourceId = order.id,
        )
        return order
    }

    data class ChallengeRequest(val organizationId: UUID, val outletId: UUID)

    @PostMapping("/pos-association-challenges")
    fun associationChallenge(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: ChallengeRequest,
    ): `in`.mypetnew.pos.domain.CustomerAssociationChallenge {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        val outlet = providers.getOutlet(request.outletId)
        if (outlet.status != ProviderStatus.ACTIVE || outlet.organizationId != request.organizationId) resourceUnavailable()
        return associations.create(customer.actorId, request.organizationId, request.outletId, idempotencyKey)
    }

    data class LoyaltyResponse(val organizationId: UUID, val availableStars: Int, val rewards: Int)

    @GetMapping("/loyalty/{organizationId}")
    fun loyalty(authentication: Authentication, @PathVariable organizationId: UUID): LoyaltyResponse {
        val customer = authentication.domainPrincipal()
        Authorizer.requireRole(customer, Role.CUSTOMER)
        return LoyaltyResponse(
            organizationId,
            loyalty.balance(customer.actorId, organizationId),
            loyalty.rewards(customer.actorId, organizationId).size,
        )
    }
}

data class TransitionRequest(val target: OrderStatus)
data class PosSaleRequest(
    val outletId: UUID,
    val associationChallengeId: UUID?,
    val paymentDeclaration: PaymentDeclaration,
    val lines: List<OrderLineRequest>,
)

@RestController
@RequestMapping("/api/v1/merchant")
class MerchantCommerceApiController(
    private val providers: ProviderService,
    private val catalog: CatalogService,
    private val inventory: InventoryService,
    private val orders: OrderService,
    private val pos: PosService,
    private val associations: CustomerAssociationChallengeService,
    private val notifications: NotificationService,
) {
    @PostMapping("/orders/{orderId}/transitions")
    fun transition(
        authentication: Authentication,
        @PathVariable orderId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: TransitionRequest,
    ): ProductOrder {
        val principal = authentication.domainPrincipal()
        val order = authorizedOrder(principal, orderId)
        return orders.transition(order.id, request.target, idempotencyKey)
    }

    @GetMapping("/orders/{orderId}")
    fun get(authentication: Authentication, @PathVariable orderId: UUID): ProductOrder =
        authorizedOrder(authentication.domainPrincipal(), orderId)

    @PostMapping("/pos/sales")
    fun sale(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: PosSaleRequest,
    ): `in`.mypetnew.pos.domain.PosSale {
        val principal = authentication.domainPrincipal()
        val outlet = authorizedActiveOutlet(principal, request.outletId, providers)
        val customerId = request.associationChallengeId?.let {
            associations.consume(it, outlet.organizationId, outlet.id)
        }
        val lines = request.lines.associate { line ->
            val listing = catalog.getListing(line.listingId)
            if (
                listing.outletId != outlet.id ||
                listing.commerceMode != CommerceMode.COMMERCE ||
                inventory.available(listing.id) < line.quantity
            ) throw DomainException("LISTING_UNAVAILABLE", "A POS item is unavailable")
            listing.id to Pair(line.quantity, listing.sellingPricePaise)
        }
        if (lines.size != request.lines.size) throw DomainException("POS_LINE_INVALID", "The POS cart contains duplicate lines")
        val sale = pos.complete(
            outlet.organizationId,
            outlet.id,
            customerId,
            lines,
            request.paymentDeclaration,
            idempotencyKey,
        )
        if (sale.customerId != null && sale.loyaltyAwarded) {
            notifications.enqueue(
                sourceEventId = sale.id,
                recipientId = sale.customerId,
                templateVersion = "pos-star-v1",
                title = "You earned a loyalty star",
                body = "Open MyPet to view your merchant loyalty activity.",
                route = SafeRoute.CUSTOMER_LOYALTY,
                resourceId = outlet.organizationId,
            )
        }
        return sale
    }

    private fun authorizedOrder(principal: Principal, orderId: UUID): ProductOrder {
        val order = orders.get(orderId)
        Authorizer.requireOutlet(principal, order.outletId)
        return order
    }
}

internal fun Authentication.domainPrincipal(): Principal = principal as? Principal
    ?: throw DomainException("AUTHENTICATION_REQUIRED", "Authentication is required")

private fun authorizedActiveOutlet(
    principal: Principal,
    outletId: UUID,
    providers: ProviderService,
): `in`.mypetnew.provider.domain.ProviderOutlet {
    Authorizer.requireOutlet(principal, outletId)
    val outlet = providers.getOutlet(outletId)
    if (
        outlet.status != ProviderStatus.ACTIVE ||
        principal.organizationId == null ||
        outlet.organizationId != principal.organizationId
    ) resourceUnavailable()
    return outlet
}

private fun resourceUnavailable(): Nothing = throw DomainException(
    "RESOURCE_NOT_FOUND",
    "The requested resource is unavailable",
)
