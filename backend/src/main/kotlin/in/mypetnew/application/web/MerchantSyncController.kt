package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.MerchantSyncBootstrapResponse
import `in`.mypetnew.catalog.domain.MerchantSyncChangePage
import `in`.mypetnew.catalog.domain.MerchantSyncFeedService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.MessageDigest
import java.util.UUID

data class ResolveReceiptRequest(
    val idempotencyKey: String,
    val commandType: String,
    val payloadSchemaVersion: Int,
    val payload: Map<String, Any?>,
)

data class ResolveReceiptResponse(
    val status: String = "ACCEPTED",
    val receiptId: String,
    val commandType: String,
    val entityId: UUID,
    val resultingOnHand: Int? = null,
    val resultingReserved: Int? = null,
    val resultingVersion: Long? = null,
    val serverTimestamp: String,
)

@RestController
@RequestMapping("/api/v1/merchant/sync")
class MerchantSyncController(
    private val providers: ProviderService,
    private val feedService: MerchantSyncFeedService,
    private val jdbc: JdbcTemplate,
) {

    @GetMapping("/changes")
    fun changes(
        authentication: Authentication,
        @RequestParam outletId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(defaultValue = "100") limit: Int,
    ): MerchantSyncChangePage {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val outlet = requireOutletAccess(principal, outletId)
        return feedService.fetchChanges(outlet.organizationId, outlet.id, cursor, limit)
    }

    @GetMapping("/bootstrap")
    fun bootstrap(
        authentication: Authentication,
        @RequestParam outletId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(defaultValue = "100") limit: Int,
    ): MerchantSyncBootstrapResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val outlet = requireOutletAccess(principal, outletId)
        return feedService.fetchBootstrap(outlet.organizationId, outlet.id, cursor, limit)
    }

    @PostMapping("/receipts/resolve")
    fun resolveReceipt(
        authentication: Authentication,
        @RequestBody request: ResolveReceiptRequest,
    ): ResolveReceiptResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val actorId = principal.actorId

        if (request.payloadSchemaVersion != 1) {
            throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Unsupported payload schema version ${request.payloadSchemaVersion}")
        }

        return when (request.commandType) {
            "INVENTORY_ADJUSTMENT" -> resolveInventoryReceipt(principal, actorId, request)
            "CATALOG_UPDATE" -> resolveCatalogUpdateReceipt(principal, actorId, request)
            "CATALOG_ACTIVATE", "CATALOG_DEACTIVATE" -> resolveCatalogLifecycleReceipt(principal, actorId, request)
            else -> throw DomainException("COMMAND_SCHEMA_UNSUPPORTED", "Unsupported command type ${request.commandType}")
        }
    }

    private fun resolveInventoryReceipt(
        principal: Principal,
        actorId: UUID,
        request: ResolveReceiptRequest,
    ): ResolveReceiptResponse {
        val payload = request.payload
        val outletId = UUID.fromString(payload["outletId"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing outletId"))
        val listingId = UUID.fromString(payload["listingId"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing listingId"))
        val delta = (payload["quantityDelta"] as? Number)?.toInt() ?: throw DomainException("VALIDATION_ERROR", "Missing quantityDelta")
        val reasonStr = payload["reason"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing reason")
        val reason = try { StockReason.valueOf(reasonStr) } catch (_: Exception) { throw DomainException("VALIDATION_ERROR", "Invalid reason") }

        val row = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, listing_id, actor_id, idempotency_key,
                   operation_scope, request_fingerprint, movement_id, resulting_on_hand,
                   resulting_reserved, created_at
            FROM mypet.inventory_command_receipt
            WHERE actor_id = ? AND idempotency_key = ? AND outlet_id = ? AND listing_id = ?
            """.trimIndent(),
            { rs, _ ->
                object {
                    val orgId = rs.getObject("organization_id", UUID::class.java)
                    val outId = rs.getObject("outlet_id", UUID::class.java)
                    val listId = rs.getObject("listing_id", UUID::class.java)
                    val actId = rs.getObject("actor_id", UUID::class.java)
                    val opScope = rs.getString("operation_scope")
                    val storedFp = rs.getString("request_fingerprint")
                    val movementId = rs.getObject("movement_id", UUID::class.java)
                    val onHand = rs.getInt("resulting_on_hand")
                    val reserved = rs.getInt("resulting_reserved")
                    val createdAt = rs.getTimestamp("created_at")
                }
            },
            actorId,
            request.idempotencyKey,
            outletId,
            listingId,
        ).firstOrNull() ?: throw DomainException("RESOURCE_NOT_FOUND", "No receipt found for idempotency key")

        if (row.orgId == null || row.outId != outletId || row.listId != listingId || row.actId != actorId || row.opScope != "merchant-adjust") {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Stored receipt metadata mismatch")
        }

        val referenceType = payload["referenceType"] as? String
        val referenceId = payload["referenceId"] as? String

        // Canonical fingerprint comparison
        val expectedFp = InventoryService.computeFingerprint(
            row.orgId,
            outletId,
            listingId,
            delta,
            reason.name,
            referenceType,
            referenceId,
        )
        if (!MessageDigest.isEqual(row.storedFp.toByteArray(Charsets.UTF_8), expectedFp.toByteArray(Charsets.UTF_8))) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Payload does not match historical receipt")
        }

        return ResolveReceiptResponse(
            status = "ACCEPTED",
            receiptId = row.movementId.toString(),
            commandType = "INVENTORY_ADJUSTMENT",
            entityId = listingId,
            resultingOnHand = row.onHand,
            resultingReserved = row.reserved,
            serverTimestamp = row.createdAt.toInstant().toString(),
        )
    }

    private fun resolveCatalogUpdateReceipt(
        principal: Principal,
        actorId: UUID,
        request: ResolveReceiptRequest,
    ): ResolveReceiptResponse {
        val payload = request.payload
        val outletId = UUID.fromString(payload["outletId"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing outletId"))
        val listingId = UUID.fromString(payload["listingId"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing listingId"))
        val expectedVersion = (payload["expectedVersion"] as? Number)?.toLong() ?: throw DomainException("VALIDATION_ERROR", "Missing expectedVersion")
        val name = (payload["name"] as? String)?.trim() ?: throw DomainException("VALIDATION_ERROR", "Missing name")
        val mrpPaise = (payload["mrpPaise"] as? Number)?.toLong() ?: throw DomainException("VALIDATION_ERROR", "Missing mrpPaise")
        val sellingPricePaise = (payload["sellingPricePaise"] as? Number)?.toLong() ?: throw DomainException("VALIDATION_ERROR", "Missing sellingPricePaise")
        val category = (payload["category"] as? String)?.trim()?.lowercase() ?: throw DomainException("VALIDATION_ERROR", "Missing category")
        val brand = (payload["brand"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val description = (payload["description"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val petType = (payload["petType"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val lifeStage = (payload["lifeStage"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val packLabel = (payload["packLabel"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val sku = (payload["sku"] as? String)?.trim()?.takeIf { it.isNotEmpty() }

        val row = jdbc.query(
            """
            SELECT r.id, r.outlet_id, r.listing_id, r.idempotency_key, r.request_fingerprint,
                   r.mutation_type, r.resulting_version, r.created_at,
                   h.organization_id, h.actor_id
            FROM mypet.catalog_mutation_receipt r
            LEFT JOIN mypet.catalog_listing_history h
              ON h.listing_id = r.listing_id AND h.listing_version = r.resulting_version AND h.mutation_type = r.mutation_type
            WHERE r.outlet_id = ? AND r.idempotency_key = ? AND r.listing_id = ?
            """.trimIndent(),
            { rs, _ ->
                object {
                    val id = rs.getObject("id", UUID::class.java)
                    val outId = rs.getObject("outlet_id", UUID::class.java)
                    val listId = rs.getObject("listing_id", UUID::class.java)
                    val storedFp = rs.getString("request_fingerprint")
                    val mutType = rs.getString("mutation_type")
                    val version = rs.getLong("resulting_version")
                    val orgId = rs.getObject("organization_id", UUID::class.java)
                    val histActorId = rs.getObject("actor_id", UUID::class.java)
                    val createdAt = rs.getTimestamp("created_at")
                }
            },
            outletId,
            request.idempotencyKey,
            listingId,
        ).firstOrNull() ?: throw DomainException("RESOURCE_NOT_FOUND", "No receipt found for idempotency key")

        if (row.histActorId == null) {
            throw DomainException("PERMISSION_DENIED", "Historical actor record missing")
        }
        if (row.histActorId != actorId) {
            throw DomainException("PERMISSION_DENIED", "Historical actor mismatch")
        }
        if (row.listId != listingId || row.mutType != "UPDATE") {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Target listing or mutation type mismatch")
        }
        if (row.orgId == null) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Historical organization record missing")
        }

        val orgIdStr = row.orgId.toString()
        val expectedFp = CatalogService.computeUpdateFingerprint(
            orgIdStr, outletId.toString(), listingId.toString(),
            expectedVersion.toString(), name, mrpPaise.toString(),
            sellingPricePaise.toString(), category, brand, description,
            petType, lifeStage, packLabel, sku,
        )

        if (!MessageDigest.isEqual(row.storedFp.toByteArray(Charsets.UTF_8), expectedFp.toByteArray(Charsets.UTF_8))) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Payload does not match historical receipt")
        }

        return ResolveReceiptResponse(
            status = "ACCEPTED",
            receiptId = row.id.toString(),
            commandType = "CATALOG_UPDATE",
            entityId = listingId,
            resultingVersion = row.version,
            serverTimestamp = row.createdAt.toInstant().toString(),
        )
    }

    private fun resolveCatalogLifecycleReceipt(
        principal: Principal,
        actorId: UUID,
        request: ResolveReceiptRequest,
    ): ResolveReceiptResponse {
        val payload = request.payload
        val outletId = UUID.fromString(payload["outletId"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing outletId"))
        val listingId = UUID.fromString(payload["listingId"] as? String ?: throw DomainException("VALIDATION_ERROR", "Missing listingId"))
        val expectedVersion = (payload["expectedVersion"] as? Number)?.toLong() ?: throw DomainException("VALIDATION_ERROR", "Missing expectedVersion")
        val expectedMutation = if (request.commandType == "CATALOG_ACTIVATE") "ACTIVATE" else "DEACTIVATE"
        val targetStatus = if (request.commandType == "CATALOG_ACTIVATE") "ACTIVE" else "INACTIVE"

        val row = jdbc.query(
            """
            SELECT r.id, r.outlet_id, r.listing_id, r.idempotency_key, r.request_fingerprint,
                   r.mutation_type, r.resulting_version, r.created_at,
                   h.organization_id, h.actor_id
            FROM mypet.catalog_mutation_receipt r
            LEFT JOIN mypet.catalog_listing_history h
              ON h.listing_id = r.listing_id AND h.listing_version = r.resulting_version AND h.mutation_type = r.mutation_type
            WHERE r.outlet_id = ? AND r.idempotency_key = ? AND r.listing_id = ?
            """.trimIndent(),
            { rs, _ ->
                object {
                    val id = rs.getObject("id", UUID::class.java)
                    val outId = rs.getObject("outlet_id", UUID::class.java)
                    val listId = rs.getObject("listing_id", UUID::class.java)
                    val storedFp = rs.getString("request_fingerprint")
                    val mutType = rs.getString("mutation_type")
                    val version = rs.getLong("resulting_version")
                    val orgId = rs.getObject("organization_id", UUID::class.java)
                    val histActorId = rs.getObject("actor_id", UUID::class.java)
                    val createdAt = rs.getTimestamp("created_at")
                }
            },
            outletId,
            request.idempotencyKey,
            listingId,
        ).firstOrNull() ?: throw DomainException("RESOURCE_NOT_FOUND", "No receipt found for idempotency key")

        if (row.histActorId == null) {
            throw DomainException("PERMISSION_DENIED", "Historical actor record missing")
        }
        if (row.histActorId != actorId) {
            throw DomainException("PERMISSION_DENIED", "Historical actor mismatch")
        }
        if (row.listId != listingId || row.mutType != expectedMutation) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Target listing or mutation type mismatch")
        }
        if (row.orgId == null) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Historical organization record missing")
        }

        val orgIdStr = row.orgId.toString()
        val expectedFp = CatalogService.computeLifecycleFingerprint(
            orgIdStr, outletId.toString(), listingId.toString(),
            expectedVersion.toString(), targetStatus,
        )

        if (!MessageDigest.isEqual(row.storedFp.toByteArray(Charsets.UTF_8), expectedFp.toByteArray(Charsets.UTF_8))) {
            throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "Payload does not match historical receipt")
        }

        return ResolveReceiptResponse(
            status = "ACCEPTED",
            receiptId = row.id.toString(),
            commandType = request.commandType,
            entityId = listingId,
            resultingVersion = row.version,
            serverTimestamp = row.createdAt.toInstant().toString(),
        )
    }

    private fun requireOutletAccess(principal: Principal, outletId: UUID): ProviderOutlet {
        Authorizer.requireOutlet(principal, outletId)
        val outlet = providers.getOutlet(outletId)
        if (
            principal.organizationId == null ||
            outlet.organizationId != principal.organizationId ||
            outlet.status == ProviderStatus.SUSPENDED ||
            outlet.status == ProviderStatus.REJECTED
        ) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
        return outlet
    }
}
