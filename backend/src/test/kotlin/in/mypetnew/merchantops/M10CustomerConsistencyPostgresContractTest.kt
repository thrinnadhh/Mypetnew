package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.CartRevalidationChange
import `in`.mypetnew.application.web.PublicCartRevalidationController
import `in`.mypetnew.application.web.PublicCartRevalidationLineRequest
import `in`.mypetnew.application.web.PublicCartRevalidationRequest
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcPublicCatalogReadRepository
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.Quote
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.commerce.infrastructure.JdbcCommerceListingAuthority
import `in`.mypetnew.commerce.infrastructure.JdbcOrderPersistence
import `in`.mypetnew.commerce.infrastructure.JdbcQuotePersistence
import `in`.mypetnew.merchantops.testsupport.MerchantOpsConcurrency
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenario
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@MerchantOpsPostgres
@MerchantOpsConcurrency
class M10CustomerConsistencyPostgresContractTest {
    private val dataSource = PostgresTestDatabase.dataSource()
    private val jdbc = JdbcTemplate(dataSource)
    private val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
    private val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
    private val reads = JdbcPublicCatalogReadRepository(jdbc)
    private val fixture = MerchantScenarioFixture(dataSource)

    @BeforeEach
    fun resetDatabase() {
        PostgresTestDatabase.resetAndMigrate()
    }

    @Test
    fun `M10 stale cart revalidation derives canonical price stock metadata deactivation store and serviceability`() {
        val scenario = fixture.create()
        enableProductStore(scenario.outletId, "517501")
        seedStock(scenario, 2, "m10-revalidate-stock")
        jdbc.update(
            """
            UPDATE mypet.catalog_listing
            SET name = 'Fresh canonical name', description = 'Fresh canonical description', selling_price_paise = 8500,
                version = version + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """.trimIndent(),
            scenario.listingId,
        )
        val controller = PublicCartRevalidationController(CatalogService(), InventoryService(), ProviderService(), reads)
        val request = PublicCartRevalidationRequest(
            outletId = scenario.outletId,
            pincode = "517501",
            lines = listOf(PublicCartRevalidationLineRequest(scenario.listingId, 3, 9_000)),
        )

        val refreshed = controller.revalidate(request)
        assertTrue(refreshed.materialChanged)
        assertTrue(refreshed.checkoutAllowed)
        assertEquals(2, refreshed.lines.single().acceptedQuantity)
        assertEquals(listOf(CartRevalidationChange.PRICE_CHANGED, CartRevalidationChange.QUANTITY_REDUCED), refreshed.lines.single().changes)
        assertEquals(8_500, refreshed.lines.single().canonical?.sellingPricePaise)
        assertEquals("Fresh canonical name", refreshed.lines.single().canonical?.name)
        assertEquals("Fresh canonical description", refreshed.lines.single().canonical?.description)

        jdbc.update("UPDATE mypet.catalog_listing SET active = FALSE, version = version + 1 WHERE id = ?", scenario.listingId)
        val deactivated = controller.revalidate(request)
        assertEquals(listOf(CartRevalidationChange.PRODUCT_UNAVAILABLE), deactivated.lines.single().changes)
        assertFalse(deactivated.checkoutAllowed)

        jdbc.update("UPDATE mypet.catalog_listing SET active = TRUE, version = version + 1 WHERE id = ?", scenario.listingId)
        jdbc.update("UPDATE mypet.outlet_service_pincode SET active = FALSE WHERE outlet_id = ? AND pincode = '517501'", scenario.outletId)
        val noService = controller.revalidate(request)
        assertEquals(listOf(CartRevalidationChange.SERVICEABILITY_CHANGED), noService.lines.single().changes)
        assertFalse(noService.checkoutAllowed)

        jdbc.update("UPDATE mypet.outlet_service_pincode SET active = TRUE WHERE outlet_id = ? AND pincode = '517501'", scenario.outletId)
        jdbc.update("UPDATE mypet.provider_outlet SET status = 'UNDER_REVIEW' WHERE id = ?", scenario.outletId)
        val storeUnavailable = controller.revalidate(request)
        assertEquals(listOf(CartRevalidationChange.STORE_UNAVAILABLE), storeUnavailable.lines.single().changes)
        assertFalse(storeUnavailable.checkoutAllowed)
    }

