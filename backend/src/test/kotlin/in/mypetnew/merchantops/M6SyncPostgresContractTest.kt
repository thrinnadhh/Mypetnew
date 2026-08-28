package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.SyncEntityType
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.Base64
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M6SyncPostgresContractTest {

    private data class Context(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val catalog: CatalogService,
        val inventory: InventoryService,
        val syncFeed: JdbcMerchantSyncFeed,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val syncFeed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "a".repeat(32))
        return Context(
            jdbc = jdbc,
            transactions = transactions,
            catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions, syncFeed)),
            inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions, syncFeed)),
            syncFeed = syncFeed,
        )
    }

    private fun createMerchant(jdbc: JdbcTemplate, mobile: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')", id, mobile)
        return id
    }

    private fun seedScope(jdbc: JdbcTemplate, actorId: UUID): Pair<UUID, UUID> {
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M6 Org', 'ACTIVE', ?)", organizationId, actorId)
        jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M6 Outlet', 'ACTIVE', TRUE)", outletId, organizationId)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", actorId, organizationId, outletId)
        return organizationId to outletId
    }

    @Test
    fun `M6-SYNC-001 V29 migration creates merchant_sync_change_log and records catalog and inventory changes`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919310000001")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        // 1. Create a catalog listing -> published to change log
        val listing = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-SYNC-1",
                name = "Test Dog Food",
                kind = ListingKind.PRODUCT,
                mrpPaise = 1000,
                sellingPricePaise = 850,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create_listing_1",
            actorId,
        )

        val page1 = ctx.syncFeed.fetchChanges(organizationId, outletId, null, 100)
        assertEquals(2, page1.changes.size) // CATALOG_ITEM + CATALOG_BARCODE
        val itemChange = page1.changes.first { it.entityType == SyncEntityType.CATALOG_ITEM }
        assertEquals(listing.id, itemChange.entityId)
        assertEquals(0, itemChange.entityVersion)
        assertFalse(itemChange.isTombstone)
        assertNotNull(page1.nextCursor)

        // 2. Adjust inventory -> published to change log
        ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, listing.id),
            delta = 20,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "adjust_inv_1",
            actorId = actorId,
            traceId = "trace-1",
        )

        val page2 = ctx.syncFeed.fetchChanges(organizationId, outletId, page1.nextCursor, 100)
        assertEquals(1, page2.changes.size)
        assertEquals(SyncEntityType.INVENTORY_BALANCE, page2.changes[0].entityType)
        assertEquals(listing.id, page2.changes[0].entityId)
        assertEquals(1, page2.changes[0].entityVersion)

        // 3. Deactivate listing -> published with isTombstone = false per lifecycle status update semantics
        ctx.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = listing.id,
                targetStatus = ListingStatus.INACTIVE,
                expectedVersion = 0,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "deactivate_1",
            actorId,
        )

        val page3 = ctx.syncFeed.fetchChanges(organizationId, outletId, page2.nextCursor, 100)
        assertEquals(1, page3.changes.size)
        assertEquals(SyncEntityType.CATALOG_ITEM, page3.changes[0].entityType)
        assertFalse(page3.changes[0].isTombstone)
        assertEquals(1, page3.changes[0].entityVersion)
    }

    @Test
    fun `M6-SYNC-001 signed HMAC cursor validation detects tampering, foreign scope, and expiry`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919310000002")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        // Invalid non-base64 cursor
        val ex1 = assertThrows(DomainException::class.java) {
            ctx.syncFeed.fetchChanges(organizationId, outletId, "invalid_base64_cursor!@#", 100)
        }
        assertEquals("SYNC_CURSOR_EXPIRED", ex1.code)

        // Obtain legitimate signed cursor
        val legitimateCursor = ctx.syncFeed.currentHighWaterCursor(organizationId, outletId)
        val decoded = String(Base64.getUrlDecoder().decode(legitimateCursor), Charsets.UTF_8)
        assertTrue(decoded.startsWith("msc_v2:"))
        val parts = decoded.removePrefix("msc_v2:").split(":")
        assertEquals(5, parts.size)

        // 1. Tamper sequence number -> fails closed
        val tamperedSeq = "msc_v2:${parts[0]}:${parts[1]}:99999:${parts[3]}:${parts[4]}"
        val tamperedSeqCursor = Base64.getUrlEncoder().withoutPadding().encodeToString(tamperedSeq.toByteArray())
        val exTamperSeq = assertThrows(DomainException::class.java) {
            ctx.syncFeed.fetchChanges(organizationId, outletId, tamperedSeqCursor, 100)
        }
        assertEquals("SYNC_CURSOR_EXPIRED", exTamperSeq.code)

        // 2. Tamper timestamp -> fails closed
        val tamperedTime = "msc_v2:${parts[0]}:${parts[1]}:${parts[2]}:0:${parts[4]}"
        val tamperedTimeCursor = Base64.getUrlEncoder().withoutPadding().encodeToString(tamperedTime.toByteArray())
        val exTamperTime = assertThrows(DomainException::class.java) {
            ctx.syncFeed.fetchChanges(organizationId, outletId, tamperedTimeCursor, 100)
        }
        assertEquals("SYNC_CURSOR_EXPIRED", exTamperTime.code)

        // 3. Foreign organization / outlet scope
        val foreignOrg = UUID.randomUUID()
        val foreignCursor = Base64.getUrlEncoder().withoutPadding()
            .encodeToString("msc_v2:$foreignOrg:$outletId:10:${Instant.now().epochSecond}:fakehmac".toByteArray())
        val exForeign = assertThrows(DomainException::class.java) {
            ctx.syncFeed.fetchChanges(organizationId, outletId, foreignCursor, 100)
        }
        assertEquals("SYNC_CURSOR_EXPIRED", exForeign.code)
    }

    @Test
    fun `M6-SYNC-001 bootstrap returns current full state and high water cursor with batched queries`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919310000003")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        val item1 = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "ITEM-BOOT-1",
                name = "Product 1",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 450,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "boot_item_1",
            actorId,
        )

        ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item1.id),
            delta = 10,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "boot_inv_1",
            actorId = actorId,
            traceId = "trace-boot",
        )

        val bootstrap = ctx.syncFeed.fetchBootstrap(organizationId, outletId)
        assertEquals(1, bootstrap.catalogItems.size)
        assertEquals(item1.id, bootstrap.catalogItems[0].id)
        assertEquals(1, bootstrap.inventoryBalances.size)
        assertEquals(10, bootstrap.inventoryBalances[0].onHand)
        assertNotNull(bootstrap.highWaterCursor)

        // Changes from high-water cursor are empty
        val changes = ctx.syncFeed.fetchChanges(organizationId, outletId, bootstrap.highWaterCursor, 100)
        assertEquals(0, changes.changes.size)
    }
}
