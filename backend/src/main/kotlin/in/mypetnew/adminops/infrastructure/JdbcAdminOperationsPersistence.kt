package `in`.mypetnew.adminops.infrastructure

import `in`.mypetnew.adminops.domain.AdminAuditCommand
import `in`.mypetnew.adminops.domain.AdminAuditPage
import `in`.mypetnew.adminops.domain.AdminAuditRecord
import `in`.mypetnew.adminops.domain.AdminInventoryItem
import `in`.mypetnew.adminops.domain.AdminInventoryPage
import `in`.mypetnew.adminops.domain.AdminOperationsPersistence
import `in`.mypetnew.common.error.DomainException
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.sql.Timestamp
import java.util.UUID

@Component
@Profile("!test & !development")
class JdbcAdminOperationsPersistence(
    private val jdbc: JdbcClient,
) : AdminOperationsPersistence {
    override fun inventory(
        organizationId: UUID,
        outletId: UUID,
        page: Int,
        pageSize: Int,
    ): AdminInventoryPage {
        val rows = jdbc.sql(
            """
            SELECT l.id, l.name, l.active,
                   COALESCE(b.on_hand, 0) AS on_hand,
                   COALESCE(b.reserved, 0) AS reserved,
                   COALESCE(b.version, 0) AS balance_version,
                   COALESCE(b.updated_at, l.updated_at) AS inventory_updated_at
            FROM mypet.catalog_listing l
            LEFT JOIN mypet.inventory_balance b ON b.listing_id = l.id
            WHERE l.organization_id = :organizationId
              AND l.outlet_id = :outletId
            ORDER BY l.updated_at DESC, l.id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("organizationId", organizationId)
            .param("outletId", outletId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query { rs, _ ->
                val onHand = rs.getInt("on_hand")
                val reserved = rs.getInt("reserved")
                AdminInventoryItem(
                    listingId = rs.getObject("id", UUID::class.java),
                    name = rs.getString("name"),
                    active = rs.getBoolean("active"),
                    onHand = onHand,
                    reserved = reserved,
                    available = onHand - reserved,
                    version = rs.getLong("balance_version"),
                    updatedAt = rs.getObject("inventory_updated_at", Timestamp::class.java).toInstant(),
                )
            }.list()
        return AdminInventoryPage(
            organizationId = organizationId,
            outletId = outletId,
            items = rows.take(pageSize),
            page = page,
            pageSize = pageSize,
            hasNext = rows.size > pageSize,
        )
    }

    override fun appendAudit(command: AdminAuditCommand): AdminAuditRecord {
        if (command.idempotencyKey != null) {
            lockTarget(command.targetId)
            existingIdempotentAudit(command)?.let { existing ->
                if (existing.reason != command.reason || existing.source != command.source) {
                    throw DomainException(
                        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                        "The idempotency key was already used with a different admin context",
                    )
                }
                return existing
            }
        }
        val id = UUID.randomUUID()
        jdbc.sql(
            """
            INSERT INTO mypet.audit_event(
                id, actor_id, actor_role, action, target_type, target_id,
                reason, source, idempotency_key, trace_id, occurred_at
            ) VALUES (
                :id, :actorId, 'ADMIN', :action, :targetType, :targetId,
                :reason, :source, :idempotencyKey, :traceId, CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        ).param("id", id)
            .param("actorId", command.actorId)
            .param("action", command.action)
            .param("targetType", command.targetType)
            .param("targetId", command.targetId)
            .param("reason", command.reason)
            .param("source", command.source)
            .param("idempotencyKey", command.idempotencyKey)
            .param("traceId", command.traceId)
            .update()
        return requireNotNull(auditById(id))
    }

    override fun auditTrail(
        organizationId: UUID,
        outletId: UUID,
        page: Int,
        pageSize: Int,
    ): AdminAuditPage {
        val rows = jdbc.sql(
            """
            SELECT id, actor_id, action, target_type, target_id, reason, source,
                   idempotency_key, trace_id, occurred_at
            FROM mypet.audit_event
            WHERE target_type = 'PROVIDER_OUTLET' AND target_id = :outletId
            ORDER BY occurred_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("outletId", outletId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query { rs, _ -> mapAudit(rs) }
            .list()
        return AdminAuditPage(
            organizationId = organizationId,
            outletId = outletId,
            items = rows.take(pageSize),
            page = page,
            pageSize = pageSize,
            hasNext = rows.size > pageSize,
        )
    }

    private fun lockTarget(targetId: UUID) {
        val found = jdbc.sql("SELECT 1 FROM mypet.provider_outlet WHERE id = :targetId FOR UPDATE")
            .param("targetId", targetId)
            .query(Int::class.javaObjectType)
            .optional()
        if (found.isEmpty) resourceUnavailable()
    }

    private fun existingIdempotentAudit(command: AdminAuditCommand): AdminAuditRecord? = jdbc.sql(
        """
        SELECT id, actor_id, action, target_type, target_id, reason, source,
               idempotency_key, trace_id, occurred_at
        FROM mypet.audit_event
        WHERE actor_id = :actorId
          AND action = :action
          AND target_type = :targetType
          AND target_id = :targetId
          AND idempotency_key = :idempotencyKey
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
        """.trimIndent(),
    ).param("actorId", command.actorId)
        .param("action", command.action)
        .param("targetType", command.targetType)
        .param("targetId", command.targetId)
        .param("idempotencyKey", command.idempotencyKey)
        .query { rs, _ -> mapAudit(rs) }
        .optional()
        .orElse(null)

    private fun auditById(id: UUID): AdminAuditRecord? = jdbc.sql(
        """
        SELECT id, actor_id, action, target_type, target_id, reason, source,
               idempotency_key, trace_id, occurred_at
        FROM mypet.audit_event WHERE id = :id
        """.trimIndent(),
    ).param("id", id)
        .query { rs, _ -> mapAudit(rs) }
        .optional()
        .orElse(null)

    private fun mapAudit(rs: java.sql.ResultSet) = AdminAuditRecord(
        id = rs.getObject("id", UUID::class.java),
        actorId = rs.getObject("actor_id", UUID::class.java),
        action = rs.getString("action"),
        targetType = rs.getString("target_type"),
        targetId = rs.getObject("target_id", UUID::class.java),
        reason = rs.getString("reason") ?: "",
        source = rs.getString("source"),
        idempotencyKey = rs.getString("idempotency_key"),
        traceId = rs.getString("trace_id"),
        occurredAt = rs.getObject("occurred_at", Timestamp::class.java).toInstant(),
    )
}

private fun resourceUnavailable(): Nothing = throw DomainException(
    "RESOURCE_NOT_FOUND",
    "The requested resource is unavailable",
)
