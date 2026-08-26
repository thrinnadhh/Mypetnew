package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.CatalogMediaObjectStore
import `in`.mypetnew.catalog.domain.CatalogMediaPersistence
import `in`.mypetnew.catalog.domain.CatalogMediaService
import `in`.mypetnew.catalog.domain.InMemoryCatalogMediaPersistence
import `in`.mypetnew.common.error.DomainException
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class M4CatalogMediaContractTest {
    private val actorId = UUID.randomUUID()
    private val organizationId = UUID.randomUUID()
    private val outletId = UUID.randomUUID()
    private val listingId = UUID.randomUUID()

    @Test
    fun `valid image upload attaches managed HTTPS media and increments listing version`() {
        val store = RecordingStore()
        val service = service(store = store)

        val attachment = upload(service, expectedVersion = 0, filename = "product.jpg", type = "image/jpeg", bytes = jpegBytes(1))

        assertEquals(0, attachment.position)
        assertEquals(1, attachment.listingVersion)
        assertTrue(attachment.publicUrl.startsWith("https://catalog.example/catalog/"))
        assertEquals(1, store.objects.size)
    }

    @Test
    fun `unsupported svg script extension and spoofed mime are rejected before storage`() {
        listOf(
            Triple("payload.svg", "image/svg+xml", "<svg/>".toByteArray()),
            Triple("payload.exe", "image/jpeg", jpegBytes(3)),
            Triple("fake.jpg", "image/jpeg", "not-an-image".toByteArray()),
            Triple("polyglot.jpg", "image/jpeg", jpegBytes(4) + "<script>alert(1)</script>".toByteArray()),
        ).forEach { (name, type, bytes) ->
            val store = RecordingStore()
            val error = assertThrows(DomainException::class.java) {
                upload(service(store = store), 0, name, type, bytes)
            }
            assertEquals("CATALOG_MEDIA_INVALID", error.code)
            assertTrue(store.objects.isEmpty())
        }
    }

    @Test
    fun `oversized image is rejected before storage upload`() {
        val store = RecordingStore()
        val bytes = ByteArray(CatalogMediaService.MAX_MEDIA_BYTES + 1)
        bytes[0] = 0x89.toByte()
        bytes[1] = 0x50
        bytes[2] = 0x4e
        bytes[3] = 0x47
        bytes[4] = 0x0d
        bytes[5] = 0x0a
        bytes[6] = 0x1a
        bytes[7] = 0x0a

        val error = assertThrows(DomainException::class.java) {
            upload(service(store = store), 0, "large.png", "image/png", bytes)
        }

        assertEquals("CATALOG_MEDIA_INVALID", error.code)
        assertTrue(store.objects.isEmpty())
    }

    @Test
    fun `sixth image is rejected and uploaded object is cleaned up`() {
        val store = RecordingStore()
        val service = service(store = store)
        var version = 0L
        repeat(CatalogMediaService.MAX_MEDIA_PER_LISTING) { index ->
            version = upload(service, version, "image-$index.webp", "image/webp", webpBytes(index), "quota-$index").listingVersion
        }
        assertEquals(5, store.objects.size)

        val error = assertThrows(DomainException::class.java) {
            upload(service, version, "too-many.webp", "image/webp", webpBytes(9), "quota-6")
        }

        assertEquals("CATALOG_MEDIA_QUOTA_EXCEEDED", error.code)
        assertEquals(5, store.objects.size)
        assertEquals(1, store.deleted.size)
    }

    @Test
    fun `stale finalization cleans uploaded object and leaves prior media intact`() {
        val store = RecordingStore()
        val service = service(store = store)
        upload(service, 0, "first.jpg", "image/jpeg", jpegBytes(1), "stale-first")

        val error = assertThrows(DomainException::class.java) {
            upload(service, 0, "stale.jpg", "image/jpeg", jpegBytes(2), "stale-second")
        }

        assertEquals("CATALOG_VERSION_CONFLICT", error.code)
        assertEquals(1, store.objects.size)
        assertEquals(1, store.deleted.size)
    }

    @Test
    fun `persistence failure always compensates uploaded object`() {
        val store = RecordingStore()
        val failingPersistence = CatalogMediaPersistence { _, _ ->
            throw DomainException("CATALOG_MEDIA_FINALIZATION_FAILED", "failed")
        }
        val service = CatalogMediaService(failingPersistence, store)

        val error = assertThrows(DomainException::class.java) {
            upload(service, 0, "image.png", "image/png", pngBytes(3), "db-fail")
        }

        assertEquals("CATALOG_MEDIA_FINALIZATION_FAILED", error.code)
        assertTrue(store.objects.isEmpty())
        assertEquals(1, store.deleted.size)
    }

    @Test
    fun `invalid or noncanonical public store URL is rejected and compensated`() {
        listOf(
            "http://catalog.example/",
            "https://catalog.example/not-managed/",
        ).forEach { prefix ->
            val store = RecordingStore(publicUrlPrefix = prefix, appendObjectKey = !prefix.contains("not-managed"))
            val error = assertThrows(DomainException::class.java) {
                upload(service(store = store), 0, "image.jpg", "image/jpeg", jpegBytes(4), "bad-url-${prefix.hashCode()}")
            }
            assertEquals("CATALOG_MEDIA_STORE_INVALID", error.code)
            assertTrue(store.objects.isEmpty())
            assertEquals(1, store.deleted.size)
        }
    }

    @Test
    fun `concurrent additions with one expected version serialize to one success and one cleanup`() {
        val store = RecordingStore()
        val service = service(store = store)
        val ready = CountDownLatch(2)
        val go = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val futures = (1..2).map { marker ->
                executor.submit(Callable {
                    ready.countDown()
                    check(go.await(5, TimeUnit.SECONDS))
                    runCatching {
                        upload(service, 0, "concurrent-$marker.jpg", "image/jpeg", jpegBytes(marker), "concurrent-$marker")
                    }
                })
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            go.countDown()
            val results = futures.map { it.get(10, TimeUnit.SECONDS) }
            assertEquals(1, results.count { it.isSuccess })
            val failure = results.single { it.isFailure }.exceptionOrNull()
            assertTrue(failure is DomainException)
            assertEquals("CATALOG_VERSION_CONFLICT", (failure as DomainException).code)
            assertEquals(1, store.objects.size)
            assertEquals(1, store.deleted.size)
        } finally {
            go.countDown()
            executor.shutdownNow()
        }
    }

    private fun service(
        persistence: CatalogMediaPersistence = InMemoryCatalogMediaPersistence(),
        store: RecordingStore,
    ) = CatalogMediaService(persistence, store)

    private fun upload(
        service: CatalogMediaService,
        expectedVersion: Long,
        filename: String,
        type: String,
        bytes: ByteArray,
        key: String = "media-${UUID.randomUUID()}",
    ) = service.uploadAndAttach(
        actorId = actorId,
        organizationId = organizationId,
        outletId = outletId,
        listingId = listingId,
        expectedVersion = expectedVersion,
        filename = filename,
        contentType = type,
        bytes = bytes,
        idempotencyKey = key,
    )

    private fun jpegBytes(marker: Int): ByteArray = byteArrayOf(
        0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), marker.toByte(),
    )

    private fun pngBytes(marker: Int): ByteArray = byteArrayOf(
        0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker.toByte(),
    )

    private fun webpBytes(marker: Int): ByteArray = byteArrayOf(
        0x52, 0x49, 0x46, 0x46, marker.toByte(), 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    )

    private class RecordingStore(
        private val publicUrlPrefix: String = "https://catalog.example/",
        private val appendObjectKey: Boolean = true,
    ) : CatalogMediaObjectStore {
        val objects = linkedSetOf<String>()
        val deleted = mutableListOf<String>()

        @Synchronized
        override fun upload(objectKey: String, contentType: String, bytes: ByteArray): String {
            objects += objectKey
            return if (appendObjectKey) "$publicUrlPrefix$objectKey" else "${publicUrlPrefix}object"
        }

        @Synchronized
        override fun delete(objectKey: String) {
            deleted += objectKey
            objects -= objectKey
        }
    }
}
