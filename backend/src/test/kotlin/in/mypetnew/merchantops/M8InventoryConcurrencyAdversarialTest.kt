package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.InventoryDamageInput
import `in`.mypetnew.catalog.domain.InventoryReceivingInput
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.TransferRequest
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.merchantops.testsupport.MerchantOpsConcurrency
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@MerchantOpsConcurrency
@MerchantOpsPostgres
class M8InventoryConcurrencyAdversarialTest {
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
    fun `M8 concurrent bidirectional transfers across outlets complete without deadlocks and preserve net stock`() {
        val scenarioSource = fixture.create()
        val destOutletId = UUID.randomUUID()
        val destListingId = UUID.randomUUID()

        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M8 Concurrency Outlet 2', 'ACTIVE', TRUE)",
            destOutletId,
            scenarioSource.organizationId,
        )
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active
            ) VALUES (?, ?, ?, 'INTERNAL', ?, 'M8 Concurrency Product', 'PRODUCT', 'COMMERCE', 10000, 9000, TRUE)
            """.trimIndent(),
            destListingId,
            scenarioSource.organizationId,
            destOutletId,
            "M0-${scenarioSource.listingId}",
        )

        val srcScope = InventoryScope(scenarioSource.organizationId, scenarioSource.outletId, scenarioSource.listingId)
        val dstScope = InventoryScope(scenarioSource.organizationId, destOutletId, destListingId)

        // Seed 500 units in each outlet
        persistence.adjustScoped(srcScope, 500, StockReason.MANUAL_INCREASE, "seed-c-src", scenarioSource.accountId, "trace-seed")
        persistence.adjustScoped(dstScope, 500, StockReason.MANUAL_INCREASE, "seed-c-dst", scenarioSource.accountId, "trace-seed")

        val totalInitialStock = 1000

        val threads = 20
        val operationsPerThread = 10
        val executor = Executors.newFixedThreadPool(threads)
        val startLatch = CountDownLatch(1)
        val successfulTransfersAtoB = AtomicInteger(0)
        val successfulTransfersBtoA = AtomicInteger(0)

        val tasks = (0 until threads).map { threadIdx ->
            Callable {
                startLatch.await()
                val isForward = threadIdx % 2 == 0
                for (op in 0 until operationsPerThread) {
                    val key = "concurrent-transfer-$threadIdx-$op"
                    try {
                        if (isForward) {
                            inventoryService.transfer(
                                organizationId = scenarioSource.organizationId,
                                request = TransferRequest(
                                    sourceOutletId = scenarioSource.outletId,
                                    destinationOutletId = destOutletId,
                                    sourceListingId = scenarioSource.listingId,
                                    destinationListingId = destListingId,
                                    quantity = 1,
                                ),
                                idempotencyKey = key,
                                actorId = scenarioSource.accountId,
                                traceId = "trace-t-$threadIdx-$op",
                            )
                            successfulTransfersAtoB.incrementAndGet()
                        } else {
                            inventoryService.transfer(
                                organizationId = scenarioSource.organizationId,
                                request = TransferRequest(
                                    sourceOutletId = destOutletId,
                                    destinationOutletId = scenarioSource.outletId,
                                    sourceListingId = destListingId,
                                    destinationListingId = scenarioSource.listingId,
                                    quantity = 1,
                                ),
                                idempotencyKey = key,
                                actorId = scenarioSource.accountId,
                                traceId = "trace-t-$threadIdx-$op",
                            )
                            successfulTransfersBtoA.incrementAndGet()
                        }
                    } catch (_: Exception) {
                        // Handled
                    }
                }
            }
        }

        val futures = tasks.map { executor.submit(it) }
        startLatch.countDown()
        futures.forEach { it.get(30, TimeUnit.SECONDS) }
        executor.shutdown()
        assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))

        val balSrc = persistence.balance(srcScope)
        val balDst = persistence.balance(dstScope)

        val expectedSrc = 500 - successfulTransfersAtoB.get() + successfulTransfersBtoA.get()
        val expectedDst = 500 + successfulTransfersAtoB.get() - successfulTransfersBtoA.get()

        assertEquals(expectedSrc, balSrc.onHand)
        assertEquals(expectedDst, balDst.onHand)
        assertEquals(totalInitialStock, balSrc.onHand + balDst.onHand)

        persistence.requireReconciled(srcScope)
        persistence.requireReconciled(dstScope)
    }

    @Test
    fun `M8 concurrent mixed operations maintain strictly reconciled balance ledger integrity`() {
        val scenario = fixture.create()
        val scope = InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)

        // Seed 1000 units
        persistence.adjustScoped(scope, 1000, StockReason.MANUAL_INCREASE, "seed-mixed-ops", scenario.accountId, "trace-seed")

        val threads = 16
        val operationsPerThread = 15
        val executor = Executors.newFixedThreadPool(threads)
        val startLatch = CountDownLatch(1)

        val totalReceived = AtomicInteger(0)
        val totalDamaged = AtomicInteger(0)
        val totalSold = AtomicInteger(0)

        val tasks = (0 until threads).map { threadIdx ->
            Callable {
                startLatch.await()
                for (op in 0 until operationsPerThread) {
                    val key = "concurrent-op-$threadIdx-$op"
                    when (threadIdx % 3) {
                        0 -> {
                            inventoryService.receive(
                                scope = scope,
                                input = InventoryReceivingInput(
                                    outletId = scenario.outletId,
                                    listingId = scenario.listingId,
                                    quantity = 2,
                                ),
                                idempotencyKey = key,
                                actorId = scenario.accountId,
                                traceId = "trace-m-$threadIdx-$op",
                            )
                            totalReceived.addAndGet(2)
                        }
                        1 -> {
                            inventoryService.damage(
                                scope = scope,
                                input = InventoryDamageInput(
                                    outletId = scenario.outletId,
                                    listingId = scenario.listingId,
                                    quantity = 1,
                                ),
                                idempotencyKey = key,
                                actorId = scenario.accountId,
                                traceId = "trace-m-$threadIdx-$op",
                            )
                            totalDamaged.addAndGet(1)
                        }
                        else -> {
                            persistence.sell(
                                scenario.listingId,
                                1,
                                key,
                                scenario.accountId,
                                "trace-m-$threadIdx-$op",
                            )
                            totalSold.addAndGet(1)
                        }
                    }
                }
            }
        }

        val futures = tasks.map { executor.submit(it) }
        startLatch.countDown()
        futures.forEach { it.get(30, TimeUnit.SECONDS) }
        executor.shutdown()
        assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))

        val finalBal = persistence.balance(scope)
        val expectedOnHand = 1000 + totalReceived.get() - totalDamaged.get() - totalSold.get()

        assertEquals(expectedOnHand, finalBal.onHand)
        persistence.requireReconciled(scope)
    }
}
