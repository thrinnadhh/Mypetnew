package `in`.mypetnew.merchantops

import `in`.mypetnew.adminops.domain.AdminOperationPurpose
import `in`.mypetnew.adminops.domain.AdminOperationsService
import `in`.mypetnew.adminops.infrastructure.JdbcAdminOperationsPersistence
import `in`.mypetnew.application.web.InventoryAdjustmentRequest
import `in`.mypetnew.application.web.MerchantInventoryController
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import javax.sql.DataSource

@MerchantOpsContract
@MerchantOpsPostgres
class M12AdminControlPlanePostgresContractTest {
    @Test
    fun `provider approval is permission purpose reason and idempotency audited`() {
        val context = context()
        val scenario = context.fixture.create()
        context.jdbc.sql("UPDATE mypet.provider_outlet SET status = 'UNDER_REVIEW' WHERE id = ?")
            .param(scenario.outletId).update()
        context.jdbc.sql("UPDATE mypet.merchant_organization SET status = 'UNDER_REVIEW' WHERE id = ?")
            .param(scenario.organizationId).update()
        val admin = admin(AdminPermission.PROVIDER_REVIEW)
        val key = "m12-provider-approve"

        val wrongPurpose = assertThrows(DomainException::class.java) {
            context.service.approveOutlet(
                admin,
                scenario.outletId,
                AdminOperationPurpose.INVENTORY_INVESTIGATION,
                "Verified merchant evidence and ownership",
                key,
                "m12-purpose-check",
            )
        }
        assertEquals("ADMIN_PURPOSE_INVALID", wrongPurpose.code)
        assertEquals("UNDER_REVIEW", context.outletStatus(scenario.outletId))

        val shortReason = assertThrows(DomainException::class.java) {
            context.service.approveOutlet(
                admin,
                scenario.outletId,
                AdminOperationPurpose.PROVIDER_REVIEW,
                "short",
                key,
                "m12-reason-check",
            )
        }
        assertEquals("ADMIN_REASON_INVALID", shortReason.code)
        assertEquals("UNDER_REVIEW", context.outletStatus(scenario.outletId))

        val approved = context.service.approveOutlet(
            admin,
            scenario.outletId,
            AdminOperationPurpose.PROVIDER_REVIEW,
            "Verified merchant evidence and ownership",
            key,
            "m12-provider-approve-1",
        )
        assertEquals(ProviderStatus.ACTIVE, approved.status)
        assertEquals(1, context.auditCount(scenario.outletId, "ADMIN_PROVIDER_OUTLET_APPROVED"))

        val replay = context.service.approveOutlet(
            admin,
            scenario.outletId,
            AdminOperationPurpose.PROVIDER_REVIEW,
            "Verified merchant evidence and ownership",
            key,
            "m12-provider-approve-retry",
        )
        assertEquals(ProviderStatus.ACTIVE, replay.status)
        assertEquals(1, context.auditCount(scenario.outletId, "ADMIN_PROVIDER_OUTLET_APPROVED"))

        val mismatch = assertThrows(DomainException::class.java) {
            context.service.approveOutlet(
                admin,
                scenario.outletId,
                AdminOperationPurpose.PROVIDER_REVIEW,
                "Different approval rationale after replay",
                key,
                "m12-provider-approve-mismatch",
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", mismatch.code)
        assertEquals(1, context.auditCount(scenario.outletId, "ADMIN_PROVIDER_OUTLET_APPROVED"))
    }

    @Test
    fun `provider approval rolls back when audit persistence fails`() {
        val context = context()
        val scenario = context.fixture.create()
        context.jdbc.sql("UPDATE mypet.provider_outlet SET status = 'UNDER_REVIEW' WHERE id = ?")
            .param(scenario.outletId).update()
        context.jdbc.sql("UPDATE mypet.merchant_organization SET status = 'UNDER_REVIEW' WHERE id = ?")
            .param(scenario.organizationId).update()

        val failingPersistence = object : `in`.mypetnew.adminops.domain.AdminOperationsPersistence by context.persistence {
            override fun appendAudit(command: `in`.mypetnew.adminops.domain.AdminAuditCommand): `in`.mypetnew.adminops.domain.AdminAuditRecord {
                error("forced audit failure")
            }
        }
        val service = AdminOperationsService(failingPersistence, context.providers, context.transactionManager)

        assertThrows(IllegalStateException::class.java) {
            service.approveOutlet(
                admin(AdminPermission.PROVIDER_REVIEW),
                scenario.outletId,
                AdminOperationPurpose.PROVIDER_REVIEW,
                "Verified merchant evidence and ownership",
                "m12-atomic-approval",
                "m12-atomic-approval",
            )
        }
        assertEquals("UNDER_REVIEW", context.outletStatus(scenario.outletId))
        assertEquals(0, context.auditCount(scenario.outletId, "ADMIN_PROVIDER_OUTLET_APPROVED"))
    }

    @Test
    fun `admin inventory is tenant scoped bounded read only and access audited`() {
        val context = context()
        val own = context.fixture.create(onHand = 12, reserved = 3)
        val foreign = context.fixture.create(onHand = 99, reserved = 1)
        val admin = admin(AdminPermission.CATALOG_MODERATION)
        val movementCountBefore = context.movementCount()
        val ownBalanceBefore = context.balance(own.listingId)

        val page = context.service.inventory(
            admin,
            own.organizationId,
            own.outletId,
            AdminOperationPurpose.INVENTORY_INVESTIGATION,
            "Investigate reported stock discrepancy",
            0,
            100,
            "m12-inventory-view",
        )
        assertEquals(listOf(own.listingId), page.items.map { it.listingId })
        assertEquals(12, page.items.single().onHand)
        assertEquals(3, page.items.single().reserved)
        assertEquals(9, page.items.single().available)
        assertFalse(page.hasNext)
        assertEquals(movementCountBefore, context.movementCount())
        assertEquals(ownBalanceBefore, context.balance(own.listingId))
        assertEquals(1, context.auditCount(own.outletId, "ADMIN_INVENTORY_VIEWED"))

        val crossTenant = assertThrows(DomainException::class.java) {
            context.service.inventory(
                admin,
                own.organizationId,
                foreign.outletId,
                AdminOperationPurpose.INVENTORY_INVESTIGATION,
                "Investigate reported stock discrepancy",
                0,
                50,
                "m12-cross-tenant",
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", crossTenant.code)
        assertEquals(0, context.auditCount(foreign.outletId, "ADMIN_INVENTORY_VIEWED"))
        assertEquals(movementCountBefore, context.movementCount())

        assertEquals(
            "PAGE_SIZE_INVALID",
            assertThrows(DomainException::class.java) {
                context.service.inventory(
                    admin,
                    own.organizationId,
                    own.outletId,
                    AdminOperationPurpose.INVENTORY_INVESTIGATION,
                    "Investigate reported stock discrepancy",
                    0,
                    101,
                    "m12-page-bound",
                )
            }.code,
        )
    }

    @Test
    fun `audit trail is permission scoped target scoped and itself audited`() {
        val context = context()
        val own = context.fixture.create(onHand = 4)
        val foreign = context.fixture.create(onHand = 7)
        context.service.inventory(
            admin(AdminPermission.CATALOG_MODERATION),
            own.organizationId,
            own.outletId,
            AdminOperationPurpose.INVENTORY_INVESTIGATION,
            "Investigate merchant stock support case",
            0,
            50,
            "m12-seed-own-audit",
        )
        context.service.inventory(
            admin(AdminPermission.CATALOG_MODERATION),
            foreign.organizationId,
            foreign.outletId,
            AdminOperationPurpose.INVENTORY_INVESTIGATION,
            "Investigate separate merchant stock case",
            0,
            50,
            "m12-seed-foreign-audit",
        )

        val denied = assertThrows(DomainException::class.java) {
            context.service.auditTrail(
                admin(AdminPermission.CATALOG_MODERATION),
                own.organizationId,
                own.outletId,
                AdminOperationPurpose.AUDIT_REVIEW,
                "Review outlet admin access history",
                0,
                50,
                "m12-audit-denied",
            )
        }
        assertEquals("ADMIN_PERMISSION_REQUIRED", denied.code)

        val trail = context.service.auditTrail(
            admin(AdminPermission.AUDIT_VIEW),
            own.organizationId,
            own.outletId,
            AdminOperationPurpose.AUDIT_REVIEW,
            "Review outlet admin access history",
            0,
            50,
            "m12-audit-view",
        )
        assertTrue(trail.items.isNotEmpty())
        assertTrue(trail.items.all { it.targetId == own.outletId })
        assertFalse(trail.items.any { it.targetId == foreign.outletId })
        assertEquals(1, context.auditCount(own.outletId, "ADMIN_AUDIT_TRAIL_VIEWED"))
    }

    @Test
    fun `admin role cannot invoke merchant inventory mutation even with broad admin permissions`() {
        val controller = MerchantInventoryController(ProviderService(), CatalogService(), InventoryService())
        val authentication = UsernamePasswordAuthenticationToken(
            admin(*AdminPermission.entries.toTypedArray()),
            null,
        )
        val failure = assertThrows(DomainException::class.java) {
            controller.adjust(
                authentication,
                "m12-admin-stock-edit",
                null,
                null,
                InventoryAdjustmentRequest(
                    outletId = UUID.randomUUID(),
                    listingId = UUID.randomUUID(),
                    quantityDelta = 1,
                    reason = StockReason.MANUAL_INCREASE,
                    referenceType = "ADMIN",
                    referenceId = "forbidden",
                ),
            )
        }
        assertEquals("FORBIDDEN", failure.code)
    }

    private fun context(): TestContext {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcClient.create(dataSource)
        val jdbcTemplate = JdbcTemplate(dataSource)
        val transactionManager = DataSourceTransactionManager(dataSource)
        val transactions = TransactionTemplate(transactionManager)
        val providers = ProviderService(JdbcProviderPersistence(jdbcTemplate, transactions))
        val persistence = JdbcAdminOperationsPersistence(jdbc)
        return TestContext(
            dataSource = dataSource,
            jdbc = jdbc,
            fixture = MerchantScenarioFixture(dataSource),
            service = AdminOperationsService(persistence, providers, transactionManager),
            persistence = persistence,
            providers = providers,
            transactionManager = transactionManager,
        )
    }

    private fun admin(vararg permissions: AdminPermission) = Principal(
        actorId = UUID.randomUUID(),
        role = Role.ADMIN,
        permissions = permissions.toSet(),
    )

    private data class TestContext(
        val dataSource: DataSource,
        val jdbc: JdbcClient,
        val fixture: MerchantScenarioFixture,
        val service: AdminOperationsService,
        val persistence: JdbcAdminOperationsPersistence,
        val providers: ProviderService,
        val transactionManager: DataSourceTransactionManager,
    ) {
        fun outletStatus(outletId: UUID): String = jdbc.sql("SELECT status FROM mypet.provider_outlet WHERE id = ?")
            .param(outletId).query(String::class.java).single()

        fun auditCount(outletId: UUID, action: String): Int = jdbc.sql(
            "SELECT COUNT(*) FROM mypet.audit_event WHERE target_id = ? AND action = ?",
        ).params(outletId, action).query(Int::class.javaObjectType).single()

        fun movementCount(): Int = jdbc.sql("SELECT COUNT(*) FROM mypet.inventory_movement")
            .query(Int::class.javaObjectType).single()

        fun balance(listingId: UUID): Pair<Int, Int> = jdbc.sql(
            "SELECT on_hand, reserved FROM mypet.inventory_balance WHERE listing_id = ?",
        ).param(listingId).query { rs, _ -> rs.getInt("on_hand") to rs.getInt("reserved") }.single()
    }
}
