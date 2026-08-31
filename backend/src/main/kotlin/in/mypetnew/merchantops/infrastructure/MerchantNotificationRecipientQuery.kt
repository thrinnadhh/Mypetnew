package `in`.mypetnew.merchantops.infrastructure

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.util.UUID

@Component
class MerchantNotificationRecipientQuery(
    private val jdbc: JdbcClient,
) {
    fun appointmentRecipients(organizationId: UUID, outletId: UUID): List<UUID> = jdbc.sql(
        """
        SELECT DISTINCT s.account_id
        FROM mypet.merchant_staff s
        JOIN mypet.identity_account a ON a.id = s.account_id
        JOIN mypet.provider_outlet o
          ON o.id = s.outlet_id AND o.organization_id = s.organization_id
        JOIN mypet.merchant_organization organization
          ON organization.id = s.organization_id
        WHERE s.organization_id = :organizationId
          AND s.outlet_id = :outletId
          AND s.active = TRUE
          AND s.permission IN ('OWNER','ORDER_FULFIL')
          AND a.role = 'MERCHANT' AND a.status = 'ACTIVE'
          AND o.status = 'ACTIVE'
          AND organization.status = 'ACTIVE'
        ORDER BY s.account_id
        LIMIT 100
        """.trimIndent(),
    ).param("organizationId", organizationId)
        .param("outletId", outletId)
        .query(UUID::class.java).list().filterNotNull()
}
