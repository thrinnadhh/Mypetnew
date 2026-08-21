package `in`.mypetnew.merchantops

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Authorizer
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import javax.sql.DataSource

@MerchantOpsContract
@MerchantOpsPostgres
class M1MerchantAuthorityPostgresContractTest {
    @Test
    fun `persistent onboarding grants owner scope and rejects a foreign outlet`() {
        val context = context()
        val merchantA = createMerchant(context.jdbc, "+919100000001")
        val outletA = context.providers.submitOutlet(
            Principal(merchantA, Role.MERCHANT),
            "Merchant A",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517501"),
            "m1-submit-a",
        )

        assertEquals(
            1,
            context.jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM mypet.merchant_staff
                WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
                  AND permission = 'OWNER' AND active = TRUE
                """.trimIndent(),
                Int::class.java,
                merchantA,
                outletA.organizationId,
                outletA.id,
            ),
        )

        val replay = context.providers.submitOutlet(
            Principal(merchantA, Role.MERCHANT),
            "Merchant A",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517501"),
            "m1-submit-a",
        )
        assertEquals(outletA.id, replay.id)
        assertEquals(
            1,
            context.jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM mypet.merchant_staff
                WHERE account_id = ? AND outlet_id = ? AND permission = 'OWNER'
                """.trimIndent(),
                Int::class.java,
                merchantA,
                outletA.id,
            ),
        )

        approve(context.providers, outletA.id, "m1-approve-a")
        val principalA = context.resolver.resolve(merchantA, UUID.randomUUID())
        assertEquals(outletA.organizationId, principalA.organizationId)
        assertEquals(setOf(outletA.id), principalA.outletIds)
        assertEquals(
            setOf(MerchantPermission.OWNER),
            principalA.merchantPermissionsByOutlet[outletA.id],
        )
        context.providers.requireActiveOutlet(principalA, outletA.id, MerchantPermission.CATALOG_WRITE)

        val merchantB = createMerchant(context.jdbc, "+919100000002")
        val outletB = context.providers.submitOutlet(
            Principal(merchantB, Role.MERCHANT),
            "Merchant B",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517502"),
            "m1-submit-b",
        )
        approve(context.providers, outletB.id, "m1-approve-b")

        assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(principalA, outletB.id, MerchantPermission.CATALOG_WRITE)
        }
    }

    @Test
    fun `permission membership and suspended outlet changes fail closed on reauthorization`() {
        val context = context()
        val ownerId = createMerchant(context.jdbc, "+919100000003")
        val outlet = context.providers.submitOutlet(
            Principal(ownerId, Role.MERCHANT),
            "Authority Outlet",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517503"),
            "m1-submit-authority",
        )
        approve(context.providers, outlet.id, "m1-approve-authority")

        val staffId = createMerchant(context.jdbc, "+919100000004")
        listOf(MerchantPermission.CATALOG_WRITE, MerchantPermission.INVENTORY_WRITE).forEach { permission ->
            context.jdbc.update(
                """
                INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active)
                VALUES (?, ?, ?, ?, TRUE)
                """.trimIndent(),
                staffId,
                outlet.organizationId,
                outlet.id,
                permission.name,
            )
        }

        val stalePrincipal = context.resolver.resolve(staffId, UUID.randomUUID())
        context.providers.requireActiveOutlet(stalePrincipal, outlet.id, MerchantPermission.INVENTORY_WRITE)

        context.jdbc.update(
            """
            UPDATE mypet.merchant_staff SET active = FALSE
            WHERE account_id = ? AND outlet_id = ? AND permission = 'INVENTORY_WRITE'
            """.trimIndent(),
            staffId,
            outlet.id,
        )
        val afterPermissionRevocation = context.resolver.reauthorize(stalePrincipal)
        context.providers.requireActiveOutlet(
            afterPermissionRevocation,
            outlet.id,
            MerchantPermission.CATALOG_WRITE,
        )
        assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(
                afterPermissionRevocation,
                outlet.id,
                MerchantPermission.INVENTORY_WRITE,
            )
        }

        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", outlet.id)
        val afterSuspension = context.resolver.reauthorize(afterPermissionRevocation)
        Authorizer.requireOutlet(afterSuspension, outlet.id)
        assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(afterSuspension, outlet.id, MerchantPermission.CATALOG_WRITE)
        }

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            staffId,
            outlet.id,
        )
        val afterMembershipRevocation = context.resolver.reauthorize(afterSuspension)
        assertTrue(afterMembershipRevocation.outletIds.isEmpty())
        assertThrows(DomainException::class.java) {
            Authorizer.requireOutlet(afterMembershipRevocation, outlet.id)
        }
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val providers = ProviderService(
            JdbcProviderPersistence(
                jdbc,
                TransactionTemplate(DataSourceTransactionManager(dataSource)),
            ),
        )
        return Context(
            dataSource = dataSource,
            jdbc = jdbc,
            providers = providers,
            resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource)),
        )
    }

    private fun createMerchant(jdbc: JdbcTemplate, mobile: String): UUID {
        val accountId = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.identity_account(id, mobile_e164, role, status)
            VALUES (?, ?, 'MERCHANT', 'ACTIVE')
            """.trimIndent(),
            accountId,
            mobile,
        )
        return accountId
    }

    private fun approve(providers: ProviderService, outletId: UUID, key: String) {
        providers.approveOutlet(
            Principal(
                actorId = UUID.randomUUID(),
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW),
            ),
            outletId,
            key,
        )
    }

    private data class Context(
        val dataSource: DataSource,
        val jdbc: JdbcTemplate,
        val providers: ProviderService,
        val resolver: JdbcMerchantPrincipalResolver,
    )
}