    @Test
    fun `M10 two customers racing for final unit have one durable winner and immutable order snapshot`() {
        val scenario = fixture.create()
        seedStock(scenario, 1, "m10-final-unit-stock")
        val customerA = createCustomer("+918100000011")
        val customerB = createCustomer("+918100000012")
        val quoteA = pickupQuote(scenario, customerA, 1, 9_000)
        val quoteB = pickupQuote(scenario, customerB, 1, 9_000)
        val orders = OrderService(
            inventory,
            JdbcOrderPersistence(jdbc, transactions),
            listingAuthority = JdbcCommerceListingAuthority(jdbc),
        )
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val futures = listOf(
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching {
                        orders.checkout(
                            quoteA,
                            scenario.organizationId,
                            mapOf(scenario.listingId to "stale A"),
                            "m10-customer-a-final-unit",
                            customerA,
                            "trace-m10-customer-a",
                        )
                    }
                }),
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching {
                        orders.checkout(
                            quoteB,
                            scenario.organizationId,
                            mapOf(scenario.listingId to "stale B"),
                            "m10-customer-b-final-unit",
                            customerB,
                            "trace-m10-customer-b",
                        )
                    }
                }),
            )
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val results = futures.map { it.get(15, TimeUnit.SECONDS) }

            assertEquals(1, results.count { it.isSuccess }, results.map { it.exceptionOrNull() }.toString())
            assertEquals(1, count("mypet.product_order"))
            assertEquals(1, countWhere("mypet.inventory_reservation", "status = 'RESERVED'"))
            assertEquals(1, countWhere("mypet.inventory_movement", "reason = 'ORDER_RESERVE'"))
            assertEquals(0, inventory.available(scenario.listingId))
            assertTrue(inventory.available(scenario.listingId) >= 0)
            inventory.requireReconciled(scope(scenario))

            val winnerOrderId = jdbc.queryForObject("SELECT id FROM mypet.product_order", UUID::class.java)!!
            val snapshotBefore = jdbc.queryForMap(
                "SELECT listing_name, quantity, unit_price_paise FROM mypet.product_order_line WHERE order_id = ?",
                winnerOrderId,
            )
            jdbc.update(
                "UPDATE mypet.catalog_listing SET name = 'Changed after order', selling_price_paise = 7000, version = version + 1 WHERE id = ?",
                scenario.listingId,
            )
            val snapshotAfter = jdbc.queryForMap(
                "SELECT listing_name, quantity, unit_price_paise FROM mypet.product_order_line WHERE order_id = ?",
                winnerOrderId,
            )
            assertEquals(snapshotBefore, snapshotAfter)
            assertEquals(9_000L, (snapshotAfter["unit_price_paise"] as Number).toLong())
        } finally {
            executor.shutdownNow()
        }
    }

    private fun enableProductStore(outletId: UUID, pincode: String) {
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.outlet_service_pincode(outlet_id, pincode, active) VALUES (?, ?, TRUE)", outletId, pincode)
    }

    private fun createCustomer(mobile: String): UUID = UUID.randomUUID().also { id ->
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'CUSTOMER', 'ACTIVE')", id, mobile)
    }

    private fun pickupQuote(scenario: MerchantScenario, customerId: UUID, quantity: Int, unitPricePaise: Long): Quote =
        QuoteService(persistence = JdbcQuotePersistence(jdbc, transactions)).createPickupQuote(
            customerId = customerId,
            outletId = scenario.outletId,
            lines = mapOf(scenario.listingId to (quantity to unitPricePaise)),
        )

    private fun seedStock(scenario: MerchantScenario, quantity: Int, key: String) {
        inventory.adjust(
            scenario.listingId,
            quantity,
            StockReason.RECEIPT,
            key,
            scenario.accountId,
            "trace-$key",
        )
    }

    private fun count(table: String): Int = jdbc.queryForObject("SELECT COUNT(*) FROM $table", Int::class.java) ?: 0
    private fun countWhere(table: String, predicate: String): Int = jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE $predicate", Int::class.java) ?: 0
    private fun scope(scenario: MerchantScenario) = `in`.mypetnew.catalog.domain.InventoryScope(scenario.organizationId, scenario.outletId, scenario.listingId)
}
