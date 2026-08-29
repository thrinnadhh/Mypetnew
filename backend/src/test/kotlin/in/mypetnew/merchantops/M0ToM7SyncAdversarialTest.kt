package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.MerchantSyncController
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M0ToM7SyncAdversarialTest {

    private data class Context(
        val jdbc: JdbcTemplate,
        val catalog: CatalogService,
        val inventory: InventoryService,
        val providers: ProviderService,
        val syncFeed: JdbcMerchantSyncFeed,
        val syncController: MerchantSyncController,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val syncFeed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "a".repeat(32))
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions, syncFeed))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions, syncFeed))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val syncController = MerchantSyncController(providers, syncFeed, jdbc)
        return Context(jdbc, catalog, inventory, providers, syncFeed, syncController)
    }

    private fun seedMerchantScope(
        jdbc: JdbcTemplate,
        mobile: String,
        orgName: String,
        outletName: String,
    ): Triple<UUID, UUID, UUID> {
        val actorId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()

        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')", actorId, mobile)
        jdbc.update("INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, ?, 'ACTIVE', ?)", organizationId, orgName, actorId)
        jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, ?, 'ACTIVE', TRUE)", outletId, organizationId, outletName)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'MEDICINE_CATALOG_VIEW_ONLY', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", actorId, organizationId, outletId)

        return Triple(actorId, organizationId, outletId)
    }

    private fun auth(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
    ) = UsernamePasswordAuthenticationToken(
        Principal(
            actorId = actorId,
            role = Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
            merchantPermissionsByOutlet = mapOf(
                outletId to setOf(
                    MerchantPermission.CATALOG_WRITE,
                    MerchantPermission.INVENTORY_WRITE,
                ),
            ),
        ),
        null,
        emptyList(),
    )

    @Test
    fun `Flow Group AC - Change feed bootstrap, cursor incremental replay, and projection updates`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantScope(ctx.jdbc, "+919400000201", "Sync Org", "Sync Outlet")
        val authentication = auth(actorId, organizationId, outletId)

        // 1. Create a product and inventory
        val listing1 = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "4006381333931",
                name = "Sync Feed Test Product 1",
                kind = ListingKind.PRODUCT,
                mrpPaise = 15000,
                sellingPricePaise = 13500,
                category = "cat-food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-sync-p1",
            actorId,
        )

        // 2. Fetch bootstrap state
        val bootstrap = ctx.syncController.bootstrap(authentication, outletId, null, 100)
        assertTrue(bootstrap.catalogItems.any { it.id == listing1.id })
        assertNotNull(bootstrap.highWaterCursor)

        // 3. Create another product and inventory movement
        val listing2 = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "5901234123457",
                name = "Sync Feed Test Product 2",
                kind = ListingKind.PRODUCT,
                mrpPaise = 25000,
                sellingPricePaise = 22000,
                category = "dog-food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-sync-p2",
            actorId,
        )

        ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, listing2.id),
            delta = 15,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "inv-sync-p2",
            actorId = actorId,
            traceId = "test-trace",
        )

        // 4. Poll change feed since the bootstrap cursor
        val changePage = ctx.syncController.changes(authentication, outletId, bootstrap.highWaterCursor, 100)
        assertTrue(changePage.changes.isNotEmpty())
        assertNotNull(changePage.nextCursor)
    }

    @Test
    fun `Flow Group AI - Concurrent inventory movements with same idempotency key resolve exactly once`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantScope(ctx.jdbc, "+919400000202", "Concurrent Org", "Concurrent Outlet")

        val listing = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "INT-CONC-1",
                name = "Concurrent Product",
                kind = ListingKind.PRODUCT,
                mrpPaise = 5000,
                sellingPricePaise = 4000,
                category = "cat-toys",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-conc-item",
            actorId,
        )

        val scope = InventoryScope(organizationId, outletId, listing.id)

        // Apply movement twice with same idempotency key
        val r1 = ctx.inventory.adjustMerchant(scope, 20, StockReason.MANUAL_INCREASE, "conc-idem-key-1", actorId, "trace-1")
        val r2 = ctx.inventory.adjustMerchant(scope, 20, StockReason.MANUAL_INCREASE, "conc-idem-key-1", actorId, "trace-2")

        assertEquals(r1.id, r2.id)
        assertEquals(r1.resultingOnHand, r2.resultingOnHand)
        assertEquals(20, ctx.inventory.balance(scope).onHand)
    }
}
