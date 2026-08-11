package `in`.mypetnew.storage

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.DocumentPurpose
import `in`.mypetnew.provider.domain.InMemoryPrivateDocumentStore
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
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
}

