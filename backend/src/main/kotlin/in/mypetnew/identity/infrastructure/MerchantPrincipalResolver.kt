package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.util.UUID

interface MerchantPrincipalResolver {
    fun resolve(accountId: UUID, sessionId: UUID): Principal
}

@Component
@Profile("test", "development")
class DevelopmentMerchantPrincipalResolver : MerchantPrincipalResolver {
    override fun resolve(accountId: UUID, sessionId: UUID): Principal =
        Principal(actorId = accountId, role = Role.MERCHANT, sessionId = sessionId)
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

        val organizations = jdbc.sql(
            """
            SELECT DISTINCT organization_id
            FROM mypet.merchant_staff
            WHERE account_id = :account_id AND active = TRUE
            """.trimIndent(),
        ).param("account_id", accountId).query(UUID::class.java).list()
        if (organizations.size > 1) invalidSession()

        val outlets = jdbc.sql(
            """
            SELECT DISTINCT outlet_id
            FROM mypet.merchant_staff
            WHERE account_id = :account_id AND active = TRUE
            """.trimIndent(),
        ).param("account_id", accountId).query(UUID::class.java).list().toSet()

        return Principal(
            actorId = accountId,
            role = Role.MERCHANT,
            organizationId = organizations.singleOrNull(),
            outletIds = outlets,
            sessionId = sessionId,
        )
    }

    private fun invalidSession(): Nothing = throw DomainException(
        "SESSION_INVALID",
        "The session cannot be created",
    )
}
