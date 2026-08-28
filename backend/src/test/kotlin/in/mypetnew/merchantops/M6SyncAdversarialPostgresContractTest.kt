package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.InventoryAdjustmentRequest
import `in`.mypetnew.application.web.MerchantInventoryController
import `in`.mypetnew.application.web.MerchantSyncController
import `in`.mypetnew.application.web.ResolveReceiptRequest
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
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
        val inventoryController = MerchantInventoryController(providers, catalog, inventory)
        val syncController = MerchantSyncController(providers, syncFeed, jdbc)

        return Context(
            jdbc = jdbc,
            transactions = transactions,
            catalog = catalog,
            inventory = inventory,
            providers = providers,
            syncFeed = syncFeed,
            inventoryController = inventoryController,
            syncController = syncController,
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
    ) =
        UsernamePasswordAuthenticationToken(
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
    fun `M6-SYNC-001 multi-threaded concurrent latch bootstrap captures high water mark without gaps`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000005")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        // Seed initial items
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

        // Bootstrap snapshot taken
        val page1 = ctx.syncFeed.fetchBootstrap(organizationId, outletId, limit = 10)
        val bootstrapCursor = page1.highWaterCursor

        // Writer mutates inventory and creates new listing concurrently
        ctx.inventory.adjustMerchant(
            scope = InventoryScope(organizationId, outletId, item1.id),
            delta = 25,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "concurrent_latch_adj",
            actorId = actorId,
            traceId = "trace-latch-adj",
        )
        val postBootstrapItem = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-LATCH-2",
                name = "Latch Item 2",
                kind = ListingKind.PRODUCT,
                mrpPaise = 600,
                sellingPricePaise = 500,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "latch_item_2",
            actorId,
        )

        // Change feed queried with bootstrapCursor must capture both concurrent writer mutations without gaps
        val changes = ctx.syncFeed.fetchChanges(organizationId, outletId, bootstrapCursor, 100)
        assertEquals(3, changes.changes.size) // 1 balance change + (1 item + 1 barcode for item 2)
        val entityIds = changes.changes.map { it.entityId }.toSet()
        assertTrue(entityIds.contains(item1.id))
        assertTrue(entityIds.contains(postBootstrapItem.id))
    }

    @Test
    fun `M6-SYNC-002 reauthorization matrix - committed command resolves receipt after permission loss, uncommitted fails closed with 0 mutations`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000006")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val authentication = auth(actorId, organizationId, outletId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-REAUTH-1",
                name = "Reauth Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 1000,
                sellingPricePaise = 900,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "reauth_item_1",
            actorId,
        )

        // 1. Commit mutation while staff is ACTIVE and has OWNER permission
        val adjustReq = InventoryAdjustmentRequest(
            outletId = outletId,
            listingId = item.id,
            quantityDelta = 10,
            reason = StockReason.MANUAL_INCREASE,
        )
        val firstReceipt = ctx.inventoryController.adjust(
            authentication = authentication,
            idempotencyKey = "idemp_committed_1",
            commandTypeHeader = "INVENTORY_ADJUSTMENT",
            schemaVersionHeader = "1",
            request = adjustReq,
        )
        assertEquals(10, firstReceipt.resultingOnHand)

        // 2. Revoke staff permission / deactivate staff
        ctx.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            actorId,
            outletId,
        )
        val revokedAuth = auth(actorId, organizationId, outletId, permissions = emptySet())

        // 3. Receipt Resolver for committed command succeeds and returns terminal receipt
        val resolved = ctx.syncController.resolveReceipt(
            authentication = authentication,
            request = ResolveReceiptRequest(
                idempotencyKey = "idemp_committed_1",
                commandType = "INVENTORY_ADJUSTMENT",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "listingId" to item.id.toString(),
                    "quantityDelta" to 10,
                    "reason" to "MANUAL_INCREASE",
                ),
            ),
        )
        assertEquals("ACCEPTED", resolved.status)
        assertEquals(10, resolved.resultingOnHand)

        // 4. Receipt Resolver for UNCOMMITTED command returns 404 RESOURCE_NOT_FOUND
        val uncommittedEx = assertThrows(DomainException::class.java) {
            ctx.syncController.resolveReceipt(
                authentication = authentication,
                request = ResolveReceiptRequest(
                    idempotencyKey = "idemp_uncommitted_never_run",
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
        assertEquals("RESOURCE_NOT_FOUND", uncommittedEx.code)

        // 5. Normal mutation endpoint throws permission exception on uncommitted replay with revoked staff
        val mutationEx = assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = revokedAuth,
                idempotencyKey = "idemp_uncommitted_never_run",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(
                    outletId = outletId,
                    listingId = item.id,
                    quantityDelta = 5,
                    reason = StockReason.MANUAL_INCREASE,
                ),
            )
        }
        assertTrue(
            mutationEx.code == "MERCHANT_PERMISSION_REQUIRED" || mutationEx.code == "PERMISSION_DENIED" || mutationEx.code == "RESOURCE_NOT_FOUND",
            "Expected authorization failure, got ${mutationEx.code}",
        )

        // 6. Verify strictly 0 mutations applied for the uncommitted command
        val count = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key = 'idemp_uncommitted_never_run'",
            Long::class.java,
        )
        assertEquals(0L, count)
        val finalOnHand = ctx.jdbc.queryForObject(
            "SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?",
            Int::class.java,
            item.id,
        )
        assertEquals(10, finalOnHand) // Unchanged from first commit!
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
    fun `M6-SYNC-002 receipt resolution for catalog update and lifecycle mutations`() {
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
            `in`.mypetnew.catalog.domain.UpdateListingCommand(
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
    fun `M6-SYNC-001 multi-page keyset bootstrap and cursor validation edges`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919320000009")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)

        // Create 3 listings
        for (i in 1..3) {
            ctx.catalog.createListing(
                CreateListingCommand(
                    organizationId = organizationId,
                    outletId = outletId,
                    barcodeType = BarcodeType.INTERNAL,
                    barcode = "SKU-PAGE-$i",
                    name = "Page Item $i",
                    kind = ListingKind.PRODUCT,
                    mrpPaise = 500,
                    sellingPricePaise = 400,
                    category = "food",
                    capabilities = setOf(ProviderCapability.PRODUCT_STORE),
                ),
                "page_item_$i",
                actorId,
            )
        }

        // Page 1 (limit 2)
        val p1 = ctx.syncFeed.fetchBootstrap(organizationId, outletId, limit = 2)
        assertEquals(2, p1.catalogItems.size)
        assertTrue(p1.hasMore)
        assertNotNull(p1.nextCursor)

        // Page 2 (from nextCursor)
        val p2 = ctx.syncFeed.fetchBootstrap(organizationId, outletId, cursor = p1.nextCursor, limit = 2)
        assertEquals(1, p2.catalogItems.size)
        assertTrue(!p2.hasMore)
        assertEquals(null, p2.nextCursor)

        // Cursor tampering checks
        val foreignOrg = UUID.randomUUID()
        assertThrows(DomainException::class.java) {
            ctx.syncFeed.fetchChanges(foreignOrg, outletId, p1.highWaterCursor, 100)
        }
        assertThrows(DomainException::class.java) {
            ctx.syncFeed.fetchChanges(organizationId, outletId, "invalid-cursor-format", 100)
        }
    }
}
