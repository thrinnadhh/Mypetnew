package `in`.mypetnew.identity

import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.util.UUID

class MerchantPrincipalResolverContractTest {
    @Test
    fun `reauthorization replaces stale token scopes with current membership`() {
        val dataSource = dataSource("merchant_scope")
        val jdbc = JdbcTemplate(dataSource)
        createTables(jdbc)
        val accountId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val currentOutletId = UUID.randomUUID()
        val staleOutletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, role, status) VALUES (?, 'MERCHANT', 'ACTIVE')",
            accountId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, active) VALUES (?, ?, ?, TRUE)",
            accountId,
            organizationId,
            currentOutletId,
        )
        val resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource))
        val sessionId = UUID.randomUUID()
        val stale = Principal(
            actorId = accountId,
            role = Role.MERCHANT,
            organizationId = UUID.randomUUID(),
            outletIds = setOf(staleOutletId),
            sessionId = sessionId,
        )

        val current = resolver.reauthorize(stale)

        assertEquals(accountId, current.actorId)
        assertEquals(Role.MERCHANT, current.role)
        assertEquals(organizationId, current.organizationId)
        assertEquals(setOf(currentOutletId), current.outletIds)
        assertEquals(sessionId, current.sessionId)
    }

    @Test
    fun `inactive membership removes all tenant scopes and suspended identity fails closed`() {
        val dataSource = dataSource("merchant_reauth_revoke")
        val jdbc = JdbcTemplate(dataSource)
        createTables(jdbc)
        val accountId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, role, status) VALUES (?, 'MERCHANT', 'ACTIVE')",
            accountId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, active) VALUES (?, ?, ?, FALSE)",
            accountId,
            organizationId,
            outletId,
        )
        val resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource))
        val token = Principal(
            actorId = accountId,
            role = Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
        )

        val withoutMembership = resolver.reauthorize(token)
        assertEquals(null, withoutMembership.organizationId)
        assertTrue(withoutMembership.outletIds.isEmpty())

        jdbc.update("UPDATE mypet.identity_account SET status = 'SUSPENDED' WHERE id = ?", accountId)
        assertThrows(DomainException::class.java) { resolver.reauthorize(token) }
    }

    private fun dataSource(prefix: String) = DriverManagerDataSource(
        "jdbc:h2:mem:${prefix}_${UUID.randomUUID().toString().replace("-", "")};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "sa",
        "",
    )

    private fun createTables(jdbc: JdbcTemplate) {
        jdbc.execute("CREATE SCHEMA mypet")
        jdbc.execute(
            """
            CREATE TABLE mypet.identity_account (
                id UUID PRIMARY KEY,
                role VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.merchant_staff (
                account_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                active BOOLEAN NOT NULL
            )
            """.trimIndent(),
        )
    }
}
