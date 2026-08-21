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
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.engagement.domain.NotificationService
import `in`.mypetnew.engagement.domain.SafeRoute
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.pos.domain.CustomerAssociationChallengeService
import `in`.mypetnew.pos.domain.PaymentDeclaration
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.slf4j.MDC
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
    val category: String,
    val brand: String? = null,
    val description: String? = null,
    val petType: String? = null,
    val lifeStage: String? = null,
    val packLabel: String? = null,
    val sku: String? = null,
    val imageUrls: List<String>? = null,
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
        val outlet = providers.requireActiveOutlet(
            principal,
            request.outletId,
            MerchantPermission.CATALOG_WRITE,
        )
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
                category = request.category,
                brand = request.brand,
                description = request.description,
                petType = request.petType,
                lifeStage = request.lifeStage,
                packLabel = request.packLabel,
                sku = request.sku,
                imageUrls = request.imageUrls.orEmpty(),
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
        providers.requireActiveOutlet(
            principal,
            request.outletId,
            MerchantPermission.INVENTORY_WRITE,
        )
        val listing = catalog.getListing(request.listingId)
        if (listing.outletId != request.outletId) resourceUnavailable()
        if (request.quantity <= 0) throw DomainException("QUANTITY_INVALID", "Quantity must be positive")
        return inventory.adjust(
            listing.id,
            request.quantity,
            StockReason.RECEIPT,
            idempotencyKey,
            actorId = principal.actorId,
            traceId = currentTraceId(),
        )
    }
}

data class OrderLineRequest(val listingId: UUID, val quantity: Int)
data class PickupQuoteRequest(
    val outletId: UUID,
    val lines: List<OrderLineRequest>,
    val paymentMethod: String? = null,
)
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
        if (
            outlet.status != ProviderStatus.ACTIVE ||
            !outlet.pickupEnabled ||
            !outlet.capabilities.contains(ProviderCapability.PRODUCT_STORE)
        ) {
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
        return quotes.createPickupQuote(customer.actorId, outlet.id, lines, request.paymentMethod)
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

        val outlet = providers.getOutlet(quote.outletId)
        val fulfilmentAvailable = when (quote.fulfilmentMode) {
            "STORE_PICKUP" -> outlet.pickupEnabled
            DispatchService.DELIVERY_MODE -> {
                val address = quote.deliveryAddress
                address != null &&
                    address.pincode in outlet.servicePinCodes &&
                    outlet.latitude != null &&
                    outlet.longitude != null
            }
            else -> false
        }
        if (
            outlet.status != ProviderStatus.ACTIVE ||
            ProviderCapability.PRODUCT_STORE !in outlet.capabilities ||
            !fulfilmentAvailable
        ) {
            throw DomainException("QUOTE_STALE", "The provider changed after this quote was created")
        }
        val listingNames = quote.lines.map { (listingId, quotedLine) ->
            val listing = catalog.getListing(listingId)
            val (quantity, quotedUnitPrice) = quotedLine
            if (
                listing.outletId != outlet.id ||
                listing.commerceMode != CommerceMode.COMMERCE ||
                listing.sellingPricePaise != quotedUnitPrice ||
                inventory.available(listing.id) < quantity
            ) {
                throw DomainException("QUOTE_STALE", "A cart item changed after this quote was created")
            }
            listingId to listing.name
        }.toMap()

        val order = orders.checkout(
            quote = quote,
            organizationId = outlet.organizationId,
            listingNames = listingNames,
            idempotencyKey = idempotencyKey,
            actorId = customer.actorId,
            traceId = currentTraceId(),
        )
        val isDelivery = order.fulfilmentMode == DispatchService.DELIVERY_MODE
        notifications.enqueue(
            sourceEventId = order.id,
            recipientId = outlet.ownerActorId,
            templateVersion = if (isDelivery) "delivery-order-placed-v1" else "pickup-order-placed-v1",
            title = if (isDelivery) "New delivery order" else "New pickup order",
            body = if (isDelivery) {
                "Open MyPet Merchant to review a new Captain-delivery order."
            } else {
                "Open MyPet Merchant to review a new pickup order."
            },
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

data class TransitionRequest(val target: OrderStatus, val reason: String? = null)
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
    private val dispatch: DispatchService,
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
        providers.requireActiveOutlet(principal, order.outletId, MerchantPermission.ORDER_FULFIL)
        val updated = orders.transition(
            orderId = order.id,
            target = request.target,
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            actorRole = principal.role,
            reason = request.reason,
            traceId = currentTraceId(),
        )
        if (
            updated.fulfilmentMode == DispatchService.DELIVERY_MODE &&
            request.target == OrderStatus.READY_FOR_PICKUP
        ) {
            val outlet = providers.getOutlet(updated.outletId)
            val latitude = outlet.latitude
                ?: throw DomainException("DELIVERY_DISPATCH_ORIGIN_REQUIRED", "The outlet dispatch origin is unavailable")
            val longitude = outlet.longitude
                ?: throw DomainException("DELIVERY_DISPATCH_ORIGIN_REQUIRED", "The outlet dispatch origin is unavailable")
            dispatch.start(updated, latitude, longitude)
        }
        return updated
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
        val outlet = providers.requireActiveOutlet(
            principal,
            request.outletId,
            MerchantPermission.POS_OPERATE,
        )
        val customerId = request.associationChallengeId?.let {
            associations.consume(it, outlet.organizationId, outlet.id)
        }
        val listingNames = mutableMapOf<UUID, String>()
        val lines = request.lines.associate { line ->
            val listing = catalog.getListing(line.listingId)
            if (
                listing.outletId != outlet.id ||
                listing.commerceMode != CommerceMode.COMMERCE ||
                line.quantity <= 0 ||
                inventory.available(listing.id) < line.quantity
            ) throw DomainException("LISTING_UNAVAILABLE", "A POS item is unavailable")
            listingNames[listing.id] = listing.name
            listing.id to Pair(line.quantity, listing.sellingPricePaise)
        }
        if (lines.size != request.lines.size) throw DomainException("POS_LINE_INVALID", "The POS cart contains duplicate lines")
        val sale = pos.complete(
            merchantId = outlet.organizationId,
            outletId = outlet.id,
            customerId = customerId,
            lines = lines,
            payment = request.paymentDeclaration,
            idempotencyKey = idempotencyKey,
            listingNames = listingNames,
            cashierId = principal.actorId,
            traceId = currentTraceId(),
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

private fun currentTraceId(): String = MDC.get("traceId") ?: InventoryService.SYSTEM_TRACE_ID

private fun resourceUnavailable(): Nothing = throw DomainException(
    "RESOURCE_NOT_FOUND",
    "The requested resource is unavailable",
)
