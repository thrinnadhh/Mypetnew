package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.InventoryDamageInput
import `in`.mypetnew.catalog.domain.InventoryExpiryInput
import `in`.mypetnew.catalog.domain.InventoryReceivingInput
import `in`.mypetnew.catalog.domain.InventoryReturnInput
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.InventoryShrinkageInput
import `in`.mypetnew.catalog.domain.ReturnType
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.TransferRequest
import `in`.mypetnew.catalog.domain.TransferStatus
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M8InventoryOperationsPostgresContractTest {
    private val dataSource = PostgresTestDatabase.dataSource()
    private val jdbc = JdbcTemplate(dataSource)
    private val tx = TransactionTemplate(DataSourceTransactionManager(dataSource))
    private val persistence = JdbcInventoryPersistence(jdbc, tx)
    private val inventoryService = InventoryService(persistence)
    private val fixture = MerchantScenarioFixture(dataSource)

    @BeforeEach
    fun resetDatabase() {
        PostgresTestDatabase.resetAndMigrate()
    }

    @Test
    fun `M8-OPS-001 receiving increases on-hand and appends immutable RECEIVING movement with optional batch metadata`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        val movement = inventoryService.receive(
            scope = scope,
            input = InventoryReceivingInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 50,
                referenceType = "PURCHASE_ORDER",
                referenceId = "PO-9901",
                batchNumber = "BATCH-ALPHA",
                expiryDate = "2028-12-31",
            ),
            idempotencyKey = "rec-key-1",
            actorId = scenario.accountId,
            traceId = "trace-rec-1",
        )

        assertEquals(StockReason.RECEIVING, movement.reason)
        assertEquals(50, movement.quantityDelta)
        assertEquals(50, movement.resultingOnHand)
        assertEquals(0, movement.resultingReserved)

        val balance = persistence.balance(scope)
        assertEquals(50, balance.onHand)

        // Idempotent replay
        val replayed = inventoryService.receive(
            scope = scope,
            input = InventoryReceivingInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 50,
                referenceType = "PURCHASE_ORDER",
                referenceId = "PO-9901",
                batchNumber = "BATCH-ALPHA",
                expiryDate = "2028-12-31",
            ),
            idempotencyKey = "rec-key-1",
            actorId = scenario.accountId,
            traceId = "trace-rec-1",
        )
        assertEquals(movement.id, replayed.id)
        assertEquals(50, persistence.balance(scope).onHand)

        // Fingerprint mismatch throws
        assertThrows(DomainException::class.java) {
            inventoryService.receive(
                scope = scope,
                input = InventoryReceivingInput(
                    outletId = scenario.outletId,
                    listingId = scenario.listingId,
                    quantity = 60, // Changed quantity
                    referenceType = "PURCHASE_ORDER",
                    referenceId = "PO-9901",
                ),
                idempotencyKey = "rec-key-1",
                actorId = scenario.accountId,
                traceId = "trace-rec-1",
            )
        }
    }

    @Test
    fun `M8-OPS-001 damage, expiry, and shrinkage decrease stock and guard against insufficient balance`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        // Seed 30 units
        persistence.adjustScoped(scope, 30, StockReason.MANUAL_INCREASE, "seed-key", scenario.accountId, "trace-seed")
        assertEquals(30, persistence.balance(scope).onHand)

        // Damage 5 units
        val damageMov = inventoryService.damage(
            scope = scope,
            input = InventoryDamageInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 5,
                reasonDetails = "Broken during shelving",
                referenceId = "INCIDENT-101",
            ),
            idempotencyKey = "dam-key-1",
            actorId = scenario.accountId,
            traceId = "trace-dam-1",
        )
        assertEquals(StockReason.DAMAGE, damageMov.reason)
        assertEquals(-5, damageMov.quantityDelta)
        assertEquals(25, damageMov.resultingOnHand)

        // Expire 10 units
        val expiryMov = inventoryService.expire(
            scope = scope,
            input = InventoryExpiryInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 10,
                batchReference = "BATCH-EXP-1",
                expiryDate = "2026-01-01",
            ),
            idempotencyKey = "exp-key-1",
            actorId = scenario.accountId,
            traceId = "trace-exp-1",
        )
        assertEquals(StockReason.EXPIRY, expiryMov.reason)
        assertEquals(-10, expiryMov.quantityDelta)
        assertEquals(15, expiryMov.resultingOnHand)

        // Shrink 3 units
        val shrinkMov = inventoryService.shrink(
            scope = scope,
            input = InventoryShrinkageInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 3,
                notes = "Unaccounted shortage",
                referenceId = "AUDIT-2026",
            ),
            idempotencyKey = "shr-key-1",
            actorId = scenario.accountId,
            traceId = "trace-shr-1",
        )
        assertEquals(StockReason.SHRINKAGE, shrinkMov.reason)
        assertEquals(-3, shrinkMov.quantityDelta)
        assertEquals(12, shrinkMov.resultingOnHand)

        // Try to damage 20 units (only 12 available) -> throws INSUFFICIENT_STOCK
        val ex = assertThrows(DomainException::class.java) {
            inventoryService.damage(
                scope = scope,
                input = InventoryDamageInput(
                    outletId = scenario.outletId,
                    listingId = scenario.listingId,
                    quantity = 20,
                ),
                idempotencyKey = "dam-overflow-key",
                actorId = scenario.accountId,
                traceId = "trace-dam-2",
            )
        }
        assertEquals("INSUFFICIENT_STOCK", ex.code)
        assertEquals(12, persistence.balance(scope).onHand)
    }

    @Test
    fun `M8-OPS-001 customer and vendor returns behave according to return type semantics`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        // Seed 10 units
        persistence.adjustScoped(scope, 10, StockReason.MANUAL_INCREASE, "seed-ret", scenario.accountId, "trace-seed")

        // Customer Return (+4 units)
        val custRet = inventoryService.returnStock(
            scope = scope,
            input = InventoryReturnInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 4,
                returnType = ReturnType.CUSTOMER_RETURN,
                referenceType = "ORDER_RETURN",
                referenceId = "ORD-999",
            ),
            idempotencyKey = "ret-cust-1",
            actorId = scenario.accountId,
            traceId = "trace-ret-1",
        )
        assertEquals(StockReason.CUSTOMER_RETURN, custRet.reason)
        assertEquals(4, custRet.quantityDelta)
        assertEquals(14, custRet.resultingOnHand)

        // Vendor Return (-6 units)
        val venRet = inventoryService.returnStock(
            scope = scope,
            input = InventoryReturnInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 6,
                returnType = ReturnType.VENDOR_RETURN,
                referenceType = "RTV",
                referenceId = "RTV-001",
            ),
            idempotencyKey = "ret-ven-1",
            actorId = scenario.accountId,
            traceId = "trace-ret-2",
        )
        assertEquals(StockReason.VENDOR_RETURN, venRet.reason)
        assertEquals(-6, venRet.quantityDelta)
        assertEquals(8, venRet.resultingOnHand)

        // Vendor return exceeding available throws INSUFFICIENT_STOCK
        val ex = assertThrows(DomainException::class.java) {
            inventoryService.returnStock(
                scope = scope,
                input = InventoryReturnInput(
                    outletId = scenario.outletId,
                    listingId = scenario.listingId,
                    quantity = 10,
                    returnType = ReturnType.VENDOR_RETURN,
                ),
                idempotencyKey = "ret-ven-fail",
                actorId = scenario.accountId,
                traceId = "trace-ret-3",
            )
        }
        assertEquals("INSUFFICIENT_STOCK", ex.code)
        assertEquals(8, persistence.balance(scope).onHand)
    }

    @Test
    fun `M8-OPS-001 outlet transfer is strictly conserved, atomically linked, and deadlock-free`() {
        val scenarioSource = fixture.create()
        // Create second outlet in same organization
        val destOutletId = UUID.randomUUID()
        val destListingId = UUID.randomUUID()

        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M8 Dest Outlet', 'ACTIVE', TRUE)",
            destOutletId,
            scenarioSource.organizationId,
        )
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
            ) VALUES (?, ?, ?, 'INTERNAL', ?, 'M8 Dest Product', 'PRODUCT', 'COMMERCE', 10000, 9000, TRUE)
            """.trimIndent(),
            destListingId,
            scenarioSource.organizationId,
            destOutletId,
            "M0-${scenarioSource.listingId}", // Same barcode
        )

        val srcScope = InventoryScope(scenarioSource.organizationId, scenarioSource.outletId, scenarioSource.listingId)
        val dstScope = InventoryScope(scenarioSource.organizationId, destOutletId, destListingId)

        // Seed 40 units in source outlet
        persistence.adjustScoped(srcScope, 40, StockReason.MANUAL_INCREASE, "seed-tr-src", scenarioSource.accountId, "trace-src")
        assertEquals(40, persistence.balance(srcScope).onHand)
        assertEquals(0, persistence.balance(dstScope).onHand)

        // Transfer 15 units from source to dest
        val result = inventoryService.transfer(
            organizationId = scenarioSource.organizationId,
            request = TransferRequest(
                sourceOutletId = scenarioSource.outletId,
                destinationOutletId = destOutletId,
                sourceListingId = scenarioSource.listingId,
                destinationListingId = destListingId,
                quantity = 15,
            ),
            idempotencyKey = "transfer-test-1",
            actorId = scenarioSource.accountId,
            traceId = "trace-tr-1",
        )

        assertEquals(TransferStatus.COMPLETED, result.transfer.status)
        assertEquals(15, result.transfer.quantity)
        assertEquals(scenarioSource.outletId, result.transfer.sourceOutletId)
        assertEquals(destOutletId, result.transfer.destinationOutletId)

        assertEquals(StockReason.TRANSFER_OUT, result.sourceMovement.reason)
        assertEquals(-15, result.sourceMovement.quantityDelta)
        assertEquals(25, result.sourceMovement.resultingOnHand)

        assertEquals(StockReason.TRANSFER_IN, result.destinationMovement.reason)
        assertEquals(15, result.destinationMovement.quantityDelta)
        assertEquals(15, result.destinationMovement.resultingOnHand)

        // Platform conservation invariant: Net change = 0
        assertEquals(25, persistence.balance(srcScope).onHand)
        assertEquals(15, persistence.balance(dstScope).onHand)
        assertEquals(40, persistence.balance(srcScope).onHand + persistence.balance(dstScope).onHand)

        // Verify transfer table row
        val transferCount = jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_transfer WHERE idempotency_key = 'transfer-test-1'",
            Long::class.java,
        )
        assertEquals(1L, transferCount)

        // Replay returns identical result
        val replayResult = inventoryService.transfer(
            organizationId = scenarioSource.organizationId,
            request = TransferRequest(
                sourceOutletId = scenarioSource.outletId,
                destinationOutletId = destOutletId,
                sourceListingId = scenarioSource.listingId,
                destinationListingId = destListingId,
                quantity = 15,
            ),
            idempotencyKey = "transfer-test-1",
            actorId = scenarioSource.accountId,
            traceId = "trace-tr-1",
        )
        assertEquals(result.transfer.id, replayResult.transfer.id)
        assertEquals(25, persistence.balance(srcScope).onHand)
        assertEquals(15, persistence.balance(dstScope).onHand)

        // Insufficient source stock rolls back entire transaction
        val ex = assertThrows(DomainException::class.java) {
            inventoryService.transfer(
                organizationId = scenarioSource.organizationId,
                request = TransferRequest(
                    sourceOutletId = scenarioSource.outletId,
                    destinationOutletId = destOutletId,
                    sourceListingId = scenarioSource.listingId,
                    destinationListingId = destListingId,
                    quantity = 100, // Source has only 25
                ),
                idempotencyKey = "transfer-overflow",
                actorId = scenarioSource.accountId,
                traceId = "trace-tr-fail",
            )
        }
        assertEquals("INSUFFICIENT_STOCK", ex.code)
        assertEquals(25, persistence.balance(srcScope).onHand)
        assertEquals(15, persistence.balance(dstScope).onHand)
    }
}
