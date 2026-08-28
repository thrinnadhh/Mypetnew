package `in`.mypetnew.merchantops

import `in`.mypetnew.application.security.MerchantReauthorizationFilter
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import jakarta.servlet.FilterChain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M6MerchantReauthorizationFilterPostgresContractTest {
    @AfterEach
    fun clearContext() = SecurityContextHolder.clearContext()

    private data class Scope(val jdbc: JdbcTemplate, val actorId: UUID, val organizationId: UUID, val outletId: UUID, val sessionId: UUID)

    private fun scope(): Scope {
        PostgresTestDatabase.resetAndMigrate()
        val jdbc = JdbcTemplate(PostgresTestDatabase.dataSource())
        val actorId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')", actorId, "+919320000071")
        jdbc.update("INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M6 Filter Org', 'ACTIVE', ?)", organizationId, actorId)
        jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M6 Filter Outlet', 'ACTIVE', TRUE)", outletId, organizationId)
        jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", actorId, organizationId, outletId)
        return Scope(jdbc, actorId, organizationId, outletId, sessionId)
    }

    private fun staleOwner(s: Scope) = Principal(
        actorId = s.actorId,
        role = Role.MERCHANT,
        organizationId = s.organizationId,
        outletIds = setOf(s.outletId),
        sessionId = s.sessionId,
        merchantPermissionsByOutlet = mapOf(s.outletId to setOf(MerchantPermission.OWNER)),
    )

    private fun filter(): MerchantReauthorizationFilter = MerchantReauthorizationFilter(
        JdbcMerchantPrincipalResolver(JdbcClient.create(PostgresTestDatabase.dataSource())),
    )

    @Test
    fun `M6-SYNC-002 filter replaces stale owner scope with current database permission`() {
        val s = scope()
        val tokenPrincipal = staleOwner(s)
        s.jdbc.update("UPDATE mypet.merchant_staff SET permission = 'CATALOG_WRITE' WHERE account_id = ? AND outlet_id = ?", s.actorId, s.outletId)

        val movementBefore = s.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.inventory_movement", Long::class.java) ?: 0L
        val receiptBefore = s.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.inventory_command_receipt", Long::class.java) ?: 0L
        val feedBefore = s.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.merchant_sync_change_log", Long::class.java) ?: 0L

        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(tokenPrincipal, null, emptyList())
        var downstreamRan = false
        filter().doFilter(
            MockHttpServletRequest("POST", "/api/v1/merchant/inventory/adjustments"),
            MockHttpServletResponse(),
            FilterChain { _, _ ->
                downstreamRan = true
                val refreshed = SecurityContextHolder.getContext().authentication.principal as Principal
                assertEquals(setOf(MerchantPermission.CATALOG_WRITE), refreshed.merchantPermissionsByOutlet[s.outletId])
                assertTrue(MerchantPermission.OWNER !in refreshed.merchantPermissionsByOutlet[s.outletId].orEmpty())
            },
        )

        assertTrue(downstreamRan)
        assertEquals(movementBefore, s.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.inventory_movement", Long::class.java))
        assertEquals(receiptBefore, s.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.inventory_command_receipt", Long::class.java))
        assertEquals(feedBefore, s.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.merchant_sync_change_log", Long::class.java))
    }

    @Test
    fun `M6-SYNC-002 filter clears stale merchant authentication after account disable`() {
        val s = scope()
        val tokenPrincipal = staleOwner(s)
        s.jdbc.update("UPDATE mypet.identity_account SET status = 'DISABLED' WHERE id = ?", s.actorId)

        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(tokenPrincipal, null, emptyList())
        var downstreamAuthenticated = true
        filter().doFilter(
            MockHttpServletRequest("POST", "/api/v1/merchant/inventory/adjustments"),
            MockHttpServletResponse(),
            FilterChain { _, _ -> downstreamAuthenticated = SecurityContextHolder.getContext().authentication != null },
        )

        assertTrue(!downstreamAuthenticated)
        assertNull(SecurityContextHolder.getContext().authentication)
    }
}
