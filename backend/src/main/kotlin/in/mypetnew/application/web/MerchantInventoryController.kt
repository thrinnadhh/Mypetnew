package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CountLineInput
import `in`.mypetnew.catalog.domain.CountReconciliationResult
import `in`.mypetnew.catalog.domain.InventoryBalance
import `in`.mypetnew.catalog.domain.InventoryCountSession
import `in`.mypetnew.catalog.domain.InventoryDamageInput
import `in`.mypetnew.catalog.domain.InventoryExpiryInput
import `in`.mypetnew.catalog.domain.InventoryHistoryPage
import `in`.mypetnew.catalog.domain.InventoryReceivingInput
import `in`.mypetnew.catalog.domain.InventoryReturnInput
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.InventoryShrinkageInput
import `in`.mypetnew.catalog.domain.ReturnType
import `in`.mypetnew.catalog.domain.StockMovement
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.TransferRequest
import `in`.mypetnew.catalog.domain.TransferResult
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderService
import org.slf4j.MDC
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
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

data class ReceivingRequest(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val referenceType: String? = null,
    val referenceId: String? = null,
    val batchNumber: String? = null,
    val expiryDate: String? = null,
)

data class DamageRequest(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val reasonDetails: String? = null,
    val referenceId: String? = null,
)

data class ExpiryRequest(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val batchReference: String? = null,
    val expiryDate: String? = null,
)

data class ShrinkageRequest(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val notes: String? = null,
    val referenceId: String? = null,
)

data class ReturnRequest(
    val outletId: UUID,
    val listingId: UUID,
    val quantity: Int,
    val returnType: ReturnType,
    val referenceType: String? = null,
    val referenceId: String? = null,
)

data class TransferApiRequest(
    val sourceOutletId: UUID,
    val destinationOutletId: UUID,
    val sourceListingId: UUID,
    val destinationListingId: UUID? = null,
    val quantity: Int,
)

data class StartCountRequest(
    val outletId: UUID,
    val initialCutoffSequence: Long? = null,
)

data class UpdateCountLinesRequest(
    val outletId: UUID,
    val lines: List<CountLineInput>,
)

