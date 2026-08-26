package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.CatalogMediaObjectStore
import `in`.mypetnew.catalog.domain.CatalogMediaService
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogMediaPersistence
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenario
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate

@MerchantOpsContract
@MerchantOpsPostgres
class M4CatalogMediaPostgresContractTest {
    @Test
    fun `M4-MEDIA-001 V27 upgrades V26 without historical migration changes`() {
        val dataSource = PostgresTestDatabase.dataSource()
        val legacy = flyway(dataSource, MigrationVersion.fromVersion("26"))
        legacy.clean()
        legacy.migrate()
        val jdbc = JdbcTemplate(dataSource)
        assertEquals(0, tableCount(jdbc, "catalog_media"))

        flyway(dataSource).migrate()

        assertEquals(1, tableCount(jdbc, "catalog_media"))
        assertEquals("27", flyway(dataSource).info().current()?.version?.version)
    }

    @Test
    fun `M4-MEDIA-001 finalization binds actor tenant listing active state permission and canonical object key`() {
        val context = context()
        val scenario = context.fixture.create()
        val first = upload(context, scenario, expectedVersion = 0, key = "m4-first")

        assertEquals(0, first.position)
        assertEquals(1, first.listingVersion)
        assertEquals(1, mediaCount(context.jdbc, scenario.listingId))
        assertEquals(1, listingImageCount(context.jdbc, scenario.listingId))
        assertEquals(
            "catalog/${scenario.organizationId}/${scenario.outletId}/${scenario.listingId}/${first.mediaId}",
            context.jdbc.queryForObject(
                "SELECT object_key FROM mypet.catalog_media WHERE id = ?",
                String::class.java,
                first.mediaId,
            ),
        )

        val other = context.fixture.create()
        val wrongScope = assertThrows(DomainException::class.java) {
            upload(
                context,
                scenario.copy(listingId = other.listingId),
                expectedVersion = 1,
                key = "m4-cross-tenant",
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", wrongScope.code)
        assertEquals(0, mediaCount(context.jdbc, other.listingId))

        context.jdbc.update("UPDATE mypet.catalog_listing SET active = FALSE WHERE id = ?", scenario.listingId)
        val inactive = assertThrows(DomainException::class.java) {
            upload(context, scenario, expectedVersion = 1, key = "m4-inactive")
        }
        assertEquals("RESOURCE_NOT_FOUND", inactive.code)
        assertEquals(1, mediaCount(context.jdbc, scenario.listingId))
    }

    @Test
    fun `permission revoked after object upload fails finalization and compensates object`() {
        val context = context()
        val scenario = context.fixture.create()
        val store = RecordingStore { objectKey ->
            context.jdbc.update(
                "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
                scenario.accountId,
                scenario.outletId,
            )
            "https://catalog.example/$objectKey"
        }
        val service = CatalogMediaService(context.persistence, store)

        val error = assertThrows(DomainException::class.java) {
            upload(service, scenario, 0, "m4-revoked")
        }

        assertEquals("MERCHANT_PERMISSION_REQUIRED", error.code)
        assertEquals(0, mediaCount(context.jdbc, scenario.listingId))
        assertEquals(1, store.deleted.size)
        assertTrue(store.objects.isEmpty())
    }

    @Test
    fun `database insertion failure rolls back and compensates storage`() {
        val context = context()
        val scenario = context.fixture.create()
        val store = RecordingStore()
        val service = CatalogMediaService(context.persistence, store)
        context.jdbc.execute(
            "CREATE OR REPLACE FUNCTION mypet.m4_media_fail() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''forced media failure''; END;'",
        )
        context.jdbc.execute(
            "CREATE TRIGGER m4_media_fail_trigger BEFORE INSERT ON mypet.catalog_media FOR EACH ROW EXECUTE FUNCTION mypet.m4_media_fail()",
        )
        try {
            assertThrows(Exception::class.java) {
                upload(service, scenario, 0, "m4-db-fail")
            }
        } finally {
            context.jdbc.execute("DROP TRIGGER IF EXISTS m4_media_fail_trigger ON mypet.catalog_media")
            context.jdbc.execute("DROP FUNCTION IF EXISTS mypet.m4_media_fail()")
        }
        assertEquals(0, mediaCount(context.jdbc, scenario.listingId))
        assertEquals(0, listingImageCount(context.jdbc, scenario.listingId))
        assertEquals(1, store.deleted.size)
        assertTrue(store.objects.isEmpty())
    }

    @Test
    fun `lost response retry is replayed and idempotency mismatch fails closed`() {
        val context = context()
        val scenario = context.fixture.create()
        val store = RecordingStore()
        val service = CatalogMediaService(context.persistence, store)

        val first = upload(service, scenario, 0, "m4-retry")
        val replay = upload(service, scenario, 0, "m4-retry")
        assertEquals(first, replay)
        assertEquals(1, store.uploadCount)
        assertEquals(1, mediaCount(context.jdbc, scenario.listingId))

        val mismatch = assertThrows(DomainException::class.java) {
            service.uploadAndAttach(
                scenario.accountId,
                scenario.organizationId,
                scenario.outletId,
                scenario.listingId,
                0,
                "different.jpg",
                "image/jpeg",
                jpegBytes(9),
                "m4-retry",
            )
        }
        assertEquals("IDEMPOTENCY_KEY_REUSED", mismatch.code)
        assertEquals(1, store.uploadCount)
    }

    @Test
    fun `five image boundary and concurrent fifth additions cannot overrun quota`() {
        val context = context()
        val scenario = context.fixture.create()
        val store = RecordingStore()
        val service = CatalogMediaService(context.persistence, store)
        var version = 0L
        repeat(4) { index ->
            version = upload(service, scenario, version, "m4-quota-$index", index).listingVersion
        }
        assertEquals(4, version)

        val ready = CountDownLatch(2)
        val go = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val futures = (0..1).map { index ->
                executor.submit(Callable {
                    ready.countDown()
                    check(go.await(10, TimeUnit.SECONDS))
                    runCatching { upload(service, scenario, 4, "m4-race-$index", 20 + index) }
                })
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS))
            go.countDown()
            val results = futures.map { it.get(30, TimeUnit.SECONDS) }
            assertEquals(1, results.count { it.isSuccess })
            val failure = results.single { it.isFailure }.exceptionOrNull()
            assertTrue(failure is DomainException)
            assertEquals("CATALOG_VERSION_CONFLICT", (failure as DomainException).code)
            assertEquals(5, mediaCount(context.jdbc, scenario.listingId))
            assertEquals(5, listingImageCount(context.jdbc, scenario.listingId))
            assertEquals(5, store.objects.size)
            assertEquals(1, store.deleted.size)
        } finally {
            go.countDown()
            executor.shutdownNow()
        }

        val sixth = assertThrows(DomainException::class.java) {
            upload(service, scenario, 5, "m4-sixth", 99)
        }
        assertEquals("CATALOG_MEDIA_QUOTA_EXCEEDED", sixth.code)
        assertEquals(5, mediaCount(context.jdbc, scenario.listingId))
        assertEquals(5, store.objects.size)
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        return Context(
            jdbc = jdbc,
            persistence = JdbcCatalogMediaPersistence(jdbc, transactions),
            fixture = MerchantScenarioFixture(dataSource),
        )
    }

