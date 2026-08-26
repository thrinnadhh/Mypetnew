package `in`.mypetnew.catalog.domain

import `in`.mypetnew.common.error.DomainException
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service

data class CatalogMediaUpload(
    val id: UUID,
    val actorId: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val listingId: UUID,
    val objectKey: String,
    val publicUrl: String,
    val contentType: String,
    val sizeBytes: Long,
    val checksum: String,
    val idempotencyKey: String,
    val requestFingerprint: String,
)

data class CatalogMediaAttachment(
    val mediaId: UUID,
    val listingId: UUID,
    val position: Int,
    val publicUrl: String,
    val contentType: String,
    val sizeBytes: Long,
    val listingVersion: Long,
)

data class CatalogMediaAttachResult(
    val attachment: CatalogMediaAttachment,
    val replayed: Boolean,
)

fun interface CatalogMediaPersistence {
    fun attach(upload: CatalogMediaUpload, expectedVersion: Long): CatalogMediaAttachResult

    fun findReplay(
        outletId: UUID,
        listingId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CatalogMediaAttachment? = null
}

interface CatalogMediaObjectStore {
    fun upload(objectKey: String, contentType: String, bytes: ByteArray): String
    fun delete(objectKey: String)
}

@Service
class CatalogMediaService(
    private val persistence: CatalogMediaPersistence,
    private val objectStore: CatalogMediaObjectStore,
) {
    fun uploadAndAttach(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        listingId: UUID,
        expectedVersion: Long,
        filename: String,
        contentType: String,
        bytes: ByteArray,
        idempotencyKey: String,
    ): CatalogMediaAttachment {
        if (expectedVersion < 0) versionConflict()
        val normalizedKey = idempotencyKey.trim()
        if (!IDEMPOTENCY_KEY.matches(normalizedKey)) invalidIdempotencyKey()

        val normalizedContentType = contentType.trim().lowercase(Locale.ROOT)
        validateFile(filename, normalizedContentType, bytes)
        val checksum = sha256(bytes)
        val requestFingerprint = sha256(
            listOf(
                actorId.toString(),
                organizationId.toString(),
                outletId.toString(),
                listingId.toString(),
                expectedVersion.toString(),
                normalizedContentType,
                bytes.size.toString(),
                checksum,
            ).joinToString("|").toByteArray(StandardCharsets.UTF_8),
        )

        persistence.findReplay(outletId, listingId, normalizedKey, requestFingerprint)?.let { return it }

        val mediaId = UUID.randomUUID()
        val objectKey = "catalog/$organizationId/$outletId/$listingId/$mediaId"
        val publicUrl = try {
            objectStore.upload(objectKey, normalizedContentType, bytes)
        } catch (error: DomainException) {
            throw error
        } catch (_: Exception) {
            unavailable()
        }

        try {
            validatePublicUrl(publicUrl, objectKey)
        } catch (error: Exception) {
            runCatching { objectStore.delete(objectKey) }
            throw error
        }

        val upload = CatalogMediaUpload(
            id = mediaId,
            actorId = actorId,
            organizationId = organizationId,
            outletId = outletId,
            listingId = listingId,
            objectKey = objectKey,
            publicUrl = publicUrl,
            contentType = normalizedContentType,
            sizeBytes = bytes.size.toLong(),
            checksum = checksum,
            idempotencyKey = normalizedKey,
            requestFingerprint = requestFingerprint,
        )

        return try {
            val result = persistence.attach(upload, expectedVersion)
            if (result.replayed) runCatching { objectStore.delete(objectKey) }
            result.attachment
        } catch (error: Exception) {
            runCatching { objectStore.delete(objectKey) }
            throw error
        }
    }

    private fun validateFile(filename: String, contentType: String, bytes: ByteArray) {
        val safeName = filename.trim()
        val extension = safeName.substringAfterLast('.', missingDelimiterValue = "").lowercase(Locale.ROOT)
        if (
            safeName.length !in 1..MAX_FILENAME_LENGTH ||
            safeName.contains("..") ||
            safeName.contains('/') ||
            safeName.contains('\\') ||
            contentType !in ALLOWED_CONTENT_TYPES ||
            extension !in EXTENSIONS.getValue(contentType) ||
            bytes.isEmpty() ||
            bytes.size > MAX_MEDIA_BYTES ||
            !matchesContentSignature(contentType, bytes) ||
            containsScriptMarker(bytes)
        ) {
            invalidMedia()
        }
    }

    private fun matchesContentSignature(contentType: String, bytes: ByteArray): Boolean = when (contentType) {
        "image/jpeg" -> bytes.size >= 3 &&
            bytes[0].toInt() and 0xff == 0xff &&
            bytes[1].toInt() and 0xff == 0xd8 &&
            bytes[2].toInt() and 0xff == 0xff
        "image/png" -> bytes.size >= PNG_SIGNATURE.size &&
            PNG_SIGNATURE.indices.all { bytes[it] == PNG_SIGNATURE[it] }
        "image/webp" -> bytes.size >= 12 &&
            bytes.copyOfRange(0, 4).contentEquals(RIFF_SIGNATURE) &&
            bytes.copyOfRange(8, 12).contentEquals(WEBP_SIGNATURE)
        else -> false
    }

    private fun containsScriptMarker(bytes: ByteArray): Boolean {
        val probe = String(bytes.copyOfRange(0, minOf(bytes.size, SCRIPT_PROBE_BYTES)), StandardCharsets.ISO_8859_1)
            .lowercase(Locale.ROOT)
        return SCRIPT_MARKERS.any(probe::contains)
    }

    private fun validatePublicUrl(value: String, objectKey: String) {
        val uri = runCatching { URI(value) }.getOrElse { invalidStoreUrl() }
        if (
            !uri.isAbsolute ||
            !uri.scheme.equals("https", ignoreCase = true) ||
            uri.host.isNullOrBlank() ||
            uri.userInfo != null ||
            uri.rawUserInfo != null ||
            value.length > MAX_PUBLIC_URL_LENGTH ||
            !uri.path.endsWith("/$objectKey")
        ) invalidStoreUrl()
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun invalidMedia(): Nothing = throw DomainException(
        "CATALOG_MEDIA_INVALID",
        "The catalog image cannot be accepted",
    )

    private fun invalidStoreUrl(): Nothing = throw DomainException(
        "CATALOG_MEDIA_STORE_INVALID",
        "The catalog media store returned an invalid public URL",
    )

    private fun unavailable(): Nothing = throw DomainException(
        "CATALOG_MEDIA_STORE_UNAVAILABLE",
        "Catalog media storage is temporarily unavailable",
    )

    private fun versionConflict(): Nothing = throw DomainException(
        "CATALOG_VERSION_CONFLICT",
        "The listing changed concurrently; refresh and retry",
    )

    private fun invalidIdempotencyKey(): Nothing = throw DomainException(
        "IDEMPOTENCY_KEY_INVALID",
        "A valid idempotency key is required",
    )

    companion object {
        const val MAX_MEDIA_PER_LISTING = 5
        const val MAX_MEDIA_BYTES = 5 * 1024 * 1024
        const val MAX_IDEMPOTENCY_KEY_LENGTH = 128
        private const val MAX_FILENAME_LENGTH = 180
        private const val MAX_PUBLIC_URL_LENGTH = 2048
        private const val SCRIPT_PROBE_BYTES = 4096
        private val IDEMPOTENCY_KEY = Regex("[A-Za-z0-9._:-]{1,$MAX_IDEMPOTENCY_KEY_LENGTH}")
        private val ALLOWED_CONTENT_TYPES = setOf("image/jpeg", "image/png", "image/webp")
        private val EXTENSIONS = mapOf(
            "image/jpeg" to setOf("jpg", "jpeg"),
            "image/png" to setOf("png"),
            "image/webp" to setOf("webp"),
        )
        private val SCRIPT_MARKERS = listOf("<script", "<svg", "<?xml", "<!doctype html", "javascript:")
        private val PNG_SIGNATURE = byteArrayOf(
            0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        )
        private val RIFF_SIGNATURE = byteArrayOf(0x52, 0x49, 0x46, 0x46)
        private val WEBP_SIGNATURE = byteArrayOf(0x57, 0x45, 0x42, 0x50)
    }
}

@Repository
@Profile("test", "development")
class InMemoryCatalogMediaPersistence : CatalogMediaPersistence {
    private data class ReplayRecord(
        val listingId: UUID,
        val requestFingerprint: String,
        val attachment: CatalogMediaAttachment,
    )

    private val records = mutableMapOf<UUID, MutableList<CatalogMediaAttachment>>()
    private val versions = mutableMapOf<UUID, Long>()
    private val receipts = mutableMapOf<Pair<UUID, String>, ReplayRecord>()

    @Synchronized
    override fun findReplay(
        outletId: UUID,
        listingId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CatalogMediaAttachment? {
        val existing = receipts[outletId to idempotencyKey] ?: return null
        if (existing.listingId != listingId || existing.requestFingerprint != requestFingerprint) replayConflict()
        return existing.attachment
    }

    @Synchronized
    override fun attach(upload: CatalogMediaUpload, expectedVersion: Long): CatalogMediaAttachResult {
        findReplay(
            upload.outletId,
            upload.listingId,
            upload.idempotencyKey,
            upload.requestFingerprint,
        )?.let { return CatalogMediaAttachResult(it, replayed = true) }

        val currentVersion = versions.getOrPut(upload.listingId) { expectedVersion }
        if (currentVersion != expectedVersion) versionConflict()
        val listingRecords = records.getOrPut(upload.listingId) { mutableListOf() }
        if (listingRecords.size >= CatalogMediaService.MAX_MEDIA_PER_LISTING) quotaExceeded()
        val nextVersion = currentVersion + 1
        val attachment = CatalogMediaAttachment(
            mediaId = upload.id,
            listingId = upload.listingId,
            position = listingRecords.size,
            publicUrl = upload.publicUrl,
            contentType = upload.contentType,
            sizeBytes = upload.sizeBytes,
            listingVersion = nextVersion,
        )
        listingRecords += attachment
        versions[upload.listingId] = nextVersion
        receipts[upload.outletId to upload.idempotencyKey] = ReplayRecord(
            listingId = upload.listingId,
            requestFingerprint = upload.requestFingerprint,
            attachment = attachment,
        )
        return CatalogMediaAttachResult(attachment, replayed = false)
    }

    private fun quotaExceeded(): Nothing = throw DomainException(
        "CATALOG_MEDIA_QUOTA_EXCEEDED",
        "A listing can have at most five images",
    )

    private fun versionConflict(): Nothing = throw DomainException(
        "CATALOG_VERSION_CONFLICT",
        "The listing changed concurrently; refresh and retry",
    )

    private fun replayConflict(): Nothing = throw DomainException(
        "IDEMPOTENCY_KEY_REUSED",
        "The idempotency key was already used for a different request",
    )
}

@Service
@Profile("test", "development")
class InMemoryCatalogMediaObjectStore : CatalogMediaObjectStore {
    private val objects = mutableSetOf<String>()

    @Synchronized
    override fun upload(objectKey: String, contentType: String, bytes: ByteArray): String {
        if (!objects.add(objectKey)) unavailable()
        return "https://catalog-media.test/$objectKey"
    }

    @Synchronized
    override fun delete(objectKey: String) {
        objects.remove(objectKey)
    }

    private fun unavailable(): Nothing = throw DomainException(
        "CATALOG_MEDIA_STORE_UNAVAILABLE",
        "Catalog media storage is temporarily unavailable",
    )
}
