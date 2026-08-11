package `in`.mypetnew.common.auth

import `in`.mypetnew.common.error.DomainException
import java.util.UUID

enum class Role {
    CUSTOMER,
    MERCHANT,
    CAPTAIN,
    ADMIN,
}

enum class AdminPermission {
    PROVIDER_REVIEW,
    CAPTAIN_REVIEW,
    CATALOG_MODERATION,
    ORDER_OPERATIONS,
    DISPATCH_OPERATIONS,
    PAYMENT_OPERATIONS,
    REFUND_APPROVER,
    SUPPORT_OPERATIONS,
    CONTENT_MANAGER,
    CITY_MANAGER,
    FINANCE_VIEW,
    AUDIT_VIEW,
    ADMIN_ACCESS_MANAGER,
}

data class Principal(
    val actorId: UUID,
    val role: Role,
    val organizationId: UUID? = null,
    val outletIds: Set<UUID> = emptySet(),
    val permissions: Set<AdminPermission> = emptySet(),
    val sessionId: UUID = UUID.randomUUID(),
)

object Authorizer {
    fun requireRole(principal: Principal, expected: Role) {
        if (principal.role != expected) {
            throw DomainException("FORBIDDEN", "You are not allowed to perform this action")
        }
    }

    fun requireAdminPermission(principal: Principal, permission: AdminPermission) {
        requireRole(principal, Role.ADMIN)
        if (permission !in principal.permissions) {
            throw DomainException("ADMIN_PERMISSION_REQUIRED", "The required permission is missing")
        }
    }

    fun requireOutlet(principal: Principal, outletId: UUID) {
        requireRole(principal, Role.MERCHANT)
        if (outletId !in principal.outletIds) {
            throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        }
    }
}

