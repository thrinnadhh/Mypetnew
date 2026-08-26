package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.CatalogMediaObjectStore
import `in`.mypetnew.catalog.domain.CatalogMediaService
import `in`.mypetnew.catalog.domain.InMemoryCatalogMediaPersistence
import `in`.mypetnew.common.error.DomainException
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class M4CatalogMediaIdempotencyContractTest {
    private val actorId = UUID.randomUUID()
    private val organizationId = UUID.randomUUID()
    private val outletId = UUID.randomUUID()
    private val listingId = UUID.randomUUID()

    @Test
    fun `lost response retry returns persisted attachment without a second object upload`() {
        val store = CountingStore()
        val service = CatalogMediaService(InMemoryCatalogMediaPersistence(), store)
        val bytes = jpegBytes(7)

        val first = upload(service, bytes, "retry-key")
        val replay = upload(service, bytes, "retry-key")

        assertEquals(first, replay)
        assertEquals(1, store.uploadCount)
        assertEquals(0, store.deleteCount)
    }

    @Test
    fun `same key with changed bytes or expected version fails before new storage side effect`() {
        val store = CountingStore()
        val service = CatalogMediaService(InMemoryCatalogMediaPersistence(), store)
        upload(service, jpegBytes(1), "bound-key")

        val changedBytes = assertThrows(DomainException::class.java) {
            upload(service, jpegBytes(2), "bound-key")
        }
        assertEquals("IDEMPOTENCY_KEY_REUSED", changedBytes.code)

        val changedVersion = assertThrows(DomainException::class.java) {
            service.uploadAndAttach(
                actorId,
                organizationId,
                outletId,
                listingId,
                1,
                "image.jpg",
                "image/jpeg",
                jpegBytes(1),
                "bound-key",
            )
        }
        assertEquals("IDEMPOTENCY_KEY_REUSED", changedVersion.code)
        assertEquals(1, store.uploadCount)
        assertEquals(0, store.deleteCount)
    }

    @Test
    fun `invalid idempotency key fails before storage`() {
        val store = CountingStore()
        val service = CatalogMediaService(InMemoryCatalogMediaPersistence(), store)
        listOf("", "bad key", "x".repeat(129)).forEach { key ->
            val error = assertThrows(DomainException::class.java) {
                upload(service, jpegBytes(1), key)
            }
            assertEquals("IDEMPOTENCY_KEY_INVALID", error.code)
        }
        assertEquals(0, store.uploadCount)
        assertTrue(store.objects.isEmpty())
    }

    private fun upload(service: CatalogMediaService, bytes: ByteArray, key: String) = service.uploadAndAttach(
        actorId,
        organizationId,
        outletId,
        listingId,
        0,
        "image.jpg",
        "image/jpeg",
        bytes,
        key,
    )

    private fun jpegBytes(marker: Int): ByteArray = byteArrayOf(
        0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), marker.toByte(),
    )

    private class CountingStore : CatalogMediaObjectStore {
        val objects = linkedSetOf<String>()
        var uploadCount = 0
        var deleteCount = 0

        override fun upload(objectKey: String, contentType: String, bytes: ByteArray): String {
            uploadCount += 1
            objects += objectKey
            return "https://catalog.example/$objectKey"
        }

        override fun delete(objectKey: String) {
            deleteCount += 1
            objects -= objectKey
        }
    }
}
