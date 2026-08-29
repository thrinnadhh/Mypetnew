package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.InventoryAdjustmentRequest
import `in`.mypetnew.application.web.MerchantCatalogCreateReceiptController
import `in`.mypetnew.application.web.MerchantInventoryController
import `in`.mypetnew.application.web.ResolveReceiptRequest
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
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

@MerchantOpsContract
@MerchantOpsPostgres
class M0ToM7SecurityIsolationTest {

    private data class Context(
        val jdbc: JdbcTemplate,
        val catalog: CatalogService,
        val inventory: InventoryService,
        val providers: ProviderService,
        val resolver: JdbcMerchantPrincipalResolver,
        val receiptController: MerchantCatalogCreateReceiptController,
        val inventoryController: MerchantInventoryController,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource))
        val receiptController = MerchantCatalogCreateReceiptController(providers, jdbc)
        val inventoryController = MerchantInventoryController(providers, catalog, inventory)
        return Context(jdbc, catalog, inventory, providers, resolver, receiptController, inventoryController)
    }

    private fun seedMerchantOrg(
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
        permissions: Set<MerchantPermission> = setOf(
            MerchantPermission.CATALOG_WRITE,
            MerchantPermission.INVENTORY_WRITE,
        ),
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
    fun `Flow Group A2, A3, AF - Cross-organization and cross-outlet access is strictly blocked without information disclosure`() {
        val ctx = context()
        val (actorA, orgA, outletA) = seedMerchantOrg(ctx.jdbc, "+919400000101", "Org Alpha", "Outlet Alpha 1")
        val (actorB, orgB, outletB) = seedMerchantOrg(ctx.jdbc, "+919400000102", "Org Beta", "Outlet Beta 1")

        // Seed product in Org B
        val listingB = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = orgB,
                outletId = outletB,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "4006381333931",
                name = "Beta Product",
                kind = ListingKind.PRODUCT,
                mrpPaise = 10000,
                sellingPricePaise = 9000,
                category = "cat-food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-beta-listing",
            actorB,
        )

        val authA = auth(actorA, orgA, outletA)

        // 1. Merchant A attempts inventory adjustment on Merchant B's outlet -> fails closed (RESOURCE_NOT_FOUND to prevent info leak)
        val blockedInventory = assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = authA,
                idempotencyKey = "tampered-inv-key",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(
                    outletId = outletB,
                    listingId = listingB.id,
                    quantityDelta = 10,
                    reason = StockReason.MANUAL_INCREASE,
                ),
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", blockedInventory.code)

        // 2. Merchant A attempts to resolve create receipt for Merchant B's listing -> fails closed
        val blockedReceipt = assertThrows(DomainException::class.java) {
            ctx.receiptController.resolveCreateReceipt(
                authA,
                ResolveReceiptRequest(
                    idempotencyKey = "create-beta-listing",
                    commandType = "CATALOG_CREATE",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to outletB.toString(),
                        "barcodeType" to "GTIN_13",
                        "barcode" to "4006381333931",
                        "name" to "Beta Product",
                        "kind" to "PRODUCT",
                        "mrpPaise" to 10000,
                        "sellingPricePaise" to 9000,
                        "category" to "cat-food",
                    ),
                ),
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", blockedReceipt.code)
    }

    @Test
    fun `Flow Group A4 & AF - Revoked staff authority fails closed on replayed or re-evaluated commands`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantOrg(ctx.jdbc, "+919400000103", "Revoke Org", "Revoke Outlet")

        val listing = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "INT-REVOKE-1",
                name = "Revoke Test Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 5000,
                sellingPricePaise = 4500,
                category = "general",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-revoke-item",
            actorId,
        )

        // Staff is active initially
        val principalBefore = ctx.resolver.resolve(actorId, UUID.randomUUID())
        assertTrue(principalBefore.merchantPermissionsByOutlet[outletId]?.contains(MerchantPermission.OWNER) == true)

        // Revoke staff access in database
        ctx.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            actorId,
            outletId,
        )

        // Resolver must now reflect revoked permissions (no grants for outlet)
        val principalAfter = ctx.resolver.resolve(actorId, UUID.randomUUID())
        assertFalse(principalAfter.merchantPermissionsByOutlet[outletId]?.contains(MerchantPermission.OWNER) == true)

        // Reauthorized principal attempting inventory update must fail closed
        val reauthorizedAuth = UsernamePasswordAuthenticationToken(principalAfter, null, emptyList())
        val denied = assertThrows(DomainException::class.java) {
            ctx.inventoryController.adjust(
                authentication = reauthorizedAuth,
                idempotencyKey = "stale-replay-key",
                commandTypeHeader = "INVENTORY_ADJUSTMENT",
                schemaVersionHeader = "1",
                request = InventoryAdjustmentRequest(
                    outletId = outletId,
                    listingId = listing.id,
                    quantityDelta = 5,
                    reason = StockReason.MANUAL_INCREASE,
                ),
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", denied.code)
    }

    @Test
    fun `Flow Group R & AF - Local temporary IDs passed to canonical backend APIs are rejected`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchantOrg(ctx.jdbc, "+919400000104", "Local ID Guard Org", "Local ID Guard Outlet")
        val authentication = auth(actorId, organizationId, outletId)

        // Attempting to resolve a receipt with a local:<uuid> as outletId fails closed with VALIDATION_ERROR
        val invalidOutlet = assertThrows(DomainException::class.java) {
            ctx.receiptController.resolveCreateReceipt(
                authentication,
                ResolveReceiptRequest(
                    idempotencyKey = "local-id-test-key",
                    commandType = "CATALOG_CREATE",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to "local:550e8400-e29b-41d4-a716-446655440000",
                        "barcodeType" to "GTIN_13",
                        "barcode" to "4006381333931",
                        "name" to "Invalid Outlet Test",
                        "kind" to "PRODUCT",
                        "mrpPaise" to 1000,
                        "sellingPricePaise" to 900,
                    ),
                ),
            )
        }
        assertEquals("VALIDATION_ERROR", invalidOutlet.code)
    }
}
