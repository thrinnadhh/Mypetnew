package `in`.mypetnew.adminops.infrastructure

import `in`.mypetnew.adminops.domain.AdminAuditCommand
import `in`.mypetnew.adminops.domain.AdminAuditPage
import `in`.mypetnew.adminops.domain.AdminAuditRecord
import `in`.mypetnew.adminops.domain.AdminInventoryPage
import `in`.mypetnew.adminops.domain.AdminOperationsPersistence
import `in`.mypetnew.common.error.DomainException
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

@Component
@Profile("test", "development")
class InMemoryAdminOperationsPersistence : AdminOperationsPersistence {
    private val audits = mutableListOf<AdminAuditRecord>()

    override fun inventory(
        organizationId: UUID,
        outletId: UUID,
        page: Int,
        pageSize: Int,
    ) = AdminInventoryPage(organizationId, outletId, emptyList(), page, pageSize, false)

    @Synchronized
    override fun appendAudit(command: AdminAuditCommand): AdminAuditRecord {
        if (command.idempotencyKey != null) {
            audits.firstOrNull {
                it.actorId == command.actorId &&
                    it.action == command.action &&
                    it.targetType == command.targetType &&
                    it.targetId == command.targetId &&
                    it.idempotencyKey == command.idempotencyKey
            }?.let { existing ->
                if (existing.reason != command.reason || existing.source != command.source) {
                    throw DomainException(
                        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                        "The idempotency key was already used with a different admin context",
                    )
                }
                return existing
            }
        }
        return AdminAuditRecord(
            id = UUID.randomUUID(),
            actorId = command.actorId,
            action = command.action,
            targetType = command.targetType,
            targetId = command.targetId,
            reason = command.reason,
            source = command.source,
            idempotencyKey = command.idempotencyKey,
            traceId = command.traceId,
            occurredAt = Instant.now(),
        ).also(audits::add)
    }

    @Synchronized
    override fun auditTrail(
        organizationId: UUID,
        outletId: UUID,
        page: Int,
        pageSize: Int,
    ): AdminAuditPage {
        val scoped = audits.asSequence()
            .filter { it.targetType == "PROVIDER_OUTLET" && it.targetId == outletId }
            .sortedWith(compareByDescending<AdminAuditRecord> { it.occurredAt }.thenByDescending { it.id })
            .drop(page * pageSize)
            .take(pageSize + 1)
            .toList()
        return AdminAuditPage(
            organizationId = organizationId,
            outletId = outletId,
            items = scoped.take(pageSize),
            page = page,
            pageSize = pageSize,
            hasNext = scoped.size > pageSize,
        )
    }
}