data class SubmitCountRequest(
    val outletId: UUID,
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
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: InventoryAdjustmentRequest,
    ): StockMovement {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_ADJUSTMENT")
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

    @PostMapping("/receiving")
    fun receive(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: ReceivingRequest,
    ): StockMovement {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_RECEIVING")
        val principal = authentication.domainPrincipal()
        val scope = requireInventoryScope(principal.actorId, request.outletId, request.listingId, authentication)
        return inventory.receive(
            scope = scope,
            input = InventoryReceivingInput(
                outletId = request.outletId,
                listingId = request.listingId,
                quantity = request.quantity,
                referenceType = request.referenceType,
                referenceId = request.referenceId,
                batchNumber = request.batchNumber,
                expiryDate = request.expiryDate,
            ),
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
        )
    }

    @PostMapping("/damage")
    fun damage(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: DamageRequest,
    ): StockMovement {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_DAMAGE")
        val principal = authentication.domainPrincipal()
        val scope = requireInventoryScope(principal.actorId, request.outletId, request.listingId, authentication)
        return inventory.damage(
            scope = scope,
            input = InventoryDamageInput(
                outletId = request.outletId,
                listingId = request.listingId,
                quantity = request.quantity,
                reasonDetails = request.reasonDetails,
                referenceId = request.referenceId,
            ),
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
        )
    }

    @PostMapping("/expiry")
    fun expire(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: ExpiryRequest,
    ): StockMovement {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_EXPIRY")
        val principal = authentication.domainPrincipal()
        val scope = requireInventoryScope(principal.actorId, request.outletId, request.listingId, authentication)
        return inventory.expire(
            scope = scope,
            input = InventoryExpiryInput(
                outletId = request.outletId,
                listingId = request.listingId,
                quantity = request.quantity,
                batchReference = request.batchReference,
                expiryDate = request.expiryDate,
            ),
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
        )
    }

    @PostMapping("/shrinkage")
    fun shrink(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: ShrinkageRequest,
    ): StockMovement {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_SHRINKAGE")
        val principal = authentication.domainPrincipal()
        val scope = requireInventoryScope(principal.actorId, request.outletId, request.listingId, authentication)
        return inventory.shrink(
            scope = scope,
            input = InventoryShrinkageInput(
                outletId = request.outletId,
                listingId = request.listingId,
                quantity = request.quantity,
                notes = request.notes,
                referenceId = request.referenceId,
            ),
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
        )
    }

    @PostMapping("/returns")
    fun returnStock(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: ReturnRequest,
    ): StockMovement {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_RETURN")
        val principal = authentication.domainPrincipal()
        val scope = requireInventoryScope(principal.actorId, request.outletId, request.listingId, authentication)
        return inventory.returnStock(
            scope = scope,
            input = InventoryReturnInput(
                outletId = request.outletId,
                listingId = request.listingId,
                quantity = request.quantity,
                returnType = request.returnType,
                referenceType = request.referenceType,
                referenceId = request.referenceId,
            ),
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
        )
    }

    @PostMapping("/transfers")
    fun transfer(
        authentication: Authentication,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: TransferApiRequest,
    ): TransferResult {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_TRANSFER")
        val principal = authentication.domainPrincipal()
        val sourceOutlet = providers.requireActiveOutlet(principal, request.sourceOutletId, MerchantPermission.INVENTORY_WRITE)
        val destOutlet = providers.requireActiveOutlet(principal, request.destinationOutletId, MerchantPermission.INVENTORY_WRITE)
        if (sourceOutlet.organizationId != destOutlet.organizationId) {
            throw DomainException("INVALID_TRANSFER", "Transfers across distinct merchant organizations are forbidden")
        }
        catalog.getManagedListing(sourceOutlet.organizationId, sourceOutlet.id, request.sourceListingId)
        if (request.destinationListingId != null) {
            catalog.getManagedListing(destOutlet.organizationId, destOutlet.id, request.destinationListingId)
        }

        return inventory.transfer(
            organizationId = sourceOutlet.organizationId,
            request = TransferRequest(
                sourceOutletId = request.sourceOutletId,
                destinationOutletId = request.destinationOutletId,
                sourceListingId = request.sourceListingId,
                destinationListingId = request.destinationListingId,
                quantity = request.quantity,
            ),
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
        )
    }

    @PostMapping("/counts")
    fun startCount(
        authentication: Authentication,
        @RequestBody request: StartCountRequest,
    ): InventoryCountSession {
        val principal = authentication.domainPrincipal()
        val outlet = providers.requireActiveOutlet(principal, request.outletId, MerchantPermission.INVENTORY_WRITE)
        return inventory.startCountSession(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
            initialCutoffSequence = request.initialCutoffSequence,
        )
    }

    @GetMapping("/counts/{sessionId}")
    fun getCount(
        authentication: Authentication,
        @PathVariable sessionId: UUID,
        @RequestParam outletId: UUID,
    ): InventoryCountSession {
        val principal = authentication.domainPrincipal()
        val outlet = providers.requireActiveOutlet(principal, outletId, MerchantPermission.INVENTORY_WRITE)
        return inventory.getCountSession(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            sessionId = sessionId,
        )
    }

    @PutMapping("/counts/{sessionId}/lines")
    fun updateCountLines(
        authentication: Authentication,
        @PathVariable sessionId: UUID,
        @RequestBody request: UpdateCountLinesRequest,
    ): InventoryCountSession {
        val principal = authentication.domainPrincipal()
        val outlet = providers.requireActiveOutlet(principal, request.outletId, MerchantPermission.INVENTORY_WRITE)
        request.lines.forEach { line ->
            catalog.getManagedListing(outlet.organizationId, outlet.id, line.listingId)
        }
        return inventory.updateCountLines(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            sessionId = sessionId,
            lines = request.lines,
        )
    }

    @PostMapping("/counts/{sessionId}/submit")
    fun submitCount(
        authentication: Authentication,
        @PathVariable sessionId: UUID,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @RequestHeader(name = "X-MyPet-Command-Type", required = false) commandTypeHeader: String?,
        @RequestHeader(name = "X-MyPet-Payload-Schema-Version", required = false) schemaVersionHeader: String?,
        @RequestBody request: SubmitCountRequest,
    ): CountReconciliationResult {
        validateSyncHeaders(commandTypeHeader, schemaVersionHeader, "INVENTORY_COUNT_SUBMIT")
        val principal = authentication.domainPrincipal()
        val outlet = providers.requireActiveOutlet(principal, request.outletId, MerchantPermission.INVENTORY_WRITE)
        return inventory.submitCountSession(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            sessionId = sessionId,
            idempotencyKey = idempotencyKey,
            actorId = principal.actorId,
            traceId = currentInventoryTraceId(),
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
        check(actorId == principal.actorId)
        val outlet = providers.requireActiveOutlet(principal, outletId, MerchantPermission.INVENTORY_WRITE)
        catalog.getManagedListing(outlet.organizationId, outlet.id, listingId)
        return InventoryScope(outlet.organizationId, outlet.id, listingId)
    }

    private fun validateSyncHeaders(commandTypeHeader: String?, schemaVersionHeader: String?, expectedType: String) {
        val hasType = commandTypeHeader != null
        val hasVersion = schemaVersionHeader != null
        if (hasType xor hasVersion) {
            throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Both sync headers must be present together")
        }
        if (hasType) {
            if (commandTypeHeader != expectedType) {
                throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Endpoint accepts $expectedType, received $commandTypeHeader")
            }
            if (schemaVersionHeader != "1") {
                throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Unsupported payload schema version $schemaVersionHeader")
            }
        }
    }

    private fun currentInventoryTraceId(): String =
        (MDC.get("traceId") ?: MDC.get("trace_id") ?: "merchant-inventory").take(64)
}
