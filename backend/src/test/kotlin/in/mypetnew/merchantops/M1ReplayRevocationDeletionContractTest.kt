package `in`.mypetnew.merchantops

import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M1ReplayRevocationDeletionContractTest {
    @Test
    fun `idempotent replay cannot recreate a deleted owner membership`() {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val providers = ProviderService(
            JdbcProviderPersistence(
                jdbc,
                TransactionTemplate(DataSourceTransactionManager(dataSource)),
            ),
        )
        val resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource))
        val ownerId = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.identity_account(id, mobile_e164, role, status)
            VALUES (?, '+919200000005', 'MERCHANT', 'ACTIVE')
            """.trimIndent(),
            ownerId,
        )
        val sessionId = UUID.randomUUID()
        val outlet = providers.submitOutlet(
            Principal(ownerId, Role.MERCHANT, sessionId = sessionId),
            "Deleted Membership Merchant",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517508"),
            "m1-hardening-delete-replay",
        )
        assertEquals(1, ownerMembershipCount(jdbc, ownerId, outlet.id))

        jdbc.update(
            "DELETE FROM mypet.merchant_staff WHERE account_id = ? AND outlet_id = ? AND permission = 'OWNER'",
            ownerId,
            outlet.id,
        )
        assertEquals(0, ownerMembershipCount(jdbc, ownerId, outlet.id))
        val scopeLess = resolver.resolve(ownerId, sessionId)
        assertTrue(scopeLess.outletIds.isEmpty())

        val replay = providers.submitOutlet(
            scopeLess,
            "Deleted Membership Merchant",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517508"),
            "m1-hardening-delete-replay",
        )

        assertEquals(outlet.id, replay.id)
        assertEquals(0, ownerMembershipCount(jdbc, ownerId, outlet.id))
        assertTrue(resolver.resolve(ownerId, sessionId).outletIds.isEmpty())
    }

    private fun ownerMembershipCount(jdbc: JdbcTemplate, ownerId: UUID, outletId: UUID): Int =
        jdbc.queryForObject(
            """
            SELECT COUNT(*) FROM mypet.merchant_staff
            WHERE account_id = ? AND outlet_id = ? AND permission = 'OWNER'
            """.trimIndent(),
            Int::class.java,
            ownerId,
            outletId,
        ) ?: 0
}
