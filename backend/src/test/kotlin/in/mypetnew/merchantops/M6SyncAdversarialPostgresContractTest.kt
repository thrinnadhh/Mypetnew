package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryBalance
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.domain.MerchantSyncPublisher
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.ConcurrentScenarioRunner
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M6SyncAdversarialPostgresContractTest {

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
        val syncFeed = JdbcMerchantSyncFeed(jdbc)
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
        jdbc.update("INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M6 Adv Org', 'ACTIVE', ?)", organizationId, actorId)
        jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M6 Adv Outlet', 'ACTIVE', TRUE)", outletId, organizationId)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", actorId, organizationId, outletId)
        return organizationId to outletId
    }

    @Test
    fun `M6-SYNC-002 replay returns existing terminal receipt without re-execution when previously accepted`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000001")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-REPLAY-1",
                name = "Replay Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 450,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "replay_item_1",
            actorId,
        )

        // Adjust stock first time
        val mov1 = ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item.id),
            delta = 10,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "replay_adj_key",
            actorId = actorId,
            traceId = "trace-replay-1",
        )
        assertEquals(10, mov1.resultingOnHand)

        // Replay same adjustment with same idempotency key and actor
        val mov2 = ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item.id),
            delta = 10,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "replay_adj_key",
            actorId = actorId,
            traceId = "trace-replay-2",
        )
        assertEquals(mov1.id, mov2.id)
        assertEquals(10, mov2.resultingOnHand)

        // Verify ledger has exactly 1 entry
        val count = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key = ?",
            Long::class.java,
            "replay_adj_key",
        )
        assertEquals(1L, count)
    }

    @Test
    fun `M6-SYNC-002 replaying with modified payload throws IDEMPOTENCY_FINGERPRINT_MISMATCH`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000002")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-FP-1",
                name = "Fingerprint Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 450,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "fp_item_1",
            actorId,
        )

        ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item.id),
            delta = 10,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "fp_key_1",
            actorId = actorId,
            traceId = "trace-fp-1",
        )

        // Attempt replay with different delta (+20 instead of +10)
        val ex = assertThrows(DomainException::class.java) {
            ctx.inventory.adjustMerchant(
                scope = InventoryScope(organizationId, outletId, item.id),
                delta = 20, // Tampered!
                reason = StockReason.MANUAL_INCREASE,
                idempotencyKey = "fp_key_1",
                actorId = actorId,
                traceId = "trace-fp-2",
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", ex.code)
    }

    @Test
    fun `M6-SYNC-002 concurrent duplicate replays converge to exactly one ledger entry`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000003")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-CONC-1",
                name = "Concurrent Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 450,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "conc_item_1",
            actorId,
        )

        val results = ConcurrentScenarioRunner.run(8) {
            ctx.inventory.adjustMerchant(
                scope = InventoryScope(organizationId, outletId, item.id),
                delta = 5,
                reason = StockReason.MANUAL_INCREASE,
                idempotencyKey = "concurrent_key_1",
                actorId = actorId,
                traceId = "trace-conc",
            )
        }

        assertEquals(8, results.successes.size)
        val firstId = results.successes.first().id
        results.successes.forEach {
            assertEquals(firstId, it.id)
            assertEquals(5, it.resultingOnHand)
        }

        // Ledger has exactly 1 entry
        val count = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key = ?",
            Long::class.java,
            "concurrent_key_1",
        )
        assertEquals(1L, count)
    }

    @Test
    fun `M6-SYNC-002 transaction rolls back completely when change publisher fails`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000004")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        val failingPublisher = object : MerchantSyncPublisher {
            override fun publishCatalogItemChange(listing: Listing, isTombstone: Boolean) {
                throw RuntimeException("SIMULATED_CHANGE_PUBLISHER_FAILURE")
            }
            override fun publishBarcodeChange(organizationId: UUID, outletId: UUID, listingId: UUID, barcodeType: BarcodeType, normalizedBarcode: String, isPrimary: Boolean, isTombstone: Boolean, updatedAt: Instant) {
                throw RuntimeException("SIMULATED_CHANGE_PUBLISHER_FAILURE")
            }
            override fun publishInventoryBalanceChange(balance: InventoryBalance, isTombstone: Boolean) {
                throw RuntimeException("SIMULATED_CHANGE_PUBLISHER_FAILURE")
            }
        }

        val failingCatalog = CatalogService(JdbcCatalogPersistence(ctx.jdbc, ctx.transactions, failingPublisher))
        val failingInventory = InventoryService(JdbcInventoryPersistence(ctx.jdbc, ctx.transactions, failingPublisher))

        // 1. Catalog creation fails and rolls back
        assertThrows(RuntimeException::class.java) {
            failingCatalog.createListing(
                CreateListingCommand(
                    organizationId = organizationId,
                    outletId = outletId,
                    barcodeType = BarcodeType.INTERNAL,
                    barcode = "SKU-FAIL-1",
                    name = "Failing Item",
                    kind = ListingKind.PRODUCT,
                    mrpPaise = 500,
                    sellingPricePaise = 450,
                    category = "food",
                    capabilities = setOf(ProviderCapability.PRODUCT_STORE),
                ),
                "fail_action_1",
                actorId,
            )
        }

        val listingCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.catalog_listing WHERE normalized_barcode = 'SKU-FAIL-1'",
            Long::class.java,
        )
        assertEquals(0L, listingCount)

        // 2. Inventory adjustment fails and rolls back
        val legitimateListing = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-LEGIT-1",
                name = "Legit Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 450,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "legit_action_1",
            actorId,
        )

        assertThrows(RuntimeException::class.java) {
            failingInventory.adjustMerchant(
                scope = InventoryScope(organizationId, outletId, legitimateListing.id),
                delta = 10,
                reason = StockReason.MANUAL_INCREASE,
                idempotencyKey = "fail_inv_key",
                actorId = actorId,
                traceId = "trace-fail",
            )
        }

        // Ledger has 0 movements and onHand is 0
        val movCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key = 'fail_inv_key'",
            Long::class.java,
        )
        assertEquals(0L, movCount)
        val onHand = ctx.jdbc.queryForObject(
            "SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?",
            Int::class.java,
            legitimateListing.id,
        )
        assertEquals(0, onHand)
    }

    @Test
    fun `M6-SYNC-001 no-gap bootstrap concurrency captures high water mark correctly`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000005")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-NOGAP-1",
                name = "No Gap Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 450,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "nogap_item_1",
            actorId,
        )

        // Bootstrap snapshot
        val bootstrap = ctx.syncFeed.fetchBootstrap(organizationId, outletId)
        assertNotNull(bootstrap.highWaterCursor)

        // Subsequent mutation after bootstrap snapshot
        ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item.id),
            delta = 15,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "post_bootstrap_key",
            actorId = actorId,
            traceId = "trace-post-boot",
        )

        // Fetching changes with bootstrap's highWaterCursor returns the new mutation without gaps
        val changes = ctx.syncFeed.fetchChanges(organizationId, outletId, bootstrap.highWaterCursor, 100)
        assertEquals(1, changes.changes.size)
        assertEquals(item.id, changes.changes[0].entityId)
    }
}
