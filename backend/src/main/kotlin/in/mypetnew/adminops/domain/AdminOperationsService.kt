package `in`.mypetnew.adminops.domain

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID

const val M12_ADMIN_MAX_PAGE_SIZE = 100
const val M12_ADMIN_MAX_PAGE = 10_000

enum class AdminOperationPurpose {
    PROVIDER_REVIEW,
    INVENTORY_INVESTIGATION,
    AUDIT_REVIEW,
}

data class AdminInventoryItem(
    val listingId: UUID,
    val name: String,
    val active: Boolean,
    val onHand: Int,
    val reserved: Int,
    val available: Int,
    val version: Long,
    val updatedAt: Instant,
)

data class AdminInventoryPage(
    val organizationId: UUID,
    val outletId: UUID,
    val items: List<AdminInventoryItem>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

data class AdminAuditRecord(
    val id: UUID,
    val actorId: UUID,
    val action: String,
    val targetType: String,
    val targetId: UUID,
    val reason: String,
    val source: String,
    val idempotencyKey: String?,
    val traceId: String,
    val occurredAt: Instant,
)

data class AdminAuditPage(
    val organizationId: UUID,
    val outletId: UUID,
    val items: List<AdminAuditRecord>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

data class AdminAuditCommand(
    val actorId: UUID,
    val action: String,
    val targetType: String,
    val targetId: UUID,
    val reason: String,
    val source: String,
    val idempotencyKey: String?,
    val traceId: String,
)

interface AdminOperationsPersistence {
    fun inventory(organizationId: UUID, outletId: UUID, page: Int, pageSize: Int): AdminInventoryPage
    fun appendAudit(command: AdminAuditCommand): AdminAuditRecord
    fun auditTrail(organizationId: UUID, outletId: UUID, page: Int, pageSize: Int): AdminAuditPage
}

@Service
class AdminOperationsService(
    private val persistence: AdminOperationsPersistence,
    private val providers: ProviderService,
    transactionManager: PlatformTransactionManager,
) {
    private val transactions = TransactionTemplate(transactionManager)

    fun approveOutlet(
        admin: Principal,
        outletId: UUID,
        purpose: AdminOperationPurpose,
        reason: String,
        idempotencyKey: String,
        traceId: String,
    ): ProviderOutlet = requiredTransaction {
        Authorizer.requireAdminPermission(admin, AdminPermission.PROVIDER_REVIEW)
        val normalizedReason = validateContext(purpose, AdminOperationPurpose.PROVIDER_REVIEW, reason, traceId)
        val outlet = providers.getOutlet(outletId)
        val approved = providers.approveOutlet(admin, outlet.id, idempotencyKey)
        persistence.appendAudit(
            AdminAuditCommand(
                actorId = admin.actorId,
                action = "ADMIN_PROVIDER_OUTLET_APPROVED",
                targetType = "PROVIDER_OUTLET",
                targetId = outlet.id,
                reason = normalizedReason,
                source = sourceFor(purpose),
                idempotencyKey = idempotencyKey,
                traceId = traceId,
            ),
        )
        approved
    }

    fun inventory(
        admin: Principal,
        organizationId: UUID,
        outletId: UUID,
        purpose: AdminOperationPurpose,
        reason: String,
        page: Int,
        pageSize: Int,
        traceId: String,
    ): AdminInventoryPage = requiredTransaction {
        Authorizer.requireAdminPermission(admin, AdminPermission.CATALOG_MODERATION)
        val normalizedReason = validateContext(
            purpose,
            AdminOperationPurpose.INVENTORY_INVESTIGATION,
            reason,
            traceId,
        )
        validatePage(page, pageSize)
        requireOutletScope(organizationId, outletId)
        val result = persistence.inventory(organizationId, outletId, page, pageSize)
        persistence.appendAudit(
            AdminAuditCommand(
                actorId = admin.actorId,
                action = "ADMIN_INVENTORY_VIEWED",
                targetType = "PROVIDER_OUTLET",
                targetId = outletId,
                reason = normalizedReason,
                source = sourceFor(purpose),
                idempotencyKey = null,
                traceId = traceId,
            ),
        )
        result
    }

    fun auditTrail(
        admin: Principal,
        organizationId: UUID,
        outletId: UUID,
        purpose: AdminOperationPurpose,
        reason: String,
        page: Int,
        pageSize: Int,
        traceId: String,
    ): AdminAuditPage = requiredTransaction {
        Authorizer.requireAdminPermission(admin, AdminPermission.AUDIT_VIEW)
        val normalizedReason = validateContext(purpose, AdminOperationPurpose.AUDIT_REVIEW, reason, traceId)
        validatePage(page, pageSize)
        requireOutletScope(organizationId, outletId)
        val result = persistence.auditTrail(organizationId, outletId, page, pageSize)
        persistence.appendAudit(
            AdminAuditCommand(
                actorId = admin.actorId,
                action = "ADMIN_AUDIT_TRAIL_VIEWED",
                targetType = "PROVIDER_OUTLET",
                targetId = outletId,
                reason = normalizedReason,
                source = sourceFor(purpose),
                idempotencyKey = null,
                traceId = traceId,
            ),
        )
        result
    }

    private fun requireOutletScope(organizationId: UUID, outletId: UUID) {
        val outlet = providers.getOutlet(outletId)
        if (outlet.organizationId != organizationId) resourceUnavailable()
    }

    private fun validateContext(
        actualPurpose: AdminOperationPurpose,
        expectedPurpose: AdminOperationPurpose,
        reason: String,
        traceId: String,
    ): String {
        if (actualPurpose != expectedPurpose) {
            throw DomainException("ADMIN_PURPOSE_INVALID", "The admin purpose is invalid for this operation")
        }
        val normalizedReason = reason.trim()
        if (normalizedReason.length !in 8..240 || normalizedReason.any(Char::isISOControl)) {
            throw DomainException("ADMIN_REASON_INVALID", "A specific admin reason is required")
        }
        if (traceId.isBlank() || traceId.length > 64 || traceId.any(Char::isISOControl)) {
            throw DomainException("TRACE_ID_INVALID", "The trace identifier is invalid")
        }
        return normalizedReason
    }

    private fun validatePage(page: Int, pageSize: Int) {
        if (page !in 0..M12_ADMIN_MAX_PAGE) throw DomainException("PAGE_INVALID", "The requested page is invalid")
        if (pageSize !in 1..M12_ADMIN_MAX_PAGE_SIZE) {
            throw DomainException("PAGE_SIZE_INVALID", "The requested page size is invalid")
        }
    }

    private fun sourceFor(purpose: AdminOperationPurpose): String = "ADMIN_${purpose.name}"

    private fun <T : Any> requiredTransaction(block: () -> T): T =
        transactions.execute { block() }
}

private fun resourceUnavailable(): Nothing = throw DomainException(
    "RESOURCE_NOT_FOUND",
    "The requested resource is unavailable",
)
