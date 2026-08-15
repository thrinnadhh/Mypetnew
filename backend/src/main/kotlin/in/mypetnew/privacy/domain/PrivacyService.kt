package `in`.mypetnew.privacy.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.identity.domain.SessionStore
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

enum class ConsentPurpose {
    LOCATION,
    NOTIFICATIONS,
    MARKETING,
    PERSONALISATION,
    PRODUCT_ANALYTICS,
    RECURRING_ORDER_REMINDERS,
}

enum class ConsentSource { CUSTOMER_APP, CUSTOMER_WEB, SUPPORT_ASSISTED }

enum class RightsRequestType { ACCESS, CORRECTION, ERASURE, GRIEVANCE, NOMINATION }

enum class RightsRequestStatus {
    REQUESTED,
    IDENTITY_VERIFIED,
    IN_REVIEW,
    COMPLETED,
    REJECTED_WITH_LAWFUL_REASON,
}

data class CustomerProfile(
    val displayName: String?,
    val email: String?,
    val adultEligibilityAttestedAt: Instant?,
    val updatedAt: Instant?,
)

data class ConsentRecord(
    val consentId: UUID,
    val customerId: UUID,
    val purpose: ConsentPurpose,
    val noticeVersion: String,
    val grantedAt: Instant,
    val withdrawnAt: Instant?,
    val source: ConsentSource,
    val proofMetadata: String,
)

data class RightsRequest(
    val requestId: UUID,
    val customerId: UUID,
    val requestType: RightsRequestType,
    val status: RightsRequestStatus,
    val requestDetails: String?,
    val requestedAt: Instant,
    val identityVerifiedAt: Instant,
    val updatedAt: Instant,
)

data class PersonalDataSummary(
    val customerId: UUID,
    val mobileE164: String,
    val profile: CustomerProfile,
    val activeConsents: List<ConsentRecord>,
    val processingCategories: List<String>,
    val processorCategories: List<String>,
)

data class AccountDeletionReceipt(
    val requestId: UUID,
    val status: String,
    val requestedAt: Instant,
    val directIdentifiersErasedAt: Instant,
    val legalRetentionReviewDueAt: Instant,
    val backupSuppressionUntil: Instant,
)

interface PrivacyRepository {
    fun profileFor(customerId: UUID): CustomerProfile
    fun updateProfile(customerId: UUID, profile: CustomerProfile): CustomerProfile
    fun grantConsent(record: ConsentRecord): ConsentRecord
    fun withdrawConsent(customerId: UUID, purpose: ConsentPurpose, withdrawnAt: Instant): ConsentRecord
    fun consentsFor(customerId: UUID): List<ConsentRecord>
    fun createRightsRequest(request: RightsRequest): RightsRequest
    fun requestFor(customerId: UUID, requestId: UUID): RightsRequest?
    fun requestsFor(customerId: UUID): List<RightsRequest>
    fun eraseDirectIdentifiers(customerId: UUID, now: Instant): AccountDeletionReceipt
}

class InMemoryPrivacyRepository : PrivacyRepository {
    private val profiles = mutableMapOf<UUID, CustomerProfile>()
    private val consents = mutableMapOf<UUID, ConsentRecord>()
    private val requests = mutableMapOf<UUID, RightsRequest>()
    private val deletions = mutableMapOf<UUID, AccountDeletionReceipt>()

    @Synchronized
    override fun profileFor(customerId: UUID): CustomerProfile = profiles[customerId] ?: CustomerProfile(null, null, null, null)

    @Synchronized
    override fun updateProfile(customerId: UUID, profile: CustomerProfile): CustomerProfile = profile.also {
        profiles[customerId] = it
    }

    @Synchronized
    override fun grantConsent(record: ConsentRecord): ConsentRecord {
        consents.replaceAll { _, existing ->
            if (existing.customerId == record.customerId && existing.purpose == record.purpose && existing.withdrawnAt == null) {
                existing.copy(withdrawnAt = record.grantedAt)
            } else {
                existing
            }
        }
        consents[record.consentId] = record
        return record
    }

    @Synchronized
    override fun withdrawConsent(customerId: UUID, purpose: ConsentPurpose, withdrawnAt: Instant): ConsentRecord {
        val active = consents.values.filter {
            it.customerId == customerId && it.purpose == purpose && it.withdrawnAt == null
        }.maxByOrNull(ConsentRecord::grantedAt) ?: noActiveConsent()
        val withdrawn = active.copy(withdrawnAt = withdrawnAt)
        consents[withdrawn.consentId] = withdrawn
        return withdrawn
    }

    @Synchronized
    override fun consentsFor(customerId: UUID): List<ConsentRecord> = consents.values
        .filter { it.customerId == customerId }
        .sortedByDescending(ConsentRecord::grantedAt)

    @Synchronized
    override fun createRightsRequest(request: RightsRequest): RightsRequest = request.also { requests[it.requestId] = it }

    @Synchronized
    override fun requestFor(customerId: UUID, requestId: UUID): RightsRequest? = requests[requestId]
        ?.takeIf { it.customerId == customerId }

    @Synchronized
    override fun requestsFor(customerId: UUID): List<RightsRequest> = requests.values
        .filter { it.customerId == customerId }
        .sortedByDescending(RightsRequest::requestedAt)

    @Synchronized
    override fun eraseDirectIdentifiers(customerId: UUID, now: Instant): AccountDeletionReceipt {
        deletions[customerId]?.let { return it }
        profiles[customerId] = CustomerProfile(null, null, null, now)
        consents.replaceAll { _, consent ->
            if (consent.customerId == customerId && consent.withdrawnAt == null) consent.copy(withdrawnAt = now) else consent
        }
        return AccountDeletionReceipt(
            requestId = UUID.randomUUID(),
            status = "DIRECT_IDENTIFIERS_ERASED",
            requestedAt = now,
            directIdentifiersErasedAt = now,
            legalRetentionReviewDueAt = now.plus(Duration.ofDays(365)),
            backupSuppressionUntil = now.plus(Duration.ofDays(35)),
        ).also { deletions[customerId] = it }
    }