    private fun upload(
        context: Context,
        scenario: MerchantScenario,
        expectedVersion: Long,
        key: String,
        marker: Int = 1,
    ) = upload(CatalogMediaService(context.persistence, RecordingStore()), scenario, expectedVersion, key, marker)

    private fun upload(
        service: CatalogMediaService,
        scenario: MerchantScenario,
        expectedVersion: Long,
        key: String,
        marker: Int = 1,
    ) = service.uploadAndAttach(
        scenario.accountId,
        scenario.organizationId,
        scenario.outletId,
        scenario.listingId,
        expectedVersion,
        "image-$marker.jpg",
        "image/jpeg",
        jpegBytes(marker),
        key,
    )

    private fun jpegBytes(marker: Int): ByteArray = byteArrayOf(
        0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), marker.toByte(),
    )

    private fun tableCount(jdbc: JdbcTemplate, table: String): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mypet' AND table_name = ?",
        Int::class.java,
        table,
    ) ?: 0

    private fun mediaCount(jdbc: JdbcTemplate, listingId: UUID): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.catalog_media WHERE listing_id = ?",
        Int::class.java,
        listingId,
    ) ?: 0

    private fun listingImageCount(jdbc: JdbcTemplate, listingId: UUID): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.catalog_listing_image WHERE listing_id = ?",
        Int::class.java,
        listingId,
    ) ?: 0

    private fun flyway(dataSource: DataSource, target: MigrationVersion? = null): Flyway {
        val configuration = Flyway.configure()
            .dataSource(dataSource)
            .schemas("mypet")
            .defaultSchema("mypet")
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
        if (target != null) configuration.target(target)
        return configuration.load()
    }

    private data class Context(
        val jdbc: JdbcTemplate,
        val persistence: JdbcCatalogMediaPersistence,
        val fixture: MerchantScenarioFixture,
    )

    private class RecordingStore(
        private val urlFactory: (String) -> String = { "https://catalog.example/$it" },
    ) : CatalogMediaObjectStore {
        val objects = linkedSetOf<String>()
        val deleted = mutableListOf<String>()
        var uploadCount = 0

        @Synchronized
        override fun upload(objectKey: String, contentType: String, bytes: ByteArray): String {
            uploadCount += 1
            objects += objectKey
            return urlFactory(objectKey)
        }

        @Synchronized
        override fun delete(objectKey: String) {
            deleted += objectKey
            objects -= objectKey
        }
    }
}
