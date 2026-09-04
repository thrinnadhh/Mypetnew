package `in`.mypetnew.privacy.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.privacy.domain.AccountDeletionReceipt
import `in`.mypetnew.privacy.domain.ConsentPurpose
import `in`.mypetnew.privacy.domain.ConsentRecord
import `in`.mypetnew.privacy.domain.ConsentSource
import `in`.mypetnew.privacy.domain.CustomerProfile
import `in`.mypetnew.privacy.domain.PrivacyRepository
import `in`.mypetnew.privacy.domain.RightsRequest
import `in`.mypetnew.privacy.domain.RightsRequestStatus
import `in`.mypetnew.privacy.domain.RightsRequestType
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID

@Repository
@Profile("!test & !development")
class JdbcPrivacyRepository(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
) : PrivacyRepository {
    override fun profileFor(customerId: UUID): CustomerProfile = jdbc.sql(
        """
        SELECT display_name, email, adult_eligibility_attested_at, updated_at
        FROM mypet.customer_profile WHERE account_id = :customer_id
        """.trimIndent(),
    ).param("customer_id", customerId).query(::mapProfile).optional().orElse(
        CustomerProfile(null, null, null, null),
    )

    override fun updateProfile(customerId: UUID, profile: CustomerProfile): CustomerProfile {
        jdbc.sql(
            """
            INSERT INTO mypet.customer_profile(
                account_id, display_name, email, adult_eligibility_attested_at, updated_at
            ) VALUES (:account_id, :display_name, :email, :adult_attested_at, :updated_at)
            ON CONFLICT (account_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                email = EXCLUDED.email,
                adult_eligibility_attested_at = COALESCE(
                    mypet.customer_profile.adult_eligibility_attested_at,
                    EXCLUDED.adult_eligibility_attested_at
                ),
                updated_at = EXCLUDED.updated_at
            """.trimIndent(),
        ).param("account_id", customerId)
            .param("display_name", profile.displayName)
            .param("email", profile.email)
            .param("adult_attested_at", profile.adultEligibilityAttestedAt?.jdbcTimestamp())
            .param("updated_at", profile.updatedAt?.jdbcTimestamp())
            .update()
        return profileFor(customerId)
    }

    override fun grantConsent(record: ConsentRecord): ConsentRecord = transaction.execute {
        jdbc.sql(
            """
            UPDATE mypet.privacy_consent SET withdrawn_at = :now
            WHERE customer_id = :customer_id AND purpose = :purpose AND withdrawn_at IS NULL
            """.trimIndent(),
        ).param("now", record.grantedAt.jdbcTimestamp())
            .param("customer_id", record.customerId)
            .param("purpose", record.purpose.name)
            .update()
        jdbc.sql(
            """
            INSERT INTO mypet.privacy_consent(
                id, customer_id, purpose, notice_version, source, proof_metadata, granted_at, withdrawn_at
            ) VALUES (
                :id, :customer_id, :purpose, :notice_version, :source, :proof_metadata, :granted_at, NULL
            )
            """.trimIndent(),
        ).param("id", record.consentId)
            .param("customer_id", record.customerId)
            .param("purpose", record.purpose.name)
            .param("notice_version", record.noticeVersion)
            .param("source", record.source.name)
            .param("proof_metadata", record.proofMetadata)
            .param("granted_at", record.grantedAt.jdbcTimestamp())
            .update()
        record
    }

    override fun withdrawConsent(customerId: UUID, purpose: ConsentPurpose, withdrawnAt: Instant): ConsentRecord =
        transaction.execute {
            val active = jdbc.sql(
                """
                SELECT id, customer_id, purpose, notice_version, source, proof_metadata, granted_at, withdrawn_at
                FROM mypet.privacy_consent
                WHERE customer_id = :customer_id AND purpose = :purpose AND withdrawn_at IS NULL
                ORDER BY granted_at DESC LIMIT 1 FOR UPDATE
                """.trimIndent(),
            ).param("customer_id", customerId)
                .param("purpose", purpose.name)
                .query(::mapConsent)
                .optional()
                .orElseThrow { DomainException("CONSENT_NOT_ACTIVE", "No active consent exists for this purpose") }
            jdbc.sql("UPDATE mypet.privacy_consent SET withdrawn_at = :withdrawn_at WHERE id = :id")
                .param("withdrawn_at", withdrawnAt.jdbcTimestamp())
                .param("id", active.consentId)
                .update()
            active.copy(withdrawnAt = withdrawnAt)
        }

    override fun consentsFor(customerId: UUID): List<ConsentRecord> = jdbc.sql(
        """
        SELECT id, customer_id, purpose, notice_version, source, proof_metadata, granted_at, withdrawn_at
        FROM mypet.privacy_consent WHERE customer_id = :customer_id ORDER BY granted_at DESC
        """.trimIndent(),
    ).param("customer_id", customerId).query(::mapConsent).list()

    override fun createRightsRequest(request: RightsRequest): RightsRequest {
        jdbc.sql(
            """
            INSERT INTO mypet.privacy_rights_request(
                id, customer_id, request_type, status, request_details, requested_at,
                identity_verified_at, updated_at
            ) VALUES (
                :id, :customer_id, :request_type, :status, :request_details, :requested_at,
                :identity_verified_at, :updated_at
            )
            """.trimIndent(),
        ).param("id", request.requestId)
            .param("customer_id", request.customerId)
            .param("request_type", request.requestType.name)
            .param("status", request.status.name)
            .param("request_details", request.requestDetails)
            .param("requested_at", request.requestedAt.jdbcTimestamp())
            .param("identity_verified_at", request.identityVerifiedAt.jdbcTimestamp())
            .param("updated_at", request.updatedAt.jdbcTimestamp())
            .update()
        return request
    }

    override fun requestFor(customerId: UUID, requestId: UUID): RightsRequest? = jdbc.sql(
        """
        SELECT id, customer_id, request_type, status, request_details,
               requested_at, identity_verified_at, updated_at
        FROM mypet.privacy_rights_request WHERE id = :id AND customer_id = :customer_id
        """.trimIndent(),
    ).param("id", requestId).param("customer_id", customerId).query(::mapRequest).optional().orElse(null)

    override fun requestsFor(customerId: UUID): List<RightsRequest> = jdbc.sql(
        """
        SELECT id, customer_id, request_type, status, request_details,
               requested_at, identity_verified_at, updated_at
        FROM mypet.privacy_rights_request WHERE customer_id = :customer_id ORDER BY requested_at DESC
        """.trimIndent(),
    ).param("customer_id", customerId).query(::mapRequest).list()

    override fun eraseDirectIdentifiers(customerId: UUID, now: Instant): AccountDeletionReceipt = transaction.execute {
        existingDeletion(customerId)?.let { return@execute it }
        val requestId = UUID.randomUUID()
        val legalReviewDueAt = now.plus(Duration.ofDays(365))
        val backupSuppressionUntil = now.plus(Duration.ofDays(35))
        val deletedMobile = "d" + customerId.toString().replace("-", "").take(15)
        val updated = jdbc.sql(
            """
            UPDATE mypet.identity_account
            SET mobile_e164 = :deleted_mobile, status = 'DELETED', deleted_at = :now, updated_at = :now
            WHERE id = :customer_id AND role = 'CUSTOMER' AND status IN ('ACTIVE', 'DELETION_PENDING')
            """.trimIndent(),
        ).param("deleted_mobile", deletedMobile)
            .param("now", now.jdbcTimestamp())
            .param("customer_id", customerId)
            .update()
        if (updated != 1) throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

        jdbc.sql(
            """
            UPDATE mypet.customer_profile
            SET display_name = NULL, email = NULL, adult_eligibility_attested_at = NULL, updated_at = :now
            WHERE account_id = :customer_id
            """.trimIndent(),
        ).param("now", now.jdbcTimestamp()).param("customer_id", customerId).update()
        jdbc.sql(
            "UPDATE mypet.user_session SET revoked_at = COALESCE(revoked_at, :now) WHERE account_id = :customer_id",
        ).param("now", now.jdbcTimestamp()).param("customer_id", customerId).update()
        jdbc.sql(
            """
            UPDATE mypet.device_registration
            SET status = 'REVOKED', protected_token = '', updated_at = :now WHERE user_id = :customer_id
            """.trimIndent(),
        ).param("now", now.jdbcTimestamp()).param("customer_id", customerId).update()
        jdbc.sql(
            "DELETE FROM mypet.cart_line WHERE cart_id IN (SELECT id FROM mypet.customer_cart WHERE owner_id = :customer_id)",
        ).param("customer_id", customerId).update()
        jdbc.sql("DELETE FROM mypet.customer_cart WHERE owner_id = :customer_id")
            .param("customer_id", customerId).update()
        jdbc.sql(
            "UPDATE mypet.privacy_consent SET withdrawn_at = :now WHERE customer_id = :customer_id AND withdrawn_at IS NULL",
        ).param("now", now.jdbcTimestamp()).param("customer_id", customerId).update()
        jdbc.sql(
            """
            INSERT INTO mypet.account_deletion_request(
                id, customer_id, status, requested_at, direct_identifiers_erased_at,
                legal_retention_review_due_at, backup_suppression_until
            ) VALUES (
                :id, :customer_id, 'DIRECT_IDENTIFIERS_ERASED', :now, :now,
                :legal_review_due_at, :backup_suppression_until
            )
            """.trimIndent(),
        ).param("id", requestId)
            .param("customer_id", customerId)
            .param("now", now.jdbcTimestamp())
            .param("legal_review_due_at", legalReviewDueAt.jdbcTimestamp())
            .param("backup_suppression_until", backupSuppressionUntil.jdbcTimestamp())
            .update()
        jdbc.sql(
            """
            INSERT INTO mypet.deleted_identity_tombstone(
                account_id, deleted_at, backup_suppression_until, reason_code
            ) VALUES (:customer_id, :now, :backup_suppression_until, 'CUSTOMER_REQUEST')
            """.trimIndent(),
        ).param("customer_id", customerId)
            .param("now", now.jdbcTimestamp())
            .param("backup_suppression_until", backupSuppressionUntil.jdbcTimestamp())
            .update()
        jdbc.sql(
            """
            INSERT INTO mypet.audit_event(
                id, actor_id, actor_role, action, target_type, target_id, reason, source, trace_id, occurred_at
            ) VALUES (
                :id, :customer_id, 'CUSTOMER', 'ACCOUNT_DIRECT_IDENTIFIERS_ERASED',
                'IDENTITY_ACCOUNT', :customer_id, 'CUSTOMER_REQUEST', 'PRIVACY_API', :trace_id, :now
            )
            """.trimIndent(),
        ).param("id", UUID.randomUUID())
            .param("customer_id", customerId)
            .param("trace_id", UUID.randomUUID().toString())
            .param("now", now.jdbcTimestamp())
            .update()
        AccountDeletionReceipt(
            requestId = requestId,
            status = "DIRECT_IDENTIFIERS_ERASED",
            requestedAt = now,
            directIdentifiersErasedAt = now,
            legalRetentionReviewDueAt = legalReviewDueAt,
            backupSuppressionUntil = backupSuppressionUntil,
        )
    }

    private fun existingDeletion(customerId: UUID): AccountDeletionReceipt? = jdbc.sql(
        """
        SELECT id, status, requested_at, direct_identifiers_erased_at,
               legal_retention_review_due_at, backup_suppression_until
        FROM mypet.account_deletion_request WHERE customer_id = :customer_id
        """.trimIndent(),
    ).param("customer_id", customerId).query { rows, _ ->
        AccountDeletionReceipt(
            requestId = rows.getObject("id", UUID::class.java),
            status = rows.getString("status"),
            requestedAt = rows.getTimestamp("requested_at").toInstant(),
            directIdentifiersErasedAt = rows.getTimestamp("direct_identifiers_erased_at").toInstant(),
            legalRetentionReviewDueAt = rows.getTimestamp("legal_retention_review_due_at").toInstant(),
            backupSuppressionUntil = rows.getTimestamp("backup_suppression_until").toInstant(),
        )
    }.optional().orElse(null)

    private fun mapProfile(rows: ResultSet, rowNumber: Int): CustomerProfile {
        require(rowNumber >= 0)
        return CustomerProfile(
            displayName = rows.getString("display_name"),
            email = rows.getString("email"),
            adultEligibilityAttestedAt = rows.getTimestamp("adult_eligibility_attested_at")?.toInstant(),
            updatedAt = rows.getTimestamp("updated_at")?.toInstant(),
        )
    }

    private fun mapConsent(rows: ResultSet, rowNumber: Int): ConsentRecord {
        require(rowNumber >= 0)
        return ConsentRecord(
            consentId = rows.getObject("id", UUID::class.java),
            customerId = rows.getObject("customer_id", UUID::class.java),
            purpose = ConsentPurpose.valueOf(rows.getString("purpose")),
            noticeVersion = rows.getString("notice_version"),
            grantedAt = rows.getTimestamp("granted_at").toInstant(),
            withdrawnAt = rows.getTimestamp("withdrawn_at")?.toInstant(),
            source = ConsentSource.valueOf(rows.getString("source")),
            proofMetadata = rows.getString("proof_metadata"),
        )
    }

    private fun mapRequest(rows: ResultSet, rowNumber: Int): RightsRequest {
        require(rowNumber >= 0)
        return RightsRequest(
            requestId = rows.getObject("id", UUID::class.java),
            customerId = rows.getObject("customer_id", UUID::class.java),
            requestType = RightsRequestType.valueOf(rows.getString("request_type")),
            status = RightsRequestStatus.valueOf(rows.getString("status")),
            requestDetails = rows.getString("request_details"),
            requestedAt = rows.getTimestamp("requested_at").toInstant(),
            identityVerifiedAt = rows.getTimestamp("identity_verified_at").toInstant(),
            updatedAt = rows.getTimestamp("updated_at").toInstant(),
        )
    }
}

private fun Instant.jdbcTimestamp(): Timestamp = Timestamp.from(this)
