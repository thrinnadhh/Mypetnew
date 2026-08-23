package `in`.mypetnew.merchantops

import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.core.io.support.PathMatchingResourcePatternResolver
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.simple.JdbcClient

@MerchantOpsContract
@MerchantOpsPostgres
class PostgresMigrationContractTest {
    private val dataSource = PostgresTestDatabase.dataSource()
    private val jdbc = JdbcClient.create(dataSource)

    @BeforeEach
    fun migrateFreshSchema() {
        val result = PostgresTestDatabase.resetAndMigrate()
        val migrationCount = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*.sql")
            .size
        assertEquals(migrationCount, result.migrationsExecuted)
    }

    @Test
    fun `real PostgreSQL clean migration preserves critical inventory constraints`() {
        val tables = jdbc.sql(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'mypet'",
        ).query(String::class.java).list().toSet()
        assertTrue(tables.containsAll(setOf("merchant_staff", "catalog_listing", "inventory_balance", "inventory_movement")))

        val fixture = MerchantScenarioFixture(dataSource)
        val scenario = fixture.create(onHand = 0, reserved = 0)
        assertThrows(DataIntegrityViolationException::class.java) {
            jdbc.sql("UPDATE mypet.inventory_balance SET reserved = 1 WHERE listing_id = ?")
                .param(scenario.listingId)
                .update()
        }
    }

    @Test
    fun `Merchant scenario fixture keeps organization and outlet data isolated`() {
        val fixture = MerchantScenarioFixture(dataSource)
        val first = fixture.create(onHand = 5)
        val second = fixture.create(onHand = 7)

        assertEquals(listOf(first.listingId), fixture.listingIds(first.organizationId, first.outletId))
        assertEquals(listOf(second.listingId), fixture.listingIds(second.organizationId, second.outletId))
        assertTrue(fixture.listingIds(first.organizationId, second.outletId).isEmpty())
    }
}
