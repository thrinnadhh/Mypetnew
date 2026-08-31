package `in`.mypetnew.merchantops.domain

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.springframework.stereotype.Service
import java.time.Instant
import java.util.UUID

const val M11_LOW_STOCK_THRESHOLD = 5

data class MerchantDashboardMetrics(
    val pendingAppointments: Long,
    val activeCatalog: Long,
    val lowStockInventory: Long,
    val outOfStockInventory: Long,
    val orderWork: Long,
    val lowStockThreshold: Int = M11_LOW_STOCK_THRESHOLD,
)

data class MerchantDashboard(
    val outletIds: List<UUID>,
    val metrics: MerchantDashboardMetrics,
    val generatedAt: Instant,
)

data class MerchantStaffGrant(
    val accountId: UUID,
    val outletId: UUID,
    val permission: MerchantPermission,
    val active: Boolean,
    val accountStatus: String,
)

data class MerchantStaffPage(
    val items: List<MerchantStaffGrant>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

data class MerchantOperationalNotification(
    val id: UUID,
    val sourceEventId: UUID,
    val title: String,
    val body: String,
    val resourceId: UUID,
    val createdAt: Instant,
    val payload: Map<String, String>,
)

data class MerchantNotificationPage(
    val items: List<MerchantOperationalNotification>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

data class MerchantOrderWorkItem(
    val orderId: UUID,
    val orderNumber: String,
    val outletId: UUID,
    val status: String,
    val fulfilmentMode: String,
    val grandTotalPaise: Long,
    val paymentStatus: String,
    val createdAt: Instant,
)

data class MerchantOrderWorkPage(
    val items: List<MerchantOrderWorkItem>,
    val page: Int,
    val pageSize: Int,
    val hasNext: Boolean,
)

interface MerchantOperationsPersistence {
    fun activeAuthorizedOutletIds(
        accountId: UUID,
        organizationId: UUID,
        tokenOutletIds: Set<UUID>,
    ): List<UUID>

    fun dashboard(
        organizationId: UUID,
        outletIds: List<UUID>,
        lowStockThreshold: Int,
    ): MerchantDashboardMetrics

    fun listStaff(
        organizationId: UUID,
        outletId: UUID,
        page: Int,
        pageSize: Int,
    ): MerchantStaffPage

    fun grantStaff(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        targetAccountId: UUID,
        permission: MerchantPermission,
    ): MerchantStaffGrant

    fun revokeStaff(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        targetAccountId: UUID,
        permission: MerchantPermission,
    ): MerchantStaffGrant

    fun listNotifications(
        recipientId: UUID,
        organizationId: UUID,
        outletIds: List<UUID>,
        page: Int,
        pageSize: Int,
    ): MerchantNotificationPage

    fun listOrderWork(
        organizationId: UUID,
        outletIds: List<UUID>,
        page: Int,
        pageSize: Int,
    ): MerchantOrderWorkPage
}

@Service
class MerchantOperationsService(
    private val persistence: MerchantOperationsPersistence,
) {
    fun dashboard(principal: Principal, outletId: UUID?): MerchantDashboard {
        val organizationId = requireMerchantOrganization(principal)
        val selected = resolveActiveOutlets(principal, organizationId, outletId)
        val metrics = if (selected.isEmpty()) {
            MerchantDashboardMetrics(0, 0, 0, 0, 0)
        } else {
            persistence.dashboard(organizationId, selected, M11_LOW_STOCK_THRESHOLD)
        }
        return MerchantDashboard(selected.sortedBy(UUID::toString), metrics, Instant.now())
    }

    fun listStaff(
        principal: Principal,
        outletId: UUID,
        page: Int,
        pageSize: Int,
    ): MerchantStaffPage {
        validatePage(page, pageSize)
        val organizationId = requireMerchantOrganization(principal)
        requireManagementScope(principal, outletId)
        requireActiveOutlet(principal, organizationId, outletId)
        return persistence.listStaff(organizationId, outletId, page, pageSize)
    }

    fun grantStaff(
        principal: Principal,
        outletId: UUID,
        accountId: UUID,
        permission: MerchantPermission,
    ): MerchantStaffGrant {
        val organizationId = requireMerchantOrganization(principal)
        requireManagementScope(principal, outletId)
        requireActiveOutlet(principal, organizationId, outletId)
        requireMutableStaffPermission(permission)
        return persistence.grantStaff(
            actorId = principal.actorId,
            organizationId = organizationId,
            outletId = outletId,
            targetAccountId = accountId,
            permission = permission,
        )
    }

    fun revokeStaff(
        principal: Principal,
        outletId: UUID,
        accountId: UUID,
        permission: MerchantPermission,
    ): MerchantStaffGrant {
        val organizationId = requireMerchantOrganization(principal)
        requireManagementScope(principal, outletId)
        requireActiveOutlet(principal, organizationId, outletId)
        requireMutableStaffPermission(permission)
        return persistence.revokeStaff(
            actorId = principal.actorId,
            organizationId = organizationId,
            outletId = outletId,
            targetAccountId = accountId,
            permission = permission,
        )
    }

    fun orderWork(
        principal: Principal,
        outletId: UUID?,
        page: Int,
        pageSize: Int,
    ): MerchantOrderWorkPage {
        validatePage(page, pageSize)
        val organizationId = requireMerchantOrganization(principal)
        val selected = resolveActiveOutlets(principal, organizationId, outletId)
        if (selected.isEmpty()) return MerchantOrderWorkPage(emptyList(), page, pageSize, false)
        return persistence.listOrderWork(organizationId, selected, page, pageSize)
    }

    fun notifications(
        principal: Principal,
        outletId: UUID?,
        page: Int,
        pageSize: Int,
    ): MerchantNotificationPage {
        validatePage(page, pageSize)
        val organizationId = requireMerchantOrganization(principal)
        val selected = resolveActiveOutlets(principal, organizationId, outletId)
        if (selected.isEmpty()) return MerchantNotificationPage(emptyList(), page, pageSize, false)
        return persistence.listNotifications(principal.actorId, organizationId, selected, page, pageSize)
    }

    private fun resolveActiveOutlets(
        principal: Principal,
        organizationId: UUID,
        outletId: UUID?,
    ): List<UUID> {
        val activeOutletIds = persistence.activeAuthorizedOutletIds(
            principal.actorId,
            organizationId,
            principal.outletIds,
        )
        if (outletId == null) return activeOutletIds
        if (outletId !in activeOutletIds) resourceUnavailable()
        return listOf(outletId)
    }

    private fun requireMerchantOrganization(principal: Principal): UUID {
        Authorizer.requireRole(principal, Role.MERCHANT)
        return principal.organizationId ?: resourceUnavailable()
    }

    private fun requireManagementScope(principal: Principal, outletId: UUID) {
        if (outletId !in principal.outletIds) resourceUnavailable()
        val permissions = principal.merchantPermissionsByOutlet[outletId].orEmpty()
        val isOwner = MerchantPermission.OWNER in permissions
        val canManage = isOwner || MerchantPermission.OUTLET_MANAGE in permissions
        if (!canManage) permissionRequired()
    }

    private fun requireActiveOutlet(principal: Principal, organizationId: UUID, outletId: UUID) {
        val active = persistence.activeAuthorizedOutletIds(
            principal.actorId,
            organizationId,
            setOf(outletId),
        )
        if (active.singleOrNull() != outletId) resourceUnavailable()
    }

    private fun validatePage(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100 || page.toLong() * pageSize.toLong() > 100_000L) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    private fun requireMutableStaffPermission(permission: MerchantPermission) {
        if (permission == MerchantPermission.OWNER) {
            throw DomainException(
                "OWNER_PERMISSION_IMMUTABLE",
                "Canonical owner membership cannot be changed through staff operations",
            )
        }
    }

    private fun permissionRequired(): Nothing = throw DomainException(
        "MERCHANT_PERMISSION_REQUIRED",
        "The required merchant permission is missing",
    )

    private fun resourceUnavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )
}
