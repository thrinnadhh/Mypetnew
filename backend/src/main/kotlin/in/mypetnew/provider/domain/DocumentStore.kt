package `in`.mypetnew.provider.domain

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

enum class DocumentPurpose { PROVIDER_VERIFICATION }

data class PrivateObjectRef(val value: UUID)

data class SignedDocumentAccess(val url: String, val expiresAt: Instant)

interface DocumentStore {
    fun put(
        actor: Principal,
        outletId: UUID,
        filename: String,
        contentType: String,
        bytes: ByteArray,
        purpose: DocumentPurpose,
    ): PrivateObjectRef

    fun authorizeRead(actor: Principal, ref: PrivateObjectRef, purpose: DocumentPurpose): SignedDocumentAccess
}

class InMemoryPrivateDocumentStore(
    private val clock: Clock = Clock.systemUTC(),
    private val accessLifetime: Duration = Duration.ofMinutes(5),
) : DocumentStore {
    private data class StoredObject(
        val organizationId: UUID,
        val outletId: UUID,
        val purpose: DocumentPurpose,
        val contentType: String,
        val bytes: ByteArray,
    )

    private val objects = mutableMapOf<PrivateObjectRef, StoredObject>()

    @Synchronized
    override fun put(
        actor: Principal,
        outletId: UUID,
        filename: String,
        contentType: String,
        bytes: ByteArray,
        purpose: DocumentPurpose,
    ): PrivateObjectRef {
        val organizationId = actor.organizationId
        if (actor.role != Role.MERCHANT || organizationId == null || outletId !in actor.outletIds) deny()
        if (
            filename.length !in 1..180 ||
            filename.contains("..") ||
            filename.contains('/') ||
            filename.contains('\\') ||
            contentType !in setOf("application/pdf", "image/jpeg", "image/png") ||
            bytes.isEmpty() ||
            bytes.size > 10 * 1024 * 1024
        ) {
            throw DomainException("DOCUMENT_INVALID", "The document cannot be accepted")
        }
        val ref = PrivateObjectRef(UUID.randomUUID())
        objects[ref] = StoredObject(organizationId, outletId, purpose, contentType, bytes.copyOf())
        return ref
    }

    @Synchronized
    override fun authorizeRead(
        actor: Principal,
        ref: PrivateObjectRef,
        purpose: DocumentPurpose,
    ): SignedDocumentAccess {
        val stored = objects[ref] ?: deny()
        if (stored.purpose != purpose) deny()
        val merchantAllowed = actor.role == Role.MERCHANT &&
            actor.organizationId == stored.organizationId &&
            stored.outletId in actor.outletIds
        val adminAllowed = actor.role == Role.ADMIN && AdminPermission.PROVIDER_REVIEW in actor.permissions
        if (!merchantAllowed && !adminAllowed) deny()
        val expiresAt = clock.instant().plus(accessLifetime)
        val signatureSeed = "${ref.value}:$purpose:${actor.actorId}:$expiresAt"
        val signature = MessageDigest.getInstance("SHA-256")
            .digest(signatureSeed.toByteArray())
            .take(16)
            .joinToString("") { "%02x".format(it) }
        return SignedDocumentAccess(
            url = "https://storage.invalid/private/${ref.value}?expires=${expiresAt.epochSecond}&signature=$signature",
            expiresAt = expiresAt,
        )
    }

    private fun deny(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
}

