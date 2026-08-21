package `in`.mypetnew.identity

import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.MerchantPermission
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
        insertOutlet(jdbc, currentOutletId, organizationId)
        jdbc.update(
            """
            INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active)
            VALUES (?, ?, ?, 'OWNER', TRUE)
            """.trimIndent(),
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
            merchantPermissionsByOutlet = mapOf(staleOutletId to setOf(MerchantPermission.OWNER)),
        )

        val current = resolver.reauthorize(stale)

        assertEquals(accountId, current.actorId)
        assertEquals(Role.MERCHANT, current.role)
        assertEquals(organizationId, current.organizationId)
        assertEquals(setOf(currentOutletId), current.outletIds)
        assertEquals(
            mapOf(currentOutletId to setOf(MerchantPermission.OWNER)),
            current.merchantPermissionsByOutlet,
        )
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
        insertOutlet(jdbc, outletId, organizationId)
        jdbc.update(
            """
            INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active)
            VALUES (?, ?, ?, 'OWNER', FALSE)
            """.trimIndent(),
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
            merchantPermissionsByOutlet = mapOf(outletId to setOf(MerchantPermission.OWNER)),
        )

        val withoutMembership = resolver.reauthorize(token)
        assertEquals(null, withoutMembership.organizationId)
        assertTrue(withoutMembership.outletIds.isEmpty())
        assertTrue(withoutMembership.merchantPermissionsByOutlet.isEmpty())

        jdbc.update("UPDATE mypet.identity_account SET status = 'SUSPENDED' WHERE id = ?", accountId)
        assertThrows(DomainException::class.java) { resolver.reauthorize(token) }
    }

    @Test
    fun `permission revocation replaces stale permission before replay`() {
        val dataSource = dataSource("merchant_permission_revoke")
        val jdbc = JdbcTemplate(dataSource)
        createTables(jdbc)
        val accountId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, role, status) VALUES (?, 'MERCHANT', 'ACTIVE')",
            accountId,
        )
        insertOutlet(jdbc, outletId, organizationId)
        listOf(MerchantPermission.CATALOG_WRITE, MerchantPermission.INVENTORY_WRITE).forEach { permission ->
            jdbc.update(
                """
                INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active)
                VALUES (?, ?, ?, ?, TRUE)
                """.trimIndent(),
                accountId,
                organizationId,
                outletId,
                permission.name,
            )
        }
        val resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource))
        val beforeRevocation = resolver.resolve(accountId, UUID.randomUUID())
        Authorizer.requireMerchantPermission(beforeRevocation, outletId, MerchantPermission.INVENTORY_WRITE)

        jdbc.update(
            """
            UPDATE mypet.merchant_staff SET active = FALSE
            WHERE account_id = ? AND outlet_id = ? AND permission = 'INVENTORY_WRITE'
            """.trimIndent(),
            accountId,
            outletId,
        )

        val replayPrincipal = resolver.reauthorize(beforeRevocation)
        Authorizer.requireMerchantPermission(replayPrincipal, outletId, MerchantPermission.CATALOG_WRITE)
        assertThrows(DomainException::class.java) {
            Authorizer.requireMerchantPermission(replayPrincipal, outletId, MerchantPermission.INVENTORY_WRITE)
        }
    }

    @Test
    fun `malformed cross organization membership is excluded from merchant scope`() {
        val dataSource = dataSource("merchant_cross_org")
        val jdbc = JdbcTemplate(dataSource)
        createTables(jdbc)
        val accountId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val foreignOrganizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, role, status) VALUES (?, 'MERCHANT', 'ACTIVE')",
            accountId,
        )
        insertOutlet(jdbc, outletId, foreignOrganizationId)
        jdbc.update(
            """
            INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active)
            VALUES (?, ?, ?, 'OWNER', TRUE)
            """.trimIndent(),
            accountId,
            organizationId,
            outletId,
        )

        val resolved = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource))
            .resolve(accountId, UUID.randomUUID())

        assertEquals(null, resolved.organizationId)
        assertTrue(resolved.outletIds.isEmpty())
        assertThrows(DomainException::class.java) { Authorizer.requireOutlet(resolved, outletId) }
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
            CREATE TABLE mypet.provider_outlet (
                id UUID PRIMARY KEY,
                organization_id UUID NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.merchant_staff (
                account_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                permission VARCHAR(64) NOT NULL,
                active BOOLEAN NOT NULL
            )
            """.trimIndent(),
        )
    }

    private fun insertOutlet(jdbc: JdbcTemplate, outletId: UUID, organizationId: UUID) {
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id) VALUES (?, ?)",
            outletId,
            organizationId,
        )
    }
}
