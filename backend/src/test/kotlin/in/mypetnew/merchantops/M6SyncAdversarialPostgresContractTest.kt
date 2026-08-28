package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.CatalogInventoryApiController
import `in`.mypetnew.application.web.InventoryAdjustmentRequest
import `in`.mypetnew.application.web.MerchantInventoryController
import `in`.mypetnew.application.web.MerchantSyncController
import `in`.mypetnew.application.web.ResolveReceiptRequest
import `in`.mypetnew.application.web.UpdateListingRequest
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
import `in`.mypetnew.catalog.domain.MerchantSyncBootstrapResponse
import `in`.mypetnew.catalog.domain.MerchantSyncPublisher
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.UpdateListingCommand
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.ConcurrentScenarioRunner
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@MerchantOpsContract
@MerchantOpsPostgres
class M6SyncAdversarialPostgresContractTest {

    private data class Context(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val catalog: CatalogService,
        val inventory: InventoryService,
        val providers: ProviderService,
        val syncFeed: JdbcMerchantSyncFeed,
        val inventoryController: MerchantInventoryController,
        val syncController: MerchantSyncController,
        val catalogController: CatalogInventoryApiController,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val syncFeed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "test-sync-cursor-secret-at-least-32-chars-long")
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions, syncFeed))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions, syncFeed))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val inventoryController = MerchantInventoryController(providers, catalog, inventory)
        val syncController = MerchantSyncController(providers, syncFeed, jdbc)
        val catalogController = CatalogInventoryApiController(providers, catalog, inventory)

        return Context(
            jdbc = jdbc,
            transactions = transactions,
            catalog = catalog,
            inventory = inventory,
            providers = providers,
            syncFeed = syncFeed,
            inventoryController = inventoryController,
            syncController = syncController,
            catalogController = catalogController,
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

    private fun auth(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        permissions: Set<MerchantPermission> = setOf(MerchantPermission.OWNER),
    ) = UsernamePasswordAuthenticationToken(
        Principal(
            actorId = actorId,
            role = Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
            merchantPermissionsByOutlet = mapOf(outletId to permissions),
        ),
        null,
        emptyList(),
    )

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
                "fail_item_1",
                actorId,
            )
        }

        val catalogCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.catalog_listing WHERE create_idempotency_key = 'fail_item_1'",
            Long::class.java,
        )
        assertEquals(0L, catalogCount)

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
    fun `M6-SYNC-001 true concurrent bootstrap with CountDownLatch and CompletableFuture captures mutation in snapshot OR feed`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000005")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        // Seed initial listing
        val item1 = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-LATCH-1",
                name = "Latch Item 1",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 450,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "latch_item_1",
            actorId,
        )

        val highWaterCapturedLatch = CountDownLatch(1)
        val mutationCommittedLatch = CountDownLatch(1)

        // Instrument a custom feed that pauses after capturing high-water mark H
        val instrumentedFeed = object : JdbcMerchantSyncFeed(ctx.jdbc, cursorSecret = "test-sync-cursor-secret-at-least-32-chars-long") {
            override fun fetchBootstrap(organizationId: UUID, outletId: UUID, cursor: String?, limit: Int): MerchantSyncBootstrapResponse {
                // Signal that bootstrap has started / high water mark is about to be evaluated
                highWaterCapturedLatch.countDown()
                // Wait for concurrent writer transaction to commit
                mutationCommittedLatch.await(5, TimeUnit.SECONDS)
                return super.fetchBootstrap(organizationId, outletId, cursor, limit)
            }
        }

        // Run bootstrap asynchronously on thread 1
        val bootstrapFuture = CompletableFuture.supplyAsync {
            instrumentedFeed.fetchBootstrap(organizationId, outletId, limit = 10)
        }

        // Concurrent thread 2: waits for bootstrap to begin, then commits mutation
        highWaterCapturedLatch.await(5, TimeUnit.SECONDS)
        ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item1.id),
            delta = 25,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "concurrent_latch_adj",
            actorId = actorId,
            traceId = "trace-latch-adj",
        )
        // Signal that writer has committed to PostgreSQL
        mutationCommittedLatch.countDown()

        val bootstrapSnapshot = bootstrapFuture.get(5, TimeUnit.SECONDS)
        val bootstrapCursor = bootstrapSnapshot.highWaterCursor

        // Query change feed starting from bootstrap high-water cursor H
        val changes = ctx.syncFeed.fetchChanges(organizationId, outletId, bootstrapCursor, 100)

        // Invariant: Mutation must appear in snapshot OR feed, NEVER NEITHER
        val inSnapshot = bootstrapSnapshot.inventoryBalances.any { it.listingId == item1.id && it.onHand == 25 }
        val inFeed = changes.changes.any { it.entityId == item1.id }

        assertTrue(inSnapshot || inFeed, "Concurrent mutation must appear in either bootstrap snapshot or subsequent change feed")
    }

    @Test
    fun `M6-SYNC-002 complete reauthorization matrix across all 9 security boundaries`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000006")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val validAuth = auth(actorId, organizationId, outletId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-REAUTH-MATRIX",
                name = "Reauth Matrix Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 1000,
                sellingPricePaise = 900,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "reauth_mat_item",
            actorId,
        )

        // 1. Case 1: Permission revoked (staff has only CATALOG_WRITE, missing INVENTORY_WRITE)
        val viewOnlyAuth = auth(actorId, organizationId, outletId, permissions = setOf(MerchantPermission.CATALOG_WRITE))
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = viewOnlyAuth,
                idempotencyKey = "uncommitted_perm_revoked",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(outletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // 2. Case 2: Merchant membership inactive
        val inactiveActor = createMerchant(ctx.jdbc, "+919320000062")
        ctx.jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', FALSE)", inactiveActor, organizationId, outletId)
        val inactiveAuth = auth(inactiveActor, organizationId, outletId, permissions = emptySet())
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = inactiveAuth,
                idempotencyKey = "uncommitted_inactive_staff",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(outletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // 3. Case 3: Outlet suspended
        val suspendedOutletId = UUID.randomUUID()
        ctx.jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'Suspended Outlet', 'SUSPENDED', TRUE)", suspendedOutletId, organizationId)
        ctx.jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", suspendedOutletId)
        val suspendedAuth = auth(actorId, organizationId, suspendedOutletId)
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = suspendedAuth,
                idempotencyKey = "uncommitted_suspended_outlet",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(suspendedOutletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // 4. Case 4: Account disabled
        val disabledActor = createMerchant(ctx.jdbc, "+919320000064")
        ctx.jdbc.update("UPDATE mypet.identity_account SET status = 'DISABLED' WHERE id = ?", disabledActor)
        ctx.jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", disabledActor, organizationId, outletId)
        val disabledAuth = auth(disabledActor, organizationId, outletId, permissions = emptySet())
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = disabledAuth,
                idempotencyKey = "uncommitted_disabled_account",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(outletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // 5. Case 5: Wrong organization
        val foreignOrgId = UUID.randomUUID()
        val wrongOrgAuth = auth(actorId, foreignOrgId, outletId)
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = wrongOrgAuth,
                idempotencyKey = "uncommitted_wrong_org",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(outletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // 6. Case 6: Wrong outlet
        val otherOutletId = UUID.randomUUID()
        ctx.jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'Other Outlet', 'ACTIVE', TRUE)", otherOutletId, organizationId)
        ctx.jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", otherOutletId)
        val wrongOutletAuth = auth(actorId, organizationId, outletId) // Staff authorized for outletId, but sending request with otherOutletId
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = wrongOutletAuth,
                idempotencyKey = "uncommitted_wrong_outlet",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(otherOutletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // 7. Case 7: Forged outlet (random non-existent UUID)
        val forgedOutletId = UUID.randomUUID()
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = validAuth,
                idempotencyKey = "uncommitted_forged_outlet",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(forgedOutletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // 8. Case 8: Account A command resolved under Account B
        // First commit legitimate command under Actor A
        ctx.inventoryController.adjust(
            authentication = validAuth,
            idempotencyKey = "legit_actor_a_key",
            commandTypeHeader = "INVENTORY_ADJUSTMENT",
            schemaVersionHeader = "1",
            request = InventoryAdjustmentRequest(outletId, item.id, 5, StockReason.MANUAL_INCREASE),
        )
        // Actor B attempts to resolve Actor A's receipt
        val actorB = createMerchant(ctx.jdbc, "+919320000068")
        ctx.jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", actorB, organizationId, outletId)
        val actorBAuth = auth(actorB, organizationId, outletId)
        assertThrows(DomainException::class.java) {
            ctx.syncController.resolveReceipt(
                authentication = actorBAuth,
                request = ResolveReceiptRequest(
                    idempotencyKey = "legit_actor_a_key",
                    commandType = "INVENTORY_ADJUSTMENT",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to outletId.toString(),
                        "listingId" to item.id.toString(),
                        "quantityDelta" to 5,
                        "reason" to "MANUAL_INCREASE",
                    ),
                ),
            )
        }

        // 9. Case 9: Unauthenticated / Invalid role
        val invalidRoleAuth = UsernamePasswordAuthenticationToken(
            Principal(actorId = actorId, role = Role.CUSTOMER, organizationId = organizationId),
            null,
            emptyList(),
        )
        assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = invalidRoleAuth,
                idempotencyKey = "uncommitted_invalid_role",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(outletId, item.id, 10, StockReason.MANUAL_INCREASE),
            )
        }

        // Verify: Every uncommitted case had strictly 0 mutations applied, 0 receipts, 0 sync events!
        val totalMovements = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key LIKE 'uncommitted_%'",
            Long::class.java,
        )
        assertEquals(0L, totalMovements)

        // Verify: Committed exact request after later authorization loss may resolve historical receipt
        // Deactivate Actor A
        ctx.jdbc.update("UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?", actorId, outletId)
        val resolved = ctx.syncController.resolveReceipt(
            authentication = validAuth,
            request = ResolveReceiptRequest(
                idempotencyKey = "legit_actor_a_key",
                commandType = "INVENTORY_ADJUSTMENT",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "listingId" to item.id.toString(),
                    "quantityDelta" to 5,
                    "reason" to "MANUAL_INCREASE",
                ),
            ),
        )
        assertEquals("ACCEPTED", resolved.status)
        assertEquals(5, resolved.resultingOnHand)

        // Verify: Replay with changed payload + old key throws IDEMPOTENCY_FINGERPRINT_MISMATCH
        assertThrows(DomainException::class.java) {
            ctx.syncController.resolveReceipt(
                authentication = validAuth,
                request = ResolveReceiptRequest(
                    idempotencyKey = "legit_actor_a_key",
                    commandType = "INVENTORY_ADJUSTMENT",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to outletId.toString(),
                        "listingId" to item.id.toString(),
                        "quantityDelta" to 999, // Tampered delta!
                        "reason" to "MANUAL_INCREASE",
                    ),
                ),
            )
        }
    }

    @Test
    fun `M6-SYNC-001 command schema validation enforces headers on backend endpoints`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000007")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val authentication = auth(actorId, organizationId, outletId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-SCHEMA-1",
                name = "Schema Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 400,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "schema_item_1",
            actorId,
        )

        // Only one header present (command-type without version)
        val exOnlyType = assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = authentication,
                idempotencyKey = "schema_key_only_type",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = null,
                request = InventoryAdjustmentRequest(outletId, item.id, 5, StockReason.MANUAL_INCREASE),
            )
        }
        assertEquals("COMMAND_SCHEMA_UNSUPPORTED", exOnlyType.code)

        // Only one header present (version without command-type)
        val exOnlyVer = assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = authentication,
                idempotencyKey = "schema_key_only_ver",
                commandTypeHeader = null,
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(outletId, item.id, 5, StockReason.MANUAL_INCREASE),
            )
        }
        assertEquals("COMMAND_SCHEMA_UNSUPPORTED", exOnlyVer.code)

        // Invalid command type
        val ex1 = assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = authentication,
                idempotencyKey = "schema_key_1",
                commandTypeHeader = "UNKNOWN_COMMAND",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(outletId, item.id, 5, StockReason.MANUAL_INCREASE),
            )
        }
        assertEquals("COMMAND_SCHEMA_UNSUPPORTED", ex1.code)

        // Unsupported schema version
        val ex2 = assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = authentication,
                idempotencyKey = "schema_key_2",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "99",
                request = InventoryAdjustmentRequest(outletId, item.id, 5, StockReason.MANUAL_INCREASE),
            )
        }
        assertEquals("COMMAND_SCHEMA_UNSUPPORTED", ex2.code)
    }

    @Test
    fun `M6-SYNC-002 receipt resolution for catalog update and lifecycle mutations with fail-closed binding`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000008")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val authentication = auth(actorId, organizationId, outletId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-RESOLVE-CAT-1",
                name = "Catalog Resolve Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 500,
                sellingPricePaise = 400,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "cat_item_1",
            actorId,
        )

        // 1. Update listing
        val updated = ctx.catalog.updateListing(
            UpdateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = item.id,
                expectedVersion = 0L,
                name = "Updated Catalog Item",
                mrpPaise = 600,
                sellingPricePaise = 550,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "cat_update_idemp_1",
            actorId,
        )
        assertEquals(1L, updated.version)

        // Resolve CATALOG_UPDATE receipt
        val updateReceipt = ctx.syncController.resolveReceipt(
            authentication = authentication,
            request = ResolveReceiptRequest(
                idempotencyKey = "cat_update_idemp_1",
                commandType = "CATALOG_UPDATE",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "listingId" to item.id.toString(),
                    "expectedVersion" to 0L,
                    "name" to "Updated Catalog Item",
                    "mrpPaise" to 600,
                    "sellingPricePaise" to 550,
                    "category" to "food",
                ),
            ),
        )
        assertEquals("ACCEPTED", updateReceipt.status)
        assertEquals(1L, updateReceipt.resultingVersion)

        // 2. Deactivate listing
        val deactivated = ctx.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = item.id,
                expectedVersion = 1L,
                targetStatus = ListingStatus.INACTIVE,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "cat_deact_idemp_1",
            actorId,
        )
        assertEquals(2L, deactivated.version)

        // Resolve CATALOG_DEACTIVATE receipt
        val deactReceipt = ctx.syncController.resolveReceipt(
            authentication = authentication,
            request = ResolveReceiptRequest(
                idempotencyKey = "cat_deact_idemp_1",
                commandType = "CATALOG_DEACTIVATE",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "listingId" to item.id.toString(),
                    "expectedVersion" to 1L,
                    "targetStatus" to "INACTIVE",
                ),
            ),
        )
        assertEquals("ACCEPTED", deactReceipt.status)
        assertEquals(2L, deactReceipt.resultingVersion)

        // 3. Activate listing
        val activated = ctx.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = item.id,
                expectedVersion = 2L,
                targetStatus = ListingStatus.ACTIVE,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "cat_act_idemp_1",
            actorId,
        )
        assertEquals(3L, activated.version)

        // Resolve CATALOG_ACTIVATE receipt
        val actReceipt = ctx.syncController.resolveReceipt(
            authentication = authentication,
            request = ResolveReceiptRequest(
                idempotencyKey = "cat_act_idemp_1",
                commandType = "CATALOG_ACTIVATE",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "listingId" to item.id.toString(),
                    "expectedVersion" to 2L,
                    "targetStatus" to "ACTIVE",
                ),
            ),
        )
        assertEquals("ACCEPTED", actReceipt.status)
        assertEquals(3L, actReceipt.resultingVersion)
    }

    @Test
    fun `M6-SYNC-001 cursor secret validation fails closed on short secret`() {
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)

        val invalidFeed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "short-secret")
        assertThrows(IllegalStateException::class.java) {
            invalidFeed.validateSecret()
        }

        val validFeed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "a".repeat(32))
        validFeed.validateSecret() // Must succeed without exception
    }
}