    private fun noActiveConsent(): Nothing = throw DomainException(
        "CONSENT_NOT_ACTIVE",
        "No active consent exists for this purpose",
    )
}

class PrivacyService(
    private val repository: PrivacyRepository,
    private val sessions: SessionStore,
    private val devices: DeviceRegistrationService,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun summary(customerId: UUID): PersonalDataSummary {
        val identity = sessions.identityFor(customerId)
            ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
        return PersonalDataSummary(
            customerId = customerId,
            mobileE164 = identity.mobileE164,
            profile = repository.profileFor(customerId),
            activeConsents = repository.consentsFor(customerId).filter { it.withdrawnAt == null },
            processingCategories = PROCESSING_CATEGORIES,
            processorCategories = PROCESSOR_CATEGORIES,
        )
    }

    fun updateProfile(
        customerId: UUID,
        displayName: String?,
        email: String?,
        adultEligibilityAttested: Boolean,
    ): CustomerProfile {
        val cleanedName = displayName?.trim()?.takeUnless(String::isEmpty)
        val cleanedEmail = email?.trim()?.lowercase()?.takeUnless(String::isEmpty)
        if (cleanedName != null && cleanedName.length !in 1..120) invalidProfile()
        if (cleanedEmail != null && !cleanedEmail.matches(EMAIL_PATTERN)) invalidProfile()
        val existing = repository.profileFor(customerId)
        val now = clock.instant()
        return repository.updateProfile(
            customerId,
            CustomerProfile(
                displayName = cleanedName,
                email = cleanedEmail,
                adultEligibilityAttestedAt = existing.adultEligibilityAttestedAt
                    ?: now.takeIf { adultEligibilityAttested },
                updatedAt = now,
            ),
        )
    }

    fun grantConsent(
        customerId: UUID,
        purpose: ConsentPurpose,
        noticeVersion: String,
        source: ConsentSource,
    ): ConsentRecord {
        validateNoticeVersion(noticeVersion)
        val now = clock.instant()
        return repository.grantConsent(
            ConsentRecord(
                consentId = UUID.randomUUID(),
                customerId = customerId,
                purpose = purpose,
                noticeVersion = noticeVersion,
                grantedAt = now,
                withdrawnAt = null,
                source = source,
                proofMetadata = "notice=$noticeVersion;source=${source.name}",
            ),
        )
    }

    fun withdrawConsent(customerId: UUID, purpose: ConsentPurpose): ConsentRecord {
        if (purpose == ConsentPurpose.NOTIFICATIONS) devices.revokeAll(customerId)
        return repository.withdrawConsent(customerId, purpose, clock.instant())
    }

    fun consents(customerId: UUID): List<ConsentRecord> = repository.consentsFor(customerId)

    fun requireActiveConsent(customerId: UUID, purpose: ConsentPurpose) {
        if (repository.consentsFor(customerId).none { it.purpose == purpose && it.withdrawnAt == null }) {
            throw DomainException("CONSENT_REQUIRED", "Active consent is required for this optional purpose")
        }
    }

    fun createRightsRequest(customerId: UUID, type: RightsRequestType, details: String?): RightsRequest {
        val cleanedDetails = details?.trim()?.takeUnless(String::isEmpty)
        if (cleanedDetails != null && cleanedDetails.length > 1_000) invalidRightsRequest()
        val now = clock.instant()
        return repository.createRightsRequest(
            RightsRequest(
                requestId = UUID.randomUUID(),
                customerId = customerId,
                requestType = type,
                status = RightsRequestStatus.IDENTITY_VERIFIED,
                requestDetails = cleanedDetails,
                requestedAt = now,
                identityVerifiedAt = now,
                updatedAt = now,
            ),
        )
    }

    fun request(customerId: UUID, requestId: UUID): RightsRequest = repository.requestFor(customerId, requestId)
        ?: throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    fun requests(customerId: UUID): List<RightsRequest> = repository.requestsFor(customerId)

    fun deleteAccount(customerId: UUID, confirmation: String): AccountDeletionReceipt {
        if (confirmation != "DELETE") {
            throw DomainException("ACCOUNT_DELETION_CONFIRMATION_REQUIRED", "Account deletion was not confirmed")
        }
        sessions.disableAccount(customerId)
        devices.revokeAll(customerId)
        return repository.eraseDirectIdentifiers(customerId, clock.instant())
    }

    private fun validateNoticeVersion(noticeVersion: String) {
        if (!noticeVersion.matches(Regex("[A-Za-z0-9._-]{1,64}"))) {
            throw DomainException("NOTICE_VERSION_INVALID", "The consent notice version is invalid")
        }
    }

    private fun invalidProfile(): Nothing = throw DomainException("PROFILE_INVALID", "The profile details are invalid")

    private fun invalidRightsRequest(): Nothing = throw DomainException(
        "RIGHTS_REQUEST_INVALID",
        "The privacy request is invalid",
    )

    companion object {
        private val EMAIL_PATTERN = Regex("[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+")
        private val PROCESSING_CATEGORIES = listOf(
            "identity and authentication",
            "customer pet profiles and saved delivery addresses",
            "commerce and order history",
            "merchant-scoped loyalty",
            "notification and device registration",
            "security and audit records",
        )
        private val PROCESSOR_CATEGORIES = listOf(
            "Supabase PostgreSQL and private object storage",
            "Firebase Cloud Messaging",
        )
    }
}
