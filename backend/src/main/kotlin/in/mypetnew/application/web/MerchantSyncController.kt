package `in`.mypetnew.application.web

import `in`.mypetnew.catalog.domain.MerchantSyncBootstrapResponse
import `in`.mypetnew.catalog.domain.MerchantSyncChangePage
import `in`.mypetnew.catalog.domain.MerchantSyncFeedService
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
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class SyncReceiptResponse(
    val idempotencyKey: String,
    val commandType: String,
    val entityType: String,
    val entityId: UUID,
    val resultingOnHand: Int? = null,
    val resultingVersion: Long? = null,
    val movementId: UUID? = null,
    val status: String = "ACCEPTED",
    val createdAt: String,
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
    ): MerchantSyncBootstrapResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val outlet = requireOutletAccess(principal, outletId)
        return feedService.fetchBootstrap(outlet.organizationId, outlet.id)
    }

    @GetMapping("/receipts/{idempotencyKey}")
    fun receipt(
        authentication: Authentication,
        @PathVariable idempotencyKey: String,
        @RequestParam outletId: UUID,
    ): SyncReceiptResponse {
        val principal = authentication.domainPrincipal()
        Authorizer.requireRole(principal, Role.MERCHANT)
        val orgId = principal.organizationId ?: throw DomainException("PERMISSION_DENIED", "No organization scope")

        // 1. Check inventory receipts
        val invReceipt = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, listing_id, actor_id, idempotency_key,
                   movement_id, resulting_on_hand, created_at
            FROM mypet.inventory_command_receipt
            WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?
            """.trimIndent(),
            { rs, _ ->
                SyncReceiptResponse(
                    idempotencyKey = idempotencyKey,
                    commandType = "INVENTORY_ADJUSTMENT",
                    entityType = "INVENTORY_BALANCE",
                    entityId = rs.getObject("listing_id", UUID::class.java),
                    resultingOnHand = rs.getInt("resulting_on_hand"),
                    movementId = rs.getObject("movement_id", UUID::class.java),
                    status = "ACCEPTED",
                    createdAt = rs.getTimestamp("created_at").toInstant().toString(),
                )
            },
            orgId,
            principal.actorId,
            idempotencyKey,
        ).firstOrNull()

        if (invReceipt != null) {
            return invReceipt
        }

        // 2. Check catalog receipts
        val catReceipt = jdbc.query(
            """
            SELECT r.id, r.outlet_id, r.listing_id, r.idempotency_key, r.mutation_type,
                   r.resulting_version, r.created_at
            FROM mypet.catalog_mutation_receipt r
            JOIN mypet.provider_outlet o ON o.id = r.outlet_id
            WHERE o.organization_id = ? AND r.outlet_id = ? AND r.idempotency_key = ?
            """.trimIndent(),
            { rs, _ ->
                val mutType = rs.getString("mutation_type")
                val cmdType = when (mutType) {
                    "ACTIVATE" -> "CATALOG_ACTIVATE"
                    "DEACTIVATE" -> "CATALOG_DEACTIVATE"
                    else -> "CATALOG_UPDATE"
                }
                SyncReceiptResponse(
                    idempotencyKey = idempotencyKey,
                    commandType = cmdType,
                    entityType = "CATALOG_ITEM",
                    entityId = rs.getObject("listing_id", UUID::class.java),
                    resultingVersion = rs.getLong("resulting_version"),
                    status = "ACCEPTED",
                    createdAt = rs.getTimestamp("created_at").toInstant().toString(),
                )
            },
            orgId,
            outletId,
            idempotencyKey,
        ).firstOrNull()

        if (catReceipt != null) {
            return catReceipt
        }

        throw DomainException("RESOURCE_NOT_FOUND", "No receipt found for idempotency key")
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
