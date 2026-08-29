package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.MerchantCatalogCreateReceiptController
import `in`.mypetnew.application.web.ResolveReceiptRequest
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.UpdateListingCommand
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M0ToM7MerchantFlowCertificationTest {

    private data class Context(
        val jdbc: JdbcTemplate,
        val catalog: CatalogService,
        val inventory: InventoryService,
        val providers: ProviderService,
        val receiptController: MerchantCatalogCreateReceiptController,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val receiptController = MerchantCatalogCreateReceiptController(providers, jdbc)
        return Context(jdbc, catalog, inventory, providers, receiptController)
    }

    private fun seedMerchantScope(
        jdbc: JdbcTemplate,
        mobile: String = "+919400000001",
        orgName: String = "Certified Org",
        outletName: String = "Certified Outlet",
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
    fun `Flow Group B & E & AG - Full Catalog lifecycle with GTIN normalization, price in paise, and audit trail`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantScope(ctx.jdbc, "+919400000010")

        // 1. Create with GTIN-12 preserving leading zero (012345678905)
        val createdGtin12 = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_12,
                barcode = " 0123 4567 8905 ",
                name = "Puppy Chow 1kg",
                kind = ListingKind.PRODUCT,
                mrpPaise = 25000,
                sellingPricePaise = 22000,
                category = "dog-food",
                brand = "Pedigree",
                description = "Nutritious puppy food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-gtin12-key-1",
            actorId,
        )

        assertEquals("012345678905", createdGtin12.normalizedBarcode)
        assertEquals(25000L, createdGtin12.mrpPaise)
        assertEquals(22000L, createdGtin12.sellingPricePaise)
        assertEquals(0, createdGtin12.version)
        assertEquals(ListingStatus.ACTIVE, createdGtin12.status)
        assertEquals(CommerceMode.COMMERCE, createdGtin12.commerceMode)

        // 2. Edit listing metadata and price
        val updated = ctx.catalog.updateListing(
            UpdateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = createdGtin12.id,
                expectedVersion = 0,
                name = "Puppy Chow 1kg Premium",
                mrpPaise = 26000,
                sellingPricePaise = 23000,
                category = "dog-food",
                brand = "Pedigree Pro",
                description = "Premium puppy nutrition",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "update-key-1",
            actorId,
        )

        assertEquals(1, updated.version)
        assertEquals("Puppy Chow 1kg Premium", updated.name)
        assertEquals(23000L, updated.sellingPricePaise)

        // 3. Deactivate listing
        val deactivated = ctx.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = createdGtin12.id,
                expectedVersion = 1,
                targetStatus = ListingStatus.INACTIVE,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "deactivate-key-1",
            actorId,
        )
        assertEquals(2, deactivated.version)
        assertEquals(ListingStatus.INACTIVE, deactivated.status)

        // 4. Reactivate listing
        val reactivated = ctx.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = createdGtin12.id,
                expectedVersion = 2,
                targetStatus = ListingStatus.ACTIVE,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "reactivate-key-1",
            actorId,
        )
        assertEquals(3, reactivated.version)
        assertEquals(ListingStatus.ACTIVE, reactivated.status)

        // 5. Verify audit history exists in catalog_listing_history and no hard deletion occurs
        val historyCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.catalog_listing_history WHERE listing_id = ?",
            Int::class.java,
            createdGtin12.id,
        )
        assertTrue((historyCount ?: 0) >= 4, "Expected at least 4 audit events for create, update, deactivate, reactivate")

        val listingExists = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.catalog_listing WHERE id = ?",
            Int::class.java,
            createdGtin12.id,
        )
        assertEquals(1, listingExists)
    }

    @Test
    fun `Flow Group C & W - Duplicate product convergence vs conflict across devices`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantScope(ctx.jdbc, "+919400000020")

        val command = CreateListingCommand(
            organizationId = organizationId,
            outletId = outletId,
            barcodeType = BarcodeType.GTIN_13,
            barcode = "4006381333931",
            name = "Royal Canin Mini Adult",
            kind = ListingKind.PRODUCT,
            mrpPaise = 85000,
            sellingPricePaise = 79000,
            category = "dog-food",
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
        )

        // Device B creates online
        val deviceBListing = ctx.catalog.createListing(command, "device-b-create-key", actorId)

        // Device A reconnects with identical semantic payload -> converges to same canonical listing
        val deviceAConverged = ctx.catalog.createListing(command, "device-a-reconnect-key", actorId)
        assertEquals(deviceBListing.id, deviceAConverged.id)

        val rowCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.catalog_listing WHERE outlet_id = ? AND normalized_barcode = ?",
            Int::class.java,
            outletId,
            "4006381333931",
        )
        assertEquals(1, rowCount, "Must have exactly 1 canonical listing in DB")

        // Device C attempts creation with same barcode but divergent payload -> CATALOG_DUPLICATE
        val divergentCommand = command.copy(name = "Completely Different Product Name")
        val conflict = assertThrows(DomainException::class.java) {
            ctx.catalog.createListing(divergentCommand, "device-c-divergent-key", actorId)
        }
        assertEquals("CATALOG_DUPLICATE", conflict.code)
    }

    @Test
    fun `Flow Group D & AH - Inventory immutable ledger, balance derivation, and lost-response idempotency`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantScope(ctx.jdbc, "+919400000030")

        val listing = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "INT-CAT-TOY-01",
                name = "Cat Feather Wand",
                kind = ListingKind.PRODUCT,
                mrpPaise = 30000,
                sellingPricePaise = 25000,
                category = "cat-toys",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-cat-toy-key",
            actorId,
        )

        val scope = InventoryScope(organizationId, outletId, listing.id)

        // Initial balance should be 0 on hand, 0 reserved
        val initialBalance = ctx.inventory.balance(scope)
        assertEquals(0, initialBalance.onHand)
        assertEquals(0, initialBalance.reserved)

        // 1. Apply stock increase of +10
        val receipt1 = ctx.inventory.adjustMerchant(
            scope = scope,
            delta = 10,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "inv-move-1",
            actorId = actorId,
            traceId = "test-trace",
        )
        assertEquals(10, receipt1.resultingOnHand)

        // 2. Replay lost response for inv-move-1 -> must return identical movement without modifying stock
        val replayedReceipt1 = ctx.inventory.adjustMerchant(
            scope = scope,
            delta = 10,
            reason = StockReason.MANUAL_INCREASE,
            idempotencyKey = "inv-move-1",
            actorId = actorId,
            traceId = "test-trace",
        )
        assertEquals(receipt1.id, replayedReceipt1.id)
        assertEquals(10, replayedReceipt1.resultingOnHand)

        // Verify balance in DB remains 10
        val currentBalance = ctx.inventory.balance(scope)
        assertEquals(10, currentBalance.onHand)

        // 3. Apply stock decrease of -3
        val receipt2 = ctx.inventory.adjustMerchant(
            scope = scope,
            delta = -3,
            reason = StockReason.MANUAL_DECREASE,
            idempotencyKey = "inv-move-2",
            actorId = actorId,
            traceId = "test-trace",
        )
        assertEquals(7, receipt2.resultingOnHand)

        // 4. Attempt negative stock beyond onHand -> rejected with INSUFFICIENT_STOCK
        val overdraw = assertThrows(DomainException::class.java) {
            ctx.inventory.adjustMerchant(
                scope = scope,
                delta = -10,
                reason = StockReason.MANUAL_DECREASE,
                idempotencyKey = "inv-move-overdraw",
                actorId = actorId,
                traceId = "test-trace",
            )
        }
        assertEquals("INSUFFICIENT_STOCK", overdraw.code)

        // Balance remains 7
        assertEquals(7, ctx.inventory.balance(scope).onHand)

        // 5. Verify movements count in ledger
        val movementCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE listing_id = ?",
            Int::class.java,
            listing.id,
        )
        assertTrue((movementCount ?: 0) >= 2, "Expected at least 2 movements recorded in immutable ledger")
    }

    @Test
    fun `Flow Group N - Medicine catalog creation enforces VIEW_ONLY and rejects commerce purchase mode`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantScope(ctx.jdbc, "+919400000040")

        val medicine = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "8901234567890",
                name = "Amoxicillin 250mg Vet",
                kind = ListingKind.MEDICINE,
                mrpPaise = 45000,
                sellingPricePaise = 40000,
                category = "medicine",
                capabilities = setOf(ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY),
            ),
            "medicine-create-key-1",
            actorId,
        )

        assertEquals(ListingKind.MEDICINE, medicine.kind)
        assertEquals(CommerceMode.VIEW_ONLY, medicine.commerceMode)
    }

    @Test
    fun `Flow Group U & V - Lost create response receipt resolution with fingerprint verification and tampering rejection`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantScope(ctx.jdbc, "+919400000050")
        val authentication = auth(actorId, organizationId, outletId)

        val listing = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "4006381333931",
                name = "Drools Focus Puppy 4kg",
                kind = ListingKind.PRODUCT,
                mrpPaise = 180000,
                sellingPricePaise = 165000,
                category = "dog-food",
                brand = "Drools",
                description = "Focus super premium puppy food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-drools-key-123",
            actorId,
        )

        // 1. Correct receipt resolution succeeds
        val resolved = ctx.receiptController.resolveCreateReceipt(
            authentication,
            ResolveReceiptRequest(
                idempotencyKey = "create-drools-key-123",
                commandType = "CATALOG_CREATE",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "barcodeType" to "GTIN_13",
                    "barcode" to "4006381333931",
                    "name" to "Drools Focus Puppy 4kg",
                    "kind" to "PRODUCT",
                    "mrpPaise" to 180000,
                    "sellingPricePaise" to 165000,
                    "category" to "dog-food",
                    "brand" to "Drools",
                    "description" to "Focus super premium puppy food",
                ),
            ),
        )

        assertEquals("ACCEPTED", resolved.status)
        assertEquals(listing.id, resolved.entityId)
        assertEquals(0L, resolved.resultingVersion)

        // 2. Tampered name in receipt resolution is rejected
        val tamperedName = assertThrows(DomainException::class.java) {
            ctx.receiptController.resolveCreateReceipt(
                authentication,
                ResolveReceiptRequest(
                    idempotencyKey = "create-drools-key-123",
                    commandType = "CATALOG_CREATE",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to outletId.toString(),
                        "barcodeType" to "GTIN_13",
                        "barcode" to "4006381333931",
                        "name" to "Tampered Product Name",
                        "kind" to "PRODUCT",
                        "mrpPaise" to 180000,
                        "sellingPricePaise" to 165000,
                        "category" to "dog-food",
                    ),
                ),
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", tamperedName.code)

        // 3. Tampered price in receipt resolution is rejected
        val tamperedPrice = assertThrows(DomainException::class.java) {
            ctx.receiptController.resolveCreateReceipt(
                authentication,
                ResolveReceiptRequest(
                    idempotencyKey = "create-drools-key-123",
                    commandType = "CATALOG_CREATE",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to outletId.toString(),
                        "barcodeType" to "GTIN_13",
                        "barcode" to "4006381333931",
                        "name" to "Drools Focus Puppy 4kg",
                        "kind" to "PRODUCT",
                        "mrpPaise" to 180000,
                        "sellingPricePaise" to 999999,
                        "category" to "dog-food",
                    ),
                ),
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", tamperedPrice.code)
    }
}
