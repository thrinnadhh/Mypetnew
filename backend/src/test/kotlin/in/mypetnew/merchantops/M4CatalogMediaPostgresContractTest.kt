package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.CatalogMediaObjectStore
import `in`.mypetnew.catalog.domain.CatalogMediaService
import `in`.mypetnew.catalog.infrastructure.CatalogMediaCleanupWorker
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogMediaPersistence
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsConcurrency
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
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
import org.junit.jupiter.api.Assertions.assertFalse
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
    fun `V28 upgrades V27 forward without mutating the historical media migration`() {
        val dataSource = PostgresTestDatabase.dataSource()
        val toV27 = flyway(dataSource, MigrationVersion.fromVersion("27"))
        toV27.clean()
        val v27 = toV27.migrate()
        assertEquals("27", v27.targetSchemaVersion)
        val jdbc = JdbcTemplate(dataSource)
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'mypet' AND table_name = 'catalog_media' AND column_name = 'actor_id'",
                Int::class.java,
            ),
        )
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mypet' AND table_name = 'catalog_media_cleanup'",
                Int::class.java,
            ),
        )

        val upgraded = flyway(dataSource).migrate()
        assertEquals("28", upgraded.targetSchemaVersion)
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'mypet' AND table_name = 'catalog_media' AND column_name = 'actor_id'",
                Int::class.java,
            ),
        )
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mypet' AND table_name = 'catalog_media_cleanup'",
                Int::class.java,
            ),
        )
    }

    @Test
    fun `exact idempotency replay after permission revocation fails before another storage upload`() {
        val context = context()
        val scope = seedScope(context.jdbc)
        val store = RecordingStore()
        val service = CatalogMediaService(context.persistence, store)

        val first = upload(service, scope, 0, "replay-key", jpegBytes(1))
        assertEquals(1, first.listingVersion)
        assertEquals(1, store.uploadCount)

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            scope.actorId,
            scope.outletId,
        )
        val failure = assertThrows(DomainException::class.java) {
            upload(service, scope, 0, "replay-key", jpegBytes(1))
        }

        assertEquals("MERCHANT_PERMISSION_REQUIRED", failure.code)
        assertEquals(1, store.uploadCount)
        assertEquals(1, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_media", Int::class.java))
    }

    @Test
    fun `permission revoked after object upload fails finalization and compensates storage`() {
        val context = context()
        val scope = seedScope(context.jdbc)
        val store = RecordingStore(onUpload = {
            context.jdbc.update(
                "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
                scope.actorId,
                scope.outletId,
            )
        })
        val service = CatalogMediaService(context.persistence, store)

        val failure = assertThrows(DomainException::class.java) {
            upload(service, scope, 0, "revoke-after-upload", jpegBytes(2))
        }

        assertEquals("MERCHANT_PERMISSION_REQUIRED", failure.code)
        assertTrue(store.objects.isEmpty())
        assertEquals(0, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_media", Int::class.java))
        assertEquals(0, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_listing_image", Int::class.java))
    }

    @Test
    fun `failed compensation persists cleanup and worker eventually deletes the orphan`() {
        val context = context()
        val scope = seedScope(context.jdbc)
        val store = RecordingStore()
        val service = CatalogMediaService(context.persistence, store)
        upload(service, scope, 0, "cleanup-first", jpegBytes(3))

        store.failDelete = true
        val failure = assertThrows(DomainException::class.java) {
            upload(service, scope, 0, "cleanup-stale", jpegBytes(4))
        }
        assertEquals("CATALOG_VERSION_CONFLICT", failure.code)
        assertEquals(1, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_media_cleanup", Int::class.java))
        assertEquals(2, store.objects.size)

        store.failDelete = false
        CatalogMediaCleanupWorker(context.jdbc, store).retryDueCleanup()
        assertEquals(0, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_media_cleanup", Int::class.java))
        assertEquals(1, store.objects.size)
    }

    @Test
    @MerchantOpsConcurrency
    fun `concurrent fifth image has one database winner and no quota overflow`() {
        val context = context()
        val scope = seedScope(context.jdbc)
        val store = RecordingStore()
        val service = CatalogMediaService(context.persistence, store)
        var version = 0L
        repeat(4) { index ->
            version = upload(service, scope, version, "seed-$index", jpegBytes(index + 10)).listingVersion
        }
        assertEquals(4, version)

        val ready = CountDownLatch(2)
        val go = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val futures = (1..2).map { marker ->
                executor.submit(Callable {
                    ready.countDown()
                    check(go.await(5, TimeUnit.SECONDS))
                    runCatching { upload(service, scope, 4, "fifth-$marker", jpegBytes(marker + 30)) }
                })
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            go.countDown()
            val results = futures.map { it.get(15, TimeUnit.SECONDS) }
            assertEquals(1, results.count { it.isSuccess })
            val loser = results.single { it.isFailure }.exceptionOrNull()
            assertTrue(loser is DomainException)
            assertTrue((loser as DomainException).code in setOf("CATALOG_VERSION_CONFLICT", "CATALOG_MEDIA_CONFLICT"))
            assertEquals(5, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_media", Int::class.java))
            assertEquals(5, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_listing_image", Int::class.java))
            assertEquals(5, store.objects.size)
        } finally {
            go.countDown()
            executor.shutdownNow()
        }
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        return Context(jdbc, JdbcCatalogMediaPersistence(jdbc, transactions))
    }

    private fun seedScope(jdbc: JdbcTemplate): Scope {
        val actorId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        val listingId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')",
            actorId,
            "+919390${actorId.toString().replace("-", "").take(6)}",
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M4 Media Org', 'ACTIVE', ?)",
            organizationId,
            actorId,
        )
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M4 Media Outlet', 'ACTIVE', TRUE)",
            outletId,
            organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)",
            outletId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'CATALOG_WRITE', TRUE)",
            actorId,
            organizationId,
            outletId,
        )
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, raw_barcode_audit,
                name, listing_kind, commerce_mode, mrp_paise, selling_price_paise, active, version,
                category, created_at, updated_at
            ) VALUES (?, ?, ?, 'INTERNAL', ?, ?, 'M4 managed media listing',
                      'PRODUCT', 'COMMERCE', 12000, 11000, TRUE, 0, 'food', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """.trimIndent(),
            listingId,
            organizationId,
            outletId,
            "M4-${listingId.toString().take(8)}",
            "M4-${listingId.toString().take(8)}",
        )
        return Scope(actorId, organizationId, outletId, listingId)
    }

    private fun upload(
        service: CatalogMediaService,
        scope: Scope,
        expectedVersion: Long,
        key: String,
        bytes: ByteArray,
    ) = service.uploadAndAttach(
        actorId = scope.actorId,
        organizationId = scope.organizationId,
        outletId = scope.outletId,
        listingId = scope.listingId,
        expectedVersion = expectedVersion,
        filename = "$key.jpg",
        contentType = "image/jpeg",
        bytes = bytes,
        idempotencyKey = key,
    )

    private fun jpegBytes(marker: Int): ByteArray = byteArrayOf(
        0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), marker.toByte(),
    )

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

    private data class Scope(
        val actorId: UUID,
        val organizationId: UUID,
        val outletId: UUID,
        val listingId: UUID,
    )

    private data class Context(
        val jdbc: JdbcTemplate,
        val persistence: JdbcCatalogMediaPersistence,
    )

    private class RecordingStore(
        private val onUpload: (() -> Unit)? = null,
    ) : CatalogMediaObjectStore {
        val objects = linkedSetOf<String>()
        var uploadCount = 0
        var failDelete = false

        @Synchronized
        override fun upload(objectKey: String, contentType: String, bytes: ByteArray): String {
            uploadCount += 1
            objects += objectKey
            onUpload?.invoke()
            return "https://catalog.example/$objectKey"
        }

        @Synchronized
        override fun delete(objectKey: String) {
            if (failDelete) throw DomainException("CATALOG_MEDIA_STORE_UNAVAILABLE", "delete failed")
            objects -= objectKey
        }
    }
}
