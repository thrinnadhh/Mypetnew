package `in`.mypetnew.merchantops.infrastructure

import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.domain.MerchantDashboardMetrics
import `in`.mypetnew.merchantops.domain.M11_MAX_OUTLET_SCOPE
import `in`.mypetnew.merchantops.domain.MerchantOperationsPersistence
import `in`.mypetnew.merchantops.domain.MerchantNotificationPage
import `in`.mypetnew.merchantops.domain.MerchantOperationalNotification
import `in`.mypetnew.merchantops.domain.MerchantOrderWorkItem
import `in`.mypetnew.merchantops.domain.MerchantOrderWorkPage
import `in`.mypetnew.merchantops.domain.MerchantStaffGrant
import `in`.mypetnew.merchantops.domain.MerchantStaffPage
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.util.UUID

@Component
class JdbcMerchantOperationsPersistence(
    private val jdbc: JdbcClient,
    private val transactions: TransactionTemplate,
) : MerchantOperationsPersistence {
    override fun activeAuthorizedOutletIds(
        accountId: UUID,
        organizationId: UUID,
        tokenOutletIds: Set<UUID>,
    ): List<UUID> {
        if (tokenOutletIds.isEmpty()) return emptyList()
        return jdbc.sql(
            """
            SELECT DISTINCT o.id
            FROM mypet.provider_outlet o
            JOIN mypet.merchant_organization organization
              ON organization.id = o.organization_id
             AND organization.status = 'ACTIVE'
            JOIN mypet.merchant_staff s
              ON s.organization_id = o.organization_id
             AND s.outlet_id = o.id
             AND s.account_id = :accountId
             AND s.active = TRUE
            JOIN mypet.identity_account account
              ON account.id = s.account_id
             AND account.role = 'MERCHANT'
             AND account.status = 'ACTIVE'
            WHERE o.organization_id = :organizationId
              AND o.id IN (:outletIds)
              AND o.status = 'ACTIVE'
            ORDER BY o.id
            LIMIT :scopeLimit
            """.trimIndent(),
        ).param("accountId", accountId)
            .param("organizationId", organizationId)
            .param("outletIds", tokenOutletIds)
            .param("scopeLimit", M11_MAX_OUTLET_SCOPE + 1)
            .query(UUID::class.java)
            .list()
            .filterNotNull()
    }

    override fun dashboard(
        organizationId: UUID,
        outletIds: List<UUID>,
        lowStockThreshold: Int,
    ): MerchantDashboardMetrics {
        if (outletIds.isEmpty()) return MerchantDashboardMetrics(0, 0, 0, 0, 0, lowStockThreshold)
        return jdbc.sql(
            """
            SELECT
              (SELECT COUNT(*)
                 FROM mypet.appointment a
                WHERE a.organization_id = :organizationId
                  AND a.outlet_id IN (:outletIds)
                  AND a.status = 'BOOKED') AS pending_appointments,
              (SELECT COUNT(*)
                 FROM mypet.catalog_listing l
                WHERE l.organization_id = :organizationId
                  AND l.outlet_id IN (:outletIds)
                  AND l.active = TRUE) AS active_catalog,
              (SELECT COUNT(*)
                 FROM mypet.catalog_listing l
                 JOIN mypet.inventory_balance b
                   ON b.organization_id = l.organization_id
                  AND b.outlet_id = l.outlet_id
                  AND b.listing_id = l.id
                WHERE l.organization_id = :organizationId
                  AND l.outlet_id IN (:outletIds)
                  AND l.active = TRUE
                  AND GREATEST(b.on_hand - b.reserved, 0) BETWEEN 1 AND :lowStockThreshold) AS low_stock,
              (SELECT COUNT(*)
                 FROM mypet.catalog_listing l
                 LEFT JOIN mypet.inventory_balance b
                   ON b.organization_id = l.organization_id
                  AND b.outlet_id = l.outlet_id
                  AND b.listing_id = l.id
                WHERE l.organization_id = :organizationId
                  AND l.outlet_id IN (:outletIds)
                  AND l.active = TRUE
                  AND GREATEST(COALESCE(b.on_hand, 0) - COALESCE(b.reserved, 0), 0) = 0) AS out_of_stock,
              (SELECT COUNT(*)
                 FROM mypet.product_order po
                WHERE po.organization_id = :organizationId
                  AND po.outlet_id IN (:outletIds)
                  AND po.status IN ('PLACED','ACCEPTED','PREPARING','READY_FOR_PICKUP','PICKED_UP')) AS order_work
            """.trimIndent(),
        ).param("organizationId", organizationId)
            .param("outletIds", outletIds)
            .param("lowStockThreshold", lowStockThreshold)
            .query { rs, _ ->
                MerchantDashboardMetrics(
                    pendingAppointments = rs.getLong("pending_appointments"),
                    activeCatalog = rs.getLong("active_catalog"),
                    lowStockInventory = rs.getLong("low_stock"),
                    outOfStockInventory = rs.getLong("out_of_stock"),
                    orderWork = rs.getLong("order_work"),
                    lowStockThreshold = lowStockThreshold,
                )
            }.single()
    }

    override fun listStaff(
        organizationId: UUID,
        outletId: UUID,
        page: Int,
        pageSize: Int,
    ): MerchantStaffPage {
        val rows = jdbc.sql(
            """
            SELECT s.account_id, s.outlet_id, s.permission, s.active, a.status AS account_status
            FROM mypet.merchant_staff s
            JOIN mypet.identity_account a ON a.id = s.account_id
            WHERE s.organization_id = :organizationId AND s.outlet_id = :outletId
            ORDER BY s.account_id, s.permission
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("organizationId", organizationId)
            .param("outletId", outletId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query { rs, _ -> mapStaff(rs.getObject("account_id", UUID::class.java), rs.getObject("outlet_id", UUID::class.java), rs.getString("permission"), rs.getBoolean("active"), rs.getString("account_status")) }
            .list()
        return MerchantStaffPage(rows.take(pageSize), page, pageSize, rows.size > pageSize)
    }

    override fun grantStaff(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        targetAccountId: UUID,
        permission: MerchantPermission,
    ): MerchantStaffGrant = transactions.execute {
        requireMutableStaffPermission(permission)
        lockAndRequireManager(actorId, organizationId, outletId)
        requireActiveMerchant(targetAccountId)
        val conflictingOrganizations = jdbc.sql(
            """
            SELECT organization_id
            FROM mypet.merchant_staff
            WHERE account_id = :targetAccountId AND active = TRUE AND organization_id <> :organizationId
            """.trimIndent(),
        ).param("targetAccountId", targetAccountId)
            .param("organizationId", organizationId)
            .query(UUID::class.java).list().filterNotNull().toSet()
        if (conflictingOrganizations.isNotEmpty()) {
            throw DomainException("STAFF_ORGANIZATION_CONFLICT", "The staff account is already active in another merchant organization")
        }
        jdbc.sql(
            """
            INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active)
            VALUES (:targetAccountId, :organizationId, :outletId, :permission, TRUE)
            ON CONFLICT (account_id, outlet_id, permission)
            DO UPDATE SET organization_id = EXCLUDED.organization_id, active = TRUE
            """.trimIndent(),
        ).param("targetAccountId", targetAccountId)
            .param("organizationId", organizationId)
            .param("outletId", outletId)
            .param("permission", permission.name)
            .update()
        currentGrant(targetAccountId, organizationId, outletId, permission)
    }

    override fun revokeStaff(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        targetAccountId: UUID,
        permission: MerchantPermission,
    ): MerchantStaffGrant = transactions.execute {
        requireMutableStaffPermission(permission)
        lockAndRequireManager(actorId, organizationId, outletId)
        val existing = jdbc.sql(
            """
            SELECT s.account_id, s.outlet_id, s.permission, s.active, a.status AS account_status
            FROM mypet.merchant_staff s
            JOIN mypet.identity_account a ON a.id = s.account_id
            WHERE s.account_id = :targetAccountId
              AND s.organization_id = :organizationId
              AND s.outlet_id = :outletId
              AND s.permission = :permission
            FOR UPDATE OF s
            """.trimIndent(),
        ).param("targetAccountId", targetAccountId)
            .param("organizationId", organizationId)
            .param("outletId", outletId)
            .param("permission", permission.name)
            .query { rs, _ -> mapStaff(rs.getObject("account_id", UUID::class.java), rs.getObject("outlet_id", UUID::class.java), rs.getString("permission"), rs.getBoolean("active"), rs.getString("account_status")) }
            .optional().orElseThrow { resourceUnavailable() }

        if (!existing.active) return@execute existing
        jdbc.sql(
            """
            UPDATE mypet.merchant_staff SET active = FALSE
            WHERE account_id = :targetAccountId AND organization_id = :organizationId
              AND outlet_id = :outletId AND permission = :permission
            """.trimIndent(),
        ).param("targetAccountId", targetAccountId)
            .param("organizationId", organizationId)
            .param("outletId", outletId)
            .param("permission", permission.name)
            .update()
        currentGrant(targetAccountId, organizationId, outletId, permission)
    }

    override fun listOrderWork(
        organizationId: UUID,
        outletIds: List<UUID>,
        page: Int,
        pageSize: Int,
    ): MerchantOrderWorkPage {
        val rows = jdbc.sql(
            """
            SELECT id, order_number, outlet_id, status, fulfilment_mode, grand_total_paise, payment_status, created_at
            FROM mypet.product_order
            WHERE organization_id = :organizationId
              AND outlet_id IN (:outletIds)
              AND status IN ('PLACED','ACCEPTED','PREPARING','READY_FOR_PICKUP','PICKED_UP')
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("organizationId", organizationId)
            .param("outletIds", outletIds)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query { rs, _ ->
                MerchantOrderWorkItem(
                    orderId = rs.getObject("id", UUID::class.java),
                    orderNumber = rs.getString("order_number"),
                    outletId = rs.getObject("outlet_id", UUID::class.java),
                    status = rs.getString("status"),
                    fulfilmentMode = rs.getString("fulfilment_mode"),
                    grandTotalPaise = rs.getLong("grand_total_paise"),
                    paymentStatus = rs.getString("payment_status"),
                    createdAt = rs.getObject("created_at", Timestamp::class.java).toInstant(),
                )
            }.list()
        return MerchantOrderWorkPage(rows.take(pageSize), page, pageSize, rows.size > pageSize)
    }

    override fun listNotifications(
        recipientId: UUID,
        organizationId: UUID,
        outletIds: List<UUID>,
        page: Int,
        pageSize: Int,
    ): MerchantNotificationPage {
        val rows = jdbc.sql(
            """
            SELECT n.id, n.source_event_id, n.event_type, n.safe_route, n.resource_id,
                   n.title, n.body, n.created_at
            FROM mypet.notification_item n
            WHERE n.recipient_id = :recipientId
              AND (
                (n.safe_route = 'merchant/orders/detail' AND EXISTS (
                  SELECT 1 FROM mypet.product_order po
                  WHERE po.id = n.resource_id AND po.organization_id = :organizationId AND po.outlet_id IN (:outletIds)
                ))
                OR (n.safe_route = 'merchant/appointments/detail' AND EXISTS (
                  SELECT 1 FROM mypet.appointment a
                  WHERE a.id = n.resource_id AND a.organization_id = :organizationId AND a.outlet_id IN (:outletIds)
                ))
                OR (n.safe_route = 'merchant/catalog/detail' AND EXISTS (
                  SELECT 1 FROM mypet.catalog_listing l
                  WHERE l.id = n.resource_id AND l.organization_id = :organizationId AND l.outlet_id IN (:outletIds)
                ))
                OR (n.safe_route = 'merchant/inventory/detail' AND EXISTS (
                  SELECT 1 FROM mypet.inventory_balance b
                  WHERE b.listing_id = n.resource_id AND b.organization_id = :organizationId AND b.outlet_id IN (:outletIds)
                ))
                OR (n.safe_route = 'inbox' AND n.resource_id IN (:outletIds))
              )
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        ).param("recipientId", recipientId)
            .param("organizationId", organizationId)
            .param("outletIds", outletIds)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query { rs, _ ->
                val route = rs.getString("safe_route")
                val resourceId = rs.getObject("resource_id", UUID::class.java)
                val id = rs.getObject("id", UUID::class.java)
                MerchantOperationalNotification(
                    id = id,
                    sourceEventId = rs.getObject("source_event_id", UUID::class.java),
                    title = rs.getString("title"),
                    body = rs.getString("body"),
                    resourceId = resourceId,
                    createdAt = rs.getObject("created_at", Timestamp::class.java).toInstant(),
                    payload = mapOf(
                        "notificationId" to id.toString(),
                        "resourceId" to resourceId.toString(),
                        "route" to route,
                        "eventType" to rs.getString("event_type"),
                    ),
                )
            }.list()
        return MerchantNotificationPage(rows.take(pageSize), page, pageSize, rows.size > pageSize)
    }

    private fun lockAndRequireManager(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
    ) {
        val permissions = jdbc.sql(
            """
            SELECT staff.permission
            FROM mypet.merchant_staff staff
            JOIN mypet.identity_account account
              ON account.id = staff.account_id
             AND account.role = 'MERCHANT'
             AND account.status = 'ACTIVE'
            WHERE staff.account_id = :actorId AND staff.organization_id = :organizationId
              AND staff.outlet_id = :outletId AND staff.active = TRUE
            ORDER BY staff.permission
            FOR UPDATE OF staff
            """.trimIndent(),
        ).param("actorId", actorId)
            .param("organizationId", organizationId)
            .param("outletId", outletId)
            .query(String::class.java).list()
            .mapNotNull { value -> value?.let { runCatching { MerchantPermission.valueOf(it) }.getOrNull() } }
            .toSet()
        if (permissions.isEmpty()) resourceUnavailable()
        val owner = MerchantPermission.OWNER in permissions
        val manager = owner || MerchantPermission.OUTLET_MANAGE in permissions
        if (!manager) {
            throw DomainException("MERCHANT_PERMISSION_REQUIRED", "The required merchant permission is missing")
        }
        val activeOutlet = jdbc.sql(
            """
            SELECT COUNT(*)
            FROM mypet.provider_outlet outlet
            JOIN mypet.merchant_organization organization
              ON organization.id = outlet.organization_id
             AND organization.status = 'ACTIVE'
            WHERE outlet.id = :outletId
              AND outlet.organization_id = :organizationId
              AND outlet.status = 'ACTIVE'
            """.trimIndent(),
        ).param("outletId", outletId)
            .param("organizationId", organizationId)
            .query(Int::class.java).single() == 1
        if (!activeOutlet) resourceUnavailable()
    }

    private fun requireActiveMerchant(accountId: UUID) {
        val active = jdbc.sql(
            """
            SELECT id
            FROM mypet.identity_account
            WHERE id = :accountId AND role = 'MERCHANT' AND status = 'ACTIVE'
            FOR UPDATE
            """.trimIndent(),
        ).param("accountId", accountId).query(UUID::class.java).optional().orElse(null)
        if (active == null) resourceUnavailable()
    }

    private fun requireMutableStaffPermission(permission: MerchantPermission) {
        if (permission == MerchantPermission.OWNER) {
            throw DomainException(
                "OWNER_PERMISSION_IMMUTABLE",
                "Canonical owner membership cannot be changed through staff operations",
            )
        }
    }

    private fun currentGrant(
        accountId: UUID,
        organizationId: UUID,
        outletId: UUID,
        permission: MerchantPermission,
    ): MerchantStaffGrant = jdbc.sql(
        """
        SELECT s.account_id, s.outlet_id, s.permission, s.active, a.status AS account_status
        FROM mypet.merchant_staff s
        JOIN mypet.identity_account a ON a.id = s.account_id
        WHERE s.account_id = :accountId AND s.organization_id = :organizationId
          AND s.outlet_id = :outletId AND s.permission = :permission
        """.trimIndent(),
    ).param("accountId", accountId)
        .param("organizationId", organizationId)
        .param("outletId", outletId)
        .param("permission", permission.name)
        .query { rs, _ -> mapStaff(rs.getObject("account_id", UUID::class.java), rs.getObject("outlet_id", UUID::class.java), rs.getString("permission"), rs.getBoolean("active"), rs.getString("account_status")) }
        .single()

    private fun mapStaff(
        accountId: UUID,
        outletId: UUID,
        permission: String,
        active: Boolean,
        accountStatus: String,
    ) = MerchantStaffGrant(
        accountId = accountId,
        outletId = outletId,
        permission = runCatching { MerchantPermission.valueOf(permission) }.getOrElse { resourceUnavailable() },
        active = active,
        accountStatus = accountStatus,
    )

    private fun resourceUnavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )
}
