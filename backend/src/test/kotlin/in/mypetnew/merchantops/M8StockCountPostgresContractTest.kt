package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.CountLineInput
import `in`.mypetnew.catalog.domain.CountSessionStatus
import `in`.mypetnew.catalog.domain.InventoryReceivingInput
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M8StockCountPostgresContractTest {
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
    fun `M8-COUNT-001 count session lifecycle captures cutoff and applies reconciliation adjustments`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        // Seed initial balance of 20
        persistence.adjustScoped(scope, 20, StockReason.MANUAL_INCREASE, "seed-count-1", scenario.accountId, "trace-seed")
        assertEquals(20, persistence.balance(scope).onHand)

        // 1. Start count session
        val session = inventoryService.startCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            actorId = scenario.accountId,
            traceId = "trace-start-1",
        )
        assertEquals(CountSessionStatus.OPEN, session.status)
        assertNotNull(session.cutoffTimestamp)

        // 2. Add count line with physical count of 25 (variance of +5)
        val updatedSession = inventoryService.updateCountLines(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            lines = listOf(CountLineInput(listingId = scenario.listingId, countedQuantity = 25)),
        )
        assertEquals(1, updatedSession.lines.size)
        assertEquals(25, updatedSession.lines[0].countedQuantity)
        assertEquals(20, updatedSession.lines[0].cutoffOnHand)

        // 3. Submit count session
        val result = inventoryService.submitCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            idempotencyKey = "submit-count-key-1",
            actorId = scenario.accountId,
            traceId = "trace-submit-1",
        )
        assertEquals(CountSessionStatus.SUBMITTED, result.status)
        assertEquals(1, result.lines.size)

        val lineResult = result.lines[0]
        assertEquals(25, lineResult.countedQuantity)
        assertEquals(20, lineResult.cutoffOnHand)
        assertEquals(0, lineResult.deltaAfterCutoff)
        assertEquals(25, lineResult.targetCurrentOnHand)
        assertEquals(20, lineResult.currentOnHandBeforeAdjustment)
        assertEquals(5, lineResult.countAdjustmentDelta)
        assertEquals(25, lineResult.resultingOnHand)
        assertNotNull(lineResult.movementId)

        // Verify balance updated to 25
        val finalBalance = persistence.balance(scope)
        assertEquals(25, finalBalance.onHand)

        // Verify immutable COUNT_ADJUSTMENT movement exists
        val history = persistence.history(scenario.listingId)
        val countMov = history.find { it.reason == StockReason.COUNT_ADJUSTMENT }
        assertNotNull(countMov)
        assertEquals(5, countMov!!.quantityDelta)
        assertEquals(25, countMov.resultingOnHand)
        assertEquals("COUNT_SESSION", countMov.sourceType)

        // 4. Idempotent resubmission returns identical result
        val replayResult = inventoryService.submitCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            idempotencyKey = "submit-count-key-1",
            actorId = scenario.accountId,
            traceId = "trace-submit-1",
        )
        assertEquals(result.sessionId, replayResult.sessionId)
        assertEquals(CountSessionStatus.SUBMITTED, replayResult.status)
        assertEquals(25, persistence.balance(scope).onHand)
    }

    @Test
    fun `M8-COUNT-001 concurrency reconciliation incorporates movements occurring after cutoff`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        // Initial balance: 20 units
        persistence.adjustScoped(scope, 20, StockReason.MANUAL_INCREASE, "seed-concurrency-1", scenario.accountId, "trace-seed")
        assertEquals(20, persistence.balance(scope).onHand)

        // Start count session (cutoff established when onHand = 20)
        val session = inventoryService.startCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            actorId = scenario.accountId,
            traceId = "trace-count-concurrent",
        )

        // Staff records counted physical stock = 22
        inventoryService.updateCountLines(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            lines = listOf(CountLineInput(listingId = scenario.listingId, countedQuantity = 22)),
        )

        // Sleep briefly to ensure strict timestamp ordering
        Thread.sleep(50)

        // Concurrent operation while count session is open: POS Sale of 4 units
        persistence.sell(scenario.listingId, 4, "pos-sale-mid-count", scenario.accountId, "trace-pos")
        // On hand is now 16
        assertEquals(16, persistence.balance(scope).onHand)

        // Another concurrent operation: Stock Receiving of 10 units
        inventoryService.receive(
            scope = scope,
            input = InventoryReceivingInput(
                outletId = scenario.outletId,
                listingId = scenario.listingId,
                quantity = 10,
            ),
            idempotencyKey = "rec-mid-count",
            actorId = scenario.accountId,
            traceId = "trace-rec-mid",
        )
        // On hand is now 16 + 10 = 26
        assertEquals(26, persistence.balance(scope).onHand)

        // Submit count session:
        // Delta after cutoff = (-4) + (+10) = +6
        // Target current on hand = Q_counted (22) + Delta_after_cutoff (6) = 28
        // Current before adjustment = 26
        // COUNT_ADJUSTMENT = 28 - 26 = +2
        val result = inventoryService.submitCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            idempotencyKey = "submit-concurrent-count",
            actorId = scenario.accountId,
            traceId = "trace-submit-concurrent",
        )

        val line = result.lines[0]
        assertEquals(22, line.countedQuantity)
        assertEquals(20, line.cutoffOnHand)
        assertEquals(6, line.deltaAfterCutoff)
        assertEquals(28, line.targetCurrentOnHand)
        assertEquals(26, line.currentOnHandBeforeAdjustment)
        assertEquals(2, line.countAdjustmentDelta)
        assertEquals(28, line.resultingOnHand)

        assertEquals(28, persistence.balance(scope).onHand)

        // Total movements reconcile perfectly
        persistence.requireReconciled(scope)
    }

    @Test
    fun `M8-COUNT-001 exact match count produces zero adjustment movements and preserves balance version`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        persistence.adjustScoped(scope, 15, StockReason.MANUAL_INCREASE, "seed-exact", scenario.accountId, "trace-seed")
        val beforeVersion = persistence.balance(scope).version

        val session = inventoryService.startCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            actorId = scenario.accountId,
            traceId = "trace-exact-count",
        )

        inventoryService.updateCountLines(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            lines = listOf(CountLineInput(listingId = scenario.listingId, countedQuantity = 15)),
        )

        val result = inventoryService.submitCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            idempotencyKey = "submit-exact-count",
            actorId = scenario.accountId,
            traceId = "trace-submit-exact",
        )

        val line = result.lines[0]
        assertEquals(0, line.countAdjustmentDelta)
        assertEquals(15, line.resultingOnHand)
        assertNull(line.movementId)

        val afterBalance = persistence.balance(scope)
        assertEquals(15, afterBalance.onHand)
        assertEquals(beforeVersion, afterBalance.version) // Version unchanged because delta was 0
    }

    @Test
    fun `M8-COUNT-001 negative stock violation flags session as REVIEW_REQUIRED and throws without corrupting stock`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        persistence.adjustScoped(scope, 10, StockReason.MANUAL_INCREASE, "seed-conflict", scenario.accountId, "trace-seed")

        // Reserve 8 units
        persistence.reserve(scenario.listingId, 8, "res-order-1", scenario.accountId, "trace-res")
        // Available is 10 - 8 = 2

        val session = inventoryService.startCountSession(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            actorId = scenario.accountId,
            traceId = "trace-conflict-start",
        )

        // Counted quantity is only 4 (which is below the reserved 8 units)
        inventoryService.updateCountLines(
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            sessionId = session.id,
            lines = listOf(CountLineInput(listingId = scenario.listingId, countedQuantity = 4)),
        )

        val ex = assertThrows(DomainException::class.java) {
            inventoryService.submitCountSession(
                organizationId = scenario.organizationId,
                outletId = scenario.outletId,
                sessionId = session.id,
                idempotencyKey = "submit-conflict-key",
                actorId = scenario.accountId,
                traceId = "trace-conflict-submit",
            )
        }
        assertEquals("COUNT_CUTOFF_CONFLICT", ex.code)

        // Session status is updated to REVIEW_REQUIRED
        val failedSession = inventoryService.getCountSession(scenario.organizationId, scenario.outletId, session.id)
        assertEquals(CountSessionStatus.REVIEW_REQUIRED, failedSession.status)

        // Stock was NOT changed
        val bal = persistence.balance(scope)
        assertEquals(10, bal.onHand)
        assertEquals(8, bal.reserved)
    }
}
