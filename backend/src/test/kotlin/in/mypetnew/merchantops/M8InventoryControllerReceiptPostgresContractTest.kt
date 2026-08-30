package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.DamageRequest
import `in`.mypetnew.application.web.ExpiryRequest
import `in`.mypetnew.application.web.MerchantInventoryController
import `in`.mypetnew.application.web.MerchantSyncController
import `in`.mypetnew.application.web.ReceivingRequest
import `in`.mypetnew.application.web.ResolveReceiptRequest
import `in`.mypetnew.application.web.ReturnRequest
import `in`.mypetnew.application.web.ShrinkageRequest
import `in`.mypetnew.application.web.StartCountRequest
import `in`.mypetnew.application.web.SubmitCountRequest
import `in`.mypetnew.application.web.TransferApiRequest
import `in`.mypetnew.application.web.UpdateCountLinesRequest
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CountLineInput
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ReturnType
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenario
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M8InventoryControllerReceiptPostgresContractTest {
    @Test
    fun `M8 controller commands and receipt resolution cover offline recovery contract`() {
        val context = context()
        val scenario = context.fixture.create()
        val destinationOutletId = UUID.randomUUID()
        val destinationListingId = UUID.randomUUID()
        seedDestination(context.jdbc, scenario, destinationOutletId, destinationListingId)
        val auth = auth(scenario, destinationOutletId)

        val received = context.inventoryController.receive(
            auth, "m8-receive", "INVENTORY_RECEIVING", "1",
            ReceivingRequest(scenario.outletId, scenario.listingId, 50, "PURCHASE_ORDER", "PO-8", "BATCH-8", "2029-01-01"),
        )
        assertEquals(50, received.resultingOnHand)
        assertResolved(
            context.syncController.resolveReceipt(
                auth,
                ResolveReceiptRequest("m8-receive", "INVENTORY_RECEIVING", 1, mapOf(
                    "outletId" to scenario.outletId.toString(), "listingId" to scenario.listingId.toString(),
                    "quantity" to 50, "referenceType" to "PURCHASE_ORDER", "referenceId" to "PO-8",
                    "batchNumber" to "BATCH-8", "expiryDate" to "2029-01-01",
                )),
            ),
            "INVENTORY_RECEIVING",
            scenario.listingId,
        )

        context.inventoryController.damage(
            auth, "m8-damage", "INVENTORY_DAMAGE", "1",
            DamageRequest(scenario.outletId, scenario.listingId, 5, "broken", "DMG-8"),
        )
        assertResolved(context.syncController.resolveReceipt(auth, ResolveReceiptRequest(
            "m8-damage", "INVENTORY_DAMAGE", 1, mapOf(
                "outletId" to scenario.outletId.toString(), "listingId" to scenario.listingId.toString(),
                "quantity" to 5, "reasonDetails" to "broken", "referenceId" to "DMG-8",
            ),
        )), "INVENTORY_DAMAGE", scenario.listingId)

        context.inventoryController.expire(
            auth, "m8-expiry", "INVENTORY_EXPIRY", "1",
            ExpiryRequest(scenario.outletId, scenario.listingId, 3, "BATCH-8", "2029-01-01"),
        )
        assertResolved(context.syncController.resolveReceipt(auth, ResolveReceiptRequest(
            "m8-expiry", "INVENTORY_EXPIRY", 1, mapOf(
                "outletId" to scenario.outletId.toString(), "listingId" to scenario.listingId.toString(),
                "quantity" to 3, "batchReference" to "BATCH-8", "expiryDate" to "2029-01-01",
            ),
        )), "INVENTORY_EXPIRY", scenario.listingId)

        context.inventoryController.shrink(
            auth, "m8-shrink", "INVENTORY_SHRINKAGE", "1",
            ShrinkageRequest(scenario.outletId, scenario.listingId, 2, "count loss", "SHR-8"),
        )
        assertResolved(context.syncController.resolveReceipt(auth, ResolveReceiptRequest(
            "m8-shrink", "INVENTORY_SHRINKAGE", 1, mapOf(
                "outletId" to scenario.outletId.toString(), "listingId" to scenario.listingId.toString(),
                "quantity" to 2, "notes" to "count loss", "referenceId" to "SHR-8",
            ),
        )), "INVENTORY_SHRINKAGE", scenario.listingId)

        context.inventoryController.returnStock(
            auth, "m8-return", "INVENTORY_RETURN", "1",
            ReturnRequest(scenario.outletId, scenario.listingId, 4, ReturnType.CUSTOMER_RETURN, "ORDER", "RET-8"),
        )
        assertResolved(context.syncController.resolveReceipt(auth, ResolveReceiptRequest(
            "m8-return", "INVENTORY_RETURN", 1, mapOf(
                "outletId" to scenario.outletId.toString(), "listingId" to scenario.listingId.toString(),
                "quantity" to 4, "returnType" to "CUSTOMER_RETURN", "referenceType" to "ORDER", "referenceId" to "RET-8",
            ),
        )), "INVENTORY_RETURN", scenario.listingId)

        val transfer = context.inventoryController.transfer(
            auth, "m8-transfer", "INVENTORY_TRANSFER", "1",
            TransferApiRequest(scenario.outletId, destinationOutletId, scenario.listingId, destinationListingId, 10),
        )
        assertEquals(10, transfer.transfer.quantity)
        assertResolved(context.syncController.resolveReceipt(auth, ResolveReceiptRequest(
            "m8-transfer", "INVENTORY_TRANSFER", 1, mapOf(
                "sourceOutletId" to scenario.outletId.toString(),
                "destinationOutletId" to destinationOutletId.toString(),
                "sourceListingId" to scenario.listingId.toString(),
                "quantity" to 10,
            ),
        )), "INVENTORY_TRANSFER", scenario.listingId)

        val session = context.inventoryController.startCount(auth, StartCountRequest(scenario.outletId, 11))
        assertEquals(session.id, context.inventoryController.getCount(auth, session.id, scenario.outletId).id)
        context.inventoryController.updateCountLines(
            auth,
            session.id,
            UpdateCountLinesRequest(scenario.outletId, listOf(CountLineInput(scenario.listingId, 32))),
        )
        val countResult = context.inventoryController.submitCount(
            auth, session.id, "m8-count-submit", "INVENTORY_COUNT_SUBMIT", "1", SubmitCountRequest(scenario.outletId),
        )
        assertEquals(32, countResult.lines.single().resultingOnHand)
        assertResolved(context.syncController.resolveReceipt(auth, ResolveReceiptRequest(
            "m8-count-submit", "INVENTORY_COUNT_SUBMIT", 1, mapOf(
                "outletId" to scenario.outletId.toString(), "sessionId" to session.id.toString(),
            ),
        )), "INVENTORY_COUNT_SUBMIT", session.id)
        assertEquals(32, context.inventoryController.balance(auth, scenario.outletId, scenario.listingId).onHand)
        assertEquals(true, context.inventoryController.movements(auth, scenario.outletId, scenario.listingId, 0, 100).items.isNotEmpty())

        assertThrows(DomainException::class.java) {
            context.inventoryController.receive(
                auth, "bad-header", "INVENTORY_DAMAGE", "1",
                ReceivingRequest(scenario.outletId, scenario.listingId, 1),
            )
        }
        assertThrows(DomainException::class.java) {
            context.syncController.resolveReceipt(
                auth,
                ResolveReceiptRequest("missing", "INVENTORY_RECEIVING", 2, emptyMap()),
            )
        }
        assertThrows(DomainException::class.java) {
            context.syncController.resolveReceipt(
                auth,
                ResolveReceiptRequest("missing", "UNKNOWN_COMMAND", 1, emptyMap()),
            )
        }
    }

    private fun assertResolved(response: `in`.mypetnew.application.web.ResolveReceiptResponse, commandType: String, entityId: UUID) {
        assertEquals("ACCEPTED", response.status)
        assertEquals(commandType, response.commandType)
        assertEquals(entityId, response.entityId)
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val syncFeed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "test-sync-cursor-secret-at-least-32-chars-long")
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions, syncFeed))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions, syncFeed))
        return Context(
            jdbc = jdbc,
            fixture = MerchantScenarioFixture(dataSource),
            inventoryController = MerchantInventoryController(providers, catalog, inventory),
            syncController = MerchantSyncController(providers, syncFeed, jdbc),
        )
    }

    private fun auth(scenario: MerchantScenario, destinationOutletId: UUID): UsernamePasswordAuthenticationToken {
        val outletIds = setOf(scenario.outletId, destinationOutletId)
        val principal = Principal(
            actorId = scenario.accountId,
            role = Role.MERCHANT,
            organizationId = scenario.organizationId,
            outletIds = outletIds,
            merchantPermissionsByOutlet = outletIds.associateWith { setOf(MerchantPermission.OWNER) },
        )
        return UsernamePasswordAuthenticationToken(principal, null, emptyList())
    }

    private fun seedDestination(jdbc: JdbcTemplate, scenario: MerchantScenario, outletId: UUID, listingId: UUID) {
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M8 destination', 'ACTIVE', TRUE)",
            outletId,
            scenario.organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)",
            scenario.accountId,
            scenario.organizationId,
            outletId,
        )
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
            ) VALUES (?, ?, ?, 'INTERNAL', ?, 'M8 destination product', 'PRODUCT', 'COMMERCE', 10000, 9000, TRUE)
            """.trimIndent(),
            listingId,
            scenario.organizationId,
            outletId,
            "M8-$listingId",
        )
    }

    private data class Context(
        val jdbc: JdbcTemplate,
        val fixture: MerchantScenarioFixture,
        val inventoryController: MerchantInventoryController,
        val syncController: MerchantSyncController,
    )
}
