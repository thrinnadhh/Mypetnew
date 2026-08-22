package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryBalance
import `in`.mypetnew.catalog.domain.InventoryHistoryPage
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockMovement
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.provider.domain.ProviderService
import org.slf4j.MDC
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class InventoryAdjustmentRequest(
    val outletId: UUID,
    val listingId: UUID,
    val quantityDelta: Int,
    val reason: StockReason,
    val referenceType: String? = null,
    val referenceId: String? = null,
)

@RestController
@RequestMapping("/api/v1/merchant/inventory")
class MerchantInventoryController(
    private val providers: ProviderService,
    private val catalog: CatalogService,
    private val inventory: InventoryService,
) {
    @PostMapping("/adjustments")
    fun adjust(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestBody request: InventoryAdjustmentRequest,
    ): StockMovement {
        val principal = authentication.domainPrincipal()
        val scope = requireInventoryScope(principal.actorId, request.outletId, request.listingId, authentication)
        return inventory.adjustMerchant(
            scope = scope,
            delta = request.quantityDelta,
            reason = request.reason,
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
            referenceType = request.referenceType,
            referenceId = request.referenceId,
        )
    }

    @GetMapping("/balance")
    fun balance(
        authentication: Authentication,
        @RequestParam outletId: UUID,
        @RequestParam listingId: UUID,
    ): InventoryBalance = inventory.balance(requireInventoryScope(authentication.domainPrincipal().actorId, outletId, listingId, authentication))

    @GetMapping("/movements")
    fun movements(
        authentication: Authentication,
        @RequestParam outletId: UUID,
        @RequestParam listingId: UUID,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "25") pageSize: Int,
    ): InventoryHistoryPage = inventory.history(
        requireInventoryScope(authentication.domainPrincipal().actorId, outletId, listingId, authentication),
        page,
        pageSize,
    )

    private fun requireInventoryScope(
        actorId: UUID,
        outletId: UUID,
        listingId: UUID,
        authentication: Authentication,
    ): InventoryScope {
        val principal = authentication.domainPrincipal()
        // Actor identity is intentionally re-read from the authenticated principal. The request never
        // supplies actor or organization authority; outletId is only a target checked by M1 authority.
        check(actorId == principal.actorId)
        val outlet = providers.requireActiveOutlet(principal, outletId, MerchantPermission.INVENTORY_WRITE)
        catalog.getManagedListing(outlet.organizationId, outlet.id, listingId)
        return InventoryScope(outlet.organizationId, outlet.id, listingId)
    }

    private fun currentInventoryTraceId(): String =
        (MDC.get("traceId") ?: MDC.get("trace_id") ?: "merchant-inventory").take(64)
}
