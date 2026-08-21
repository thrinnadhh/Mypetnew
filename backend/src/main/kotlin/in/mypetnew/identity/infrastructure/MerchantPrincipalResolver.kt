package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.util.UUID

interface MerchantPrincipalResolver {
    fun resolve(accountId: UUID, sessionId: UUID): Principal

    /** Revalidate a token principal against current server-owned Merchant authorization. */
    fun reauthorize(principal: Principal): Principal = resolve(principal.actorId, principal.sessionId)
}

@Component
@Profile("test", "development")
class DevelopmentMerchantPrincipalResolver : MerchantPrincipalResolver {
    override fun resolve(accountId: UUID, sessionId: UUID): Principal =
        Principal(actorId = accountId, role = Role.MERCHANT, sessionId = sessionId)

    // Existing contract/API tests construct explicit Merchant scopes. Preserve those fixtures only
    // in test/development; production always uses JdbcMerchantPrincipalResolver and current DB grants.
    override fun reauthorize(principal: Principal): Principal {
        if (
            principal.role == Role.MERCHANT &&
            principal.outletIds.isNotEmpty() &&
            principal.merchantPermissionsByOutlet.isEmpty()
        ) {
            return principal.copy(
                merchantPermissionsByOutlet = principal.outletIds.associateWith {
                    setOf(MerchantPermission.OWNER)
                },
            )
        }
        return principal
    }
}

@Component
@Profile("!test & !development")
class JdbcMerchantPrincipalResolver(
    private val jdbc: JdbcClient,
) : MerchantPrincipalResolver {
    override fun resolve(accountId: UUID, sessionId: UUID): Principal {
        val authorized = jdbc.sql(
            """
            SELECT COUNT(*)
            FROM mypet.identity_account
            WHERE id = :account_id AND role = 'MERCHANT' AND status = 'ACTIVE'
            """.trimIndent(),
        ).param("account_id", accountId).query(Int::class.java).single() == 1
        if (!authorized) invalidSession()

        val memberships = jdbc.sql(
            """
            SELECT s.organization_id, s.outlet_id, s.permission
            FROM mypet.merchant_staff s
            JOIN mypet.provider_outlet o
              ON o.id = s.outlet_id
             AND o.organization_id = s.organization_id
            WHERE s.account_id = :account_id
              AND s.active = TRUE
            ORDER BY s.organization_id, s.outlet_id, s.permission
            """.trimIndent(),
        ).param("account_id", accountId).query { result, _ ->
            val permission = runCatching {
                MerchantPermission.valueOf(result.getString("permission"))
            }.getOrElse { invalidSession() }
            MerchantMembership(
                organizationId = result.getObject("organization_id", UUID::class.java),
                outletId = result.getObject("outlet_id", UUID::class.java),
                permission = permission,
            )
        }.list()

        val organizations = memberships.map { it.organizationId }.distinct()
        if (organizations.size > 1) invalidSession()

        val outlets = memberships.map { it.outletId }.toSet()
        val merchantPermissions = memberships
            .groupBy(MerchantMembership::outletId, MerchantMembership::permission)
            .mapValues { (_, permissions) -> permissions.toSet() }

        return Principal(
            actorId = accountId,
            role = Role.MERCHANT,
            organizationId = organizations.singleOrNull(),
            outletIds = outlets,
            sessionId = sessionId,
            merchantPermissionsByOutlet = merchantPermissions,
        )
    }

    override fun reauthorize(principal: Principal): Principal {
        if (principal.role != Role.MERCHANT) invalidSession()
        return resolve(principal.actorId, principal.sessionId)
    }

    private fun invalidSession(): Nothing = throw DomainException(
        "SESSION_INVALID",
        "The session cannot be created",
    )

    private data class MerchantMembership(
        val organizationId: UUID,
        val outletId: UUID,
        val permission: MerchantPermission,
    )
}
