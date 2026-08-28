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
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M6ConnectedUnknownOutcomePostgresContractTest {

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
    fun `M6-SYNC-001 unknown outcome recovery converges on restart and produces exactly one canonical server effect`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000001")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-UO-1",
                name = "Unknown Outcome Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 1000,
                sellingPricePaise = 900,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "uo_item_1",
            actorId,
        )

        // Step 1: Client dispatches command. Server processes and commits to Postgres.
        val mov = ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item.id),
            delta = 15,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "uo_key_1",
            actorId = actorId,
            traceId = "trace-uo-1",
        )
        assertEquals(15, mov.resultingOnHand)

        // Step 2: Simulate network drop / process crash on client side before receipt reached SQLite.
        // Step 3: Client restarts, outbox discovers command in RETRYABLE/SENDING state.
        // Step 4: Client replays command to server with identical Idempotency-Key and payload.
        val recoveredMov = ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item.id),
            delta = 15,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "uo_key_1",
            actorId = actorId,
            traceId = "trace-uo-2",
        )

        // Step 5: Verify identical movement ID and onHand returned
        assertEquals(mov.id, recoveredMov.id)
        assertEquals(15, recoveredMov.resultingOnHand)

        // Step 6: Verify PostgreSQL state is strictly singular:
        // Exactly 1 movement in inventory_movement
        val movementCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key = ?",
            Long::class.java,
            "uo_key_1",
        )
        assertEquals(1L, movementCount)

        // Balance on_hand is exactly 15
        val balanceOnHand = ctx.jdbc.queryForObject(
            "SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?",
            Int::class.java,
            item.id,
        )
        assertEquals(15, balanceOnHand)

        // Exactly 1 receipt in inventory_command_receipt
        val receiptCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_command_receipt WHERE idempotency_key = ?",
            Long::class.java,
            "uo_key_1",
        )
        assertEquals(1L, receiptCount)
    }
}
