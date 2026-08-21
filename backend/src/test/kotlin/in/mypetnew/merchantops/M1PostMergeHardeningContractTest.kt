package `in`.mypetnew.merchantops

import `in`.mypetnew.common.auth.AdminPermission
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

@MerchantOpsContract
@MerchantOpsPostgres
class M1PostMergeHardeningContractTest {
    @Test
    fun `onboarding replay remains identical after owner scope materializes`() {
        val context = context()
        val ownerId = createMerchant(context.jdbc, "+919200000001")
        val sessionId = UUID.randomUUID()
        val first = context.providers.submitOutlet(
            Principal(ownerId, Role.MERCHANT, sessionId = sessionId),
            "Replay Stable Merchant",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517501"),
            "m1-hardening-replay",
        )

        val reauthorized = context.resolver.resolve(ownerId, sessionId)
        assertEquals(first.organizationId, reauthorized.organizationId)
        assertEquals(setOf(first.id), reauthorized.outletIds)
        assertEquals(setOf(MerchantPermission.OWNER), reauthorized.merchantPermissionsByOutlet[first.id])

        val replay = context.providers.submitOutlet(
            reauthorized,
            "Replay Stable Merchant",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517501"),
            "m1-hardening-replay",
        )

        assertEquals(first.id, replay.id)
        assertEquals(
            1,
            context.jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM mypet.provider_outlet
                WHERE submitted_by_actor_id = ? AND submission_idempotency_key = ?
                """.trimIndent(),
                Int::class.java,
                ownerId,
                "m1-hardening-replay",
            ),
        )
        assertEquals(
            1,
            context.jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM mypet.merchant_staff
                WHERE account_id = ? AND outlet_id = ? AND permission = 'OWNER'
                """.trimIndent(),
                Int::class.java,
                ownerId,
                first.id,
            ),
        )
    }

    @Test
    fun `current owner may add an outlet but revoked owner cannot regain authority through onboarding`() {
        val context = context()
        val ownerId = createMerchant(context.jdbc, "+919200000002")
        val first = context.providers.submitOutlet(
            Principal(ownerId, Role.MERCHANT),
            "Authority Merchant",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517502"),
            "m1-hardening-first",
        )
        val currentOwner = context.resolver.resolve(ownerId, UUID.randomUUID())

        val second = context.providers.submitOutlet(
            currentOwner,
            "Authority Merchant Second",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517503"),
            "m1-hardening-second",
        )
        assertEquals(first.organizationId, second.organizationId)
        assertEquals(
            1,
            context.jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM mypet.merchant_staff
                WHERE account_id = ? AND outlet_id = ? AND permission = 'OWNER' AND active = TRUE
                """.trimIndent(),
                Int::class.java,
                ownerId,
                second.id,
            ),
        )

        context.jdbc.update(
            """
            UPDATE mypet.merchant_staff SET active = FALSE
            WHERE account_id = ? AND permission = 'OWNER'
            """.trimIndent(),
            ownerId,
        )
        context.jdbc.update(
            """
            INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active)
            VALUES (?, ?, ?, 'CATALOG_WRITE', TRUE)
            ON CONFLICT (account_id, outlet_id, permission) DO UPDATE SET active = TRUE
            """.trimIndent(),
            ownerId,
            first.organizationId,
            first.id,
        )

        val limited = context.resolver.reauthorize(currentOwner)
        assertEquals(first.organizationId, limited.organizationId)
        assertTrue(MerchantPermission.OWNER !in limited.merchantPermissionsByOutlet.values.flatten())
        val beforeLimitedAttempt = outletCount(context.jdbc, ownerId)
        val limitedFailure = assertThrows(DomainException::class.java) {
            context.providers.submitOutlet(
                limited,
                "Privilege Escalation Attempt",
                setOf(ProviderCapability.PRODUCT_STORE),
                setOf("517504"),
                "m1-hardening-limited",
            )
        }
        assertEquals("MERCHANT_PERMISSION_REQUIRED", limitedFailure.code)
        assertEquals(beforeLimitedAttempt, outletCount(context.jdbc, ownerId))

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ?",
            ownerId,
        )
        val scopeLessAfterRevocation = context.resolver.reauthorize(limited)
        assertEquals(null, scopeLessAfterRevocation.organizationId)
        assertTrue(scopeLessAfterRevocation.outletIds.isEmpty())
        val beforeScopeLessAttempt = outletCount(context.jdbc, ownerId)
        val scopeLessFailure = assertThrows(DomainException::class.java) {
            context.providers.submitOutlet(
                scopeLessAfterRevocation,
                "Revoked Owner Retry",
                setOf(ProviderCapability.PRODUCT_STORE),
                setOf("517505"),
                "m1-hardening-revoked-new",
            )
        }
        assertEquals("MERCHANT_PERMISSION_REQUIRED", scopeLessFailure.code)
        assertEquals(beforeScopeLessAttempt, outletCount(context.jdbc, ownerId))
        assertEquals(
            0,
            context.jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM mypet.merchant_staff
                WHERE account_id = ? AND permission = 'OWNER' AND active = TRUE
                """.trimIndent(),
                Int::class.java,
                ownerId,
            ),
        )
    }

    @Test
    fun `suspended outlet cannot mutate dispatch origin`() {
        val context = context()
        val ownerId = createMerchant(context.jdbc, "+919200000003")
        val outlet = context.providers.submitOutlet(
            Principal(ownerId, Role.MERCHANT),
            "Suspension Merchant",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517506"),
            "m1-hardening-dispatch",
        )
        val owner = context.resolver.resolve(ownerId, UUID.randomUUID())

        val configured = context.providers.configureDispatchOrigin(owner, outlet.id, 13.6288, 79.4192)
        assertEquals(13.6288, configured.latitude)
        assertEquals(79.4192, configured.longitude)

        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", outlet.id)
        val reauthorized = context.resolver.reauthorize(owner)
        val failure = assertThrows(DomainException::class.java) {
            context.providers.configureDispatchOrigin(reauthorized, outlet.id, 14.0, 80.0)
        }
        assertEquals("RESOURCE_NOT_FOUND", failure.code)

        val coordinates = context.jdbc.queryForMap(
            "SELECT dispatch_latitude, dispatch_longitude FROM mypet.provider_outlet WHERE id = ?",
            outlet.id,
        )
        assertEquals(13.6288, (coordinates["dispatch_latitude"] as Number).toDouble())
        assertEquals(79.4192, (coordinates["dispatch_longitude"] as Number).toDouble())
    }

    @Test
    fun `same onboarding key with changed payload still fails fingerprint validation`() {
        val context = context()
        val ownerId = createMerchant(context.jdbc, "+919200000004")
        val sessionId = UUID.randomUUID()
        context.providers.submitOutlet(
            Principal(ownerId, Role.MERCHANT, sessionId = sessionId),
            "Fingerprint Merchant",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517507"),
            "m1-hardening-fingerprint",
        )
        val current = context.resolver.resolve(ownerId, sessionId)

        val failure = assertThrows(DomainException::class.java) {
            context.providers.submitOutlet(
                current,
                "Fingerprint Merchant Changed",
                setOf(ProviderCapability.PRODUCT_STORE),
                setOf("517507"),
                "m1-hardening-fingerprint",
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", failure.code)
        assertEquals(1, outletCount(context.jdbc, ownerId))
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        return Context(
            jdbc = jdbc,
            providers = ProviderService(
                JdbcProviderPersistence(
                    jdbc,
                    TransactionTemplate(DataSourceTransactionManager(dataSource)),
                ),
            ),
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

    private fun outletCount(jdbc: JdbcTemplate, ownerId: UUID): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.provider_outlet WHERE submitted_by_actor_id = ?",
        Int::class.java,
        ownerId,
    ) ?: 0

    @Suppress("unused")
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
        val jdbc: JdbcTemplate,
        val providers: ProviderService,
        val resolver: JdbcMerchantPrincipalResolver,
    )
}
