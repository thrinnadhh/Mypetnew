package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.CatalogMediaObjectStore
import `in`.mypetnew.catalog.domain.CatalogMediaService
import `in`.mypetnew.catalog.domain.InMemoryCatalogMediaPersistence
import `in`.mypetnew.common.error.DomainException
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class M4CatalogMediaIdempotencyContractTest {
    private val organizationId = UUID.randomUUID()
    private val outletId = UUID.randomUUID()
    private val listingId = UUID.randomUUID()

    @Test
    fun `lost response retry returns original attachment without a second upload`() {
        val store = RecordingStore()
        val service = CatalogMediaService(InMemoryCatalogMediaPersistence(), store)
        val bytes = jpegBytes(1)

        val first = service.uploadAndAttach(
            organizationId = organizationId,
            outletId = outletId,
            listingId = listingId,
            expectedVersion = 0,
            filename = "product.jpg",
            contentType = "image/jpeg",
            bytes = bytes,
            idempotencyKey = "media-retry-1",
        )
        val replay = service.uploadAndAttach(
            organizationId = organizationId,
            outletId = outletId,
            listingId = listingId,
            expectedVersion = 0,
            filename = "product.jpg",
            contentType = "image/jpeg",
            bytes = bytes,
            idempotencyKey = "media-retry-1",
        )

        assertEquals(first, replay)
        assertEquals(1, store.uploadCount)
        assertEquals(1, store.objects.size)
    }

    @Test
    fun `same idempotency key with changed payload fails before storage mutation`() {
        val store = RecordingStore()
        val service = CatalogMediaService(InMemoryCatalogMediaPersistence(), store)
        service.uploadAndAttach(
            organizationId = organizationId,
            outletId = outletId,
            listingId = listingId,
            expectedVersion = 0,
            filename = "product.jpg",
            contentType = "image/jpeg",
            bytes = jpegBytes(1),
            idempotencyKey = "media-retry-2",
        )

        val error = assertThrows(DomainException::class.java) {
            service.uploadAndAttach(
                organizationId = organizationId,
                outletId = outletId,
                listingId = listingId,
                expectedVersion = 0,
                filename = "product.jpg",
                contentType = "image/jpeg",
                bytes = jpegBytes(2),
                idempotencyKey = "media-retry-2",
            )
        }

        assertEquals("IDEMPOTENCY_KEY_REUSED", error.code)
        assertEquals(1, store.uploadCount)
        assertEquals(1, store.objects.size)
    }

    @Test
    fun `blank idempotency key is rejected before storage upload`() {
        val store = RecordingStore()
        val service = CatalogMediaService(InMemoryCatalogMediaPersistence(), store)

        val error = assertThrows(DomainException::class.java) {
            service.uploadAndAttach(
                organizationId = organizationId,
                outletId = outletId,
                listingId = listingId,
                expectedVersion = 0,
                filename = "product.jpg",
                contentType = "image/jpeg",
                bytes = jpegBytes(1),
                idempotencyKey = "   ",
            )
        }

        assertEquals("IDEMPOTENCY_KEY_INVALID", error.code)
        assertEquals(0, store.uploadCount)
    }

    private fun jpegBytes(marker: Int): ByteArray = byteArrayOf(
        0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), marker.toByte(),
    )

    private class RecordingStore : CatalogMediaObjectStore {
        val objects = linkedSetOf<String>()
        var uploadCount = 0

        override fun upload(objectKey: String, contentType: String, bytes: ByteArray): String {
            uploadCount += 1
            objects += objectKey
            return "https://catalog.example/$objectKey"
        }

        override fun delete(objectKey: String) {
            objects -= objectKey
        }
    }
}
