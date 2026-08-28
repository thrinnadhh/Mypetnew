package `in`.mypetnew.merchantops

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
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.ConcurrentScenarioRunner
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
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
}
