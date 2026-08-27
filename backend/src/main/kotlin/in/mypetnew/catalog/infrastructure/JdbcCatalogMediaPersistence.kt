package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.CatalogMediaAttachResult
import `in`.mypetnew.catalog.domain.CatalogMediaAttachment
import `in`.mypetnew.catalog.domain.CatalogMediaCleanupTask
import `in`.mypetnew.catalog.domain.CatalogMediaPersistence
import `in`.mypetnew.catalog.domain.CatalogMediaService
import `in`.mypetnew.catalog.domain.CatalogMediaUpload
import `in`.mypetnew.common.error.DomainException
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import org.springframework.context.annotation.Profile
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.transaction.support.TransactionTemplate

@Repository
@Profile("!test & !development")
class JdbcCatalogMediaPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : CatalogMediaPersistence {
    private data class ReplayRow(
        val listingId: UUID,
        val requestFingerprint: String,
        val attachment: CatalogMediaAttachment,
    )

    private data class ListingLock(
        val version: Long,
        val active: Boolean,
    )

    override fun findReplay(
        outletId: UUID,
        listingId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CatalogMediaAttachment? = replay(outletId, listingId, idempotencyKey, requestFingerprint)

    override fun findAuthorizedReplay(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        listingId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CatalogMediaAttachment? = transactions.execute {
        requireActiveListingAndCurrentAuthority(actorId, organizationId, outletId, listingId)
        replay(outletId, listingId, idempotencyKey, requestFingerprint)
    }

    override fun enqueueCleanup(task: CatalogMediaCleanupTask, reason: String) {
        jdbc.update(
            """
            INSERT INTO mypet.catalog_media_cleanup (
                object_key, organization_id, outlet_id, listing_id, reason,
                attempts, next_attempt_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (object_key) DO UPDATE
            SET reason = EXCLUDED.reason,
                next_attempt_at = LEAST(mypet.catalog_media_cleanup.next_attempt_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            """.trimIndent(),
            task.objectKey,
            task.organizationId,
            task.outletId,
            task.listingId,
            reason.take(80),
        )
    }

    override fun attach(upload: CatalogMediaUpload, expectedVersion: Long): CatalogMediaAttachResult {
        try {
            return transactions.execute {
                replay(
                    upload.outletId,
                    upload.listingId,
                    upload.idempotencyKey,
                    upload.requestFingerprint,
                )?.let { existing ->
                    requireActiveListingAndCurrentAuthority(
                        upload.actorId,
                        upload.organizationId,
                        upload.outletId,
                        upload.listingId,
                    )
                    return@execute CatalogMediaAttachResult(existing, replayed = true)
                }

                val listing = jdbc.query(
                    """
                    SELECT version, active
                    FROM mypet.catalog_listing
                    WHERE id = ? AND organization_id = ? AND outlet_id = ?
                    FOR UPDATE
                    """.trimIndent(),
                    { rows, _ -> ListingLock(rows.getLong("version"), rows.getBoolean("active")) },
                    upload.listingId,
                    upload.organizationId,
                    upload.outletId,
                ).firstOrNull() ?: resourceUnavailable()

                if (!listing.active) resourceUnavailable()
                requireCurrentAuthority(upload.actorId, upload.organizationId, upload.outletId)

                // Another request with this key can commit while this transaction waits for the listing
                // lock. Re-read after acquiring both the listing and current authorization locks.
                replay(
                    upload.outletId,
                    upload.listingId,
                    upload.idempotencyKey,
                    upload.requestFingerprint,
                )?.let { return@execute CatalogMediaAttachResult(it, replayed = true) }

                if (listing.version != expectedVersion) versionConflict()

                val imageCount = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM mypet.catalog_listing_image WHERE listing_id = ?",
                    Int::class.java,
                    upload.listingId,
                ) ?: 0
                if (imageCount >= CatalogMediaService.MAX_MEDIA_PER_LISTING) quotaExceeded()

                val nextVersion = expectedVersion + 1
                jdbc.update(
                    """
                    INSERT INTO mypet.catalog_media (
                        id, actor_id, organization_id, outlet_id, listing_id, object_key, public_url,
                        content_type, size_bytes, checksum, position, idempotency_key,
                        request_fingerprint, listing_version, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    upload.id,
                    upload.actorId,
                    upload.organizationId,
                    upload.outletId,
                    upload.listingId,
                    upload.objectKey,
                    upload.publicUrl,
                    upload.contentType,
                    upload.sizeBytes,
                    upload.checksum,
                    imageCount,
                    upload.idempotencyKey,
                    upload.requestFingerprint,
                    nextVersion,
                    Timestamp.from(Instant.now()),
                )
                jdbc.update(
                    "INSERT INTO mypet.catalog_listing_image (listing_id, position, image_url) VALUES (?, ?, ?)",
                    upload.listingId,
                    imageCount,
                    upload.publicUrl,
                )
                val changed = jdbc.update(
                    """
                    UPDATE mypet.catalog_listing
                    SET version = version + 1, updated_at = ?
                    WHERE id = ? AND organization_id = ? AND outlet_id = ? AND active = TRUE AND version = ?
                    """.trimIndent(),
                    Timestamp.from(Instant.now()),
                    upload.listingId,
                    upload.organizationId,
                    upload.outletId,
                    expectedVersion,
                )
                if (changed != 1) versionConflict()

                CatalogMediaAttachResult(
                    attachment = CatalogMediaAttachment(
                        mediaId = upload.id,
                        listingId = upload.listingId,
                        position = imageCount,
                        publicUrl = upload.publicUrl,
                        contentType = upload.contentType,
                        sizeBytes = upload.sizeBytes,
                        listingVersion = nextVersion,
                    ),
                    replayed = false,
                )
            } ?: persistenceError()
        } catch (duplicate: DuplicateKeyException) {
            findAuthorizedReplay(
                upload.actorId,
                upload.organizationId,
                upload.outletId,
                upload.listingId,
                upload.idempotencyKey,
                upload.requestFingerprint,
            )?.let { return CatalogMediaAttachResult(it, replayed = true) }
            throw DomainException("CATALOG_MEDIA_CONFLICT", "The listing media changed concurrently; refresh and retry")
        }
    }

    private fun requireActiveListingAndCurrentAuthority(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        listingId: UUID,
    ) {
        val active = jdbc.query(
            """
            SELECT active
            FROM mypet.catalog_listing
            WHERE id = ? AND organization_id = ? AND outlet_id = ?
            FOR SHARE
            """.trimIndent(),
            { rows, _ -> rows.getBoolean("active") },
            listingId,
            organizationId,
            outletId,
        ).firstOrNull() ?: resourceUnavailable()
        if (!active) resourceUnavailable()
        requireCurrentAuthority(actorId, organizationId, outletId)
    }

    /**
     * Linearizes media replay/finalization with current Merchant authority. FOR SHARE locks mean a
     * concurrent permission revocation, account suspension, or outlet suspension either wins before
     * this query (and the operation fails closed) or waits until the transaction completes.
     */
    private fun requireCurrentAuthority(actorId: UUID, organizationId: UUID, outletId: UUID) {
        val granted = jdbc.query(
            """
            SELECT s.permission
            FROM mypet.merchant_staff s
            JOIN mypet.identity_account a ON a.id = s.account_id
            JOIN mypet.provider_outlet o
              ON o.id = s.outlet_id
             AND o.organization_id = s.organization_id
            WHERE s.account_id = ?
              AND s.organization_id = ?
              AND s.outlet_id = ?
              AND s.active = TRUE
              AND s.permission IN ('OWNER', 'CATALOG_WRITE')
              AND a.role = 'MERCHANT'
              AND a.status = 'ACTIVE'
              AND o.status = 'ACTIVE'
            FOR SHARE OF s, a, o
            """.trimIndent(),
            { rows, _ -> rows.getString("permission") },
            actorId,
            organizationId,
            outletId,
        ).isNotEmpty()
        if (!granted) permissionRequired()
    }

    private fun replay(
        outletId: UUID,
        listingId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
    ): CatalogMediaAttachment? {
        val existing = jdbc.query(
            """
            SELECT id, listing_id, position, public_url, content_type, size_bytes,
                   listing_version, request_fingerprint
            FROM mypet.catalog_media
            WHERE outlet_id = ? AND idempotency_key = ?
            """.trimIndent(),
            { rows, _ ->
                ReplayRow(
                    listingId = rows.getObject("listing_id", UUID::class.java),
                    requestFingerprint = rows.getString("request_fingerprint"),
                    attachment = CatalogMediaAttachment(
                        mediaId = rows.getObject("id", UUID::class.java),
                        listingId = rows.getObject("listing_id", UUID::class.java),
                        position = rows.getInt("position"),
                        publicUrl = rows.getString("public_url"),
                        contentType = rows.getString("content_type"),
                        sizeBytes = rows.getLong("size_bytes"),
                        listingVersion = rows.getLong("listing_version"),
                    ),
                )
            },
            outletId,
            idempotencyKey,
        ).firstOrNull() ?: return null

        if (existing.listingId != listingId || existing.requestFingerprint != requestFingerprint) replayConflict()
        return existing.attachment
    }

    private fun resourceUnavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )

    private fun permissionRequired(): Nothing = throw DomainException(
        "MERCHANT_PERMISSION_REQUIRED",
        "The required merchant permission is missing",
    )

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

    private fun persistenceError(): Nothing = throw DomainException(
        "CATALOG_MEDIA_FINALIZATION_FAILED",
        "Catalog media could not be finalized",
    )
}
