package `in`.mypetnew.storage

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.DocumentPurpose
import `in`.mypetnew.provider.domain.InMemoryPrivateDocumentStore
import `in`.mypetnew.provider.domain.PrivateObjectRef
import `in`.mypetnew.provider.infrastructure.InMemoryPrivateDocumentMetadataRepository
import `in`.mypetnew.provider.infrastructure.PrivateObjectStorageClient
import `in`.mypetnew.provider.infrastructure.PrivateDocumentMetadata
import `in`.mypetnew.provider.infrastructure.PrivateDocumentMetadataRepository
import `in`.mypetnew.provider.infrastructure.SupabasePrivateDocumentStore
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class DocumentStoreContractTest {
    @Test
    fun `private evidence access is tenant and purpose bound with short expiry`() {
        val clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)
        val store = InMemoryPrivateDocumentStore(clock)
        val organization = UUID.randomUUID()
        val outlet = UUID.randomUUID()
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = organization,
            outletIds = setOf(outlet),
        )
        val objectRef = store.put(
            merchant,
            outlet,
            "gst-certificate.pdf",
            "application/pdf",
            byteArrayOf(0x25, 0x50, 0x44, 0x46),
            DocumentPurpose.PROVIDER_VERIFICATION,
        )
        val ownAccess = store.authorizeRead(merchant, objectRef, DocumentPurpose.PROVIDER_VERIFICATION)

        assertTrue(ownAccess.expiresAt.isAfter(clock.instant()))
        assertFalse(ownAccess.url.contains("gst-certificate.pdf"))
        val foreign = merchant.copy(organizationId = UUID.randomUUID(), outletIds = setOf(UUID.randomUUID()))
        assertThrows(DomainException::class.java) {
            store.authorizeRead(foreign, objectRef, DocumentPurpose.PROVIDER_VERIFICATION)
        }
        val reviewer = Principal(
            UUID.randomUUID(),
            Role.ADMIN,
            permissions = setOf(AdminPermission.PROVIDER_REVIEW),
        )
        assertTrue(store.authorizeRead(reviewer, objectRef, DocumentPurpose.PROVIDER_VERIFICATION).url.isNotBlank())
    }

    @Test
    fun `Supabase adapter uses opaque private keys and compensates failed metadata writes`() {
        val clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)
        val storage = RecordingStorageClient()
        val metadata = InMemoryPrivateDocumentMetadataRepository()
        val store = SupabasePrivateDocumentStore(metadata, storage, clock)
        val organization = UUID.randomUUID()
        val outlet = UUID.randomUUID()
        val merchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = organization,
            outletIds = setOf(outlet),
        )

        val ref = store.put(
            merchant,
            outlet,
            "gst-certificate.pdf",
            "application/pdf",
            byteArrayOf(0x25, 0x50, 0x44, 0x46),
            DocumentPurpose.PROVIDER_VERIFICATION,
        )
        assertFalse(storage.uploadedKey!!.contains("gst-certificate"))
        val access = store.authorizeRead(merchant, ref, DocumentPurpose.PROVIDER_VERIFICATION)
        assertTrue(access.url.startsWith("https://storage.example/private/"))
        assertTrue(access.expiresAt.isAfter(clock.instant()))
        assertThrows(DomainException::class.java) {
            store.authorizeRead(
                merchant.copy(organizationId = UUID.randomUUID(), outletIds = setOf(UUID.randomUUID())),
                ref,
                DocumentPurpose.PROVIDER_VERIFICATION,
            )
        }

        val compensatingStorage = RecordingStorageClient()
        val failingStore = SupabasePrivateDocumentStore(
            object : PrivateDocumentMetadataRepository {
                override fun save(metadata: PrivateDocumentMetadata) = error("database unavailable")
                override fun find(ref: PrivateObjectRef): PrivateDocumentMetadata? = null
            },
            compensatingStorage,
            clock,
        )
        assertThrows(DomainException::class.java) {
            failingStore.put(
                merchant,
                outlet,
                "gst-certificate.pdf",
                "application/pdf",
                byteArrayOf(0x25, 0x50, 0x44, 0x46),
                DocumentPurpose.PROVIDER_VERIFICATION,
            )
        }
        assertNull(compensatingStorage.uploadedKey)
    }

    private class RecordingStorageClient : PrivateObjectStorageClient {
        var uploadedKey: String? = null

        override fun upload(objectKey: String, contentType: String, bytes: ByteArray) {
            uploadedKey = objectKey
        }

        override fun delete(objectKey: String) {
            if (uploadedKey == objectKey) uploadedKey = null
        }

        override fun signRead(objectKey: String, expiresInSeconds: Long): String =
            "https://storage.example/private/$objectKey?expiresIn=$expiresInSeconds"
    }
}
