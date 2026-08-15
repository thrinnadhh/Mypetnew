package `in`.mypetnew.privacy.domain

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
import `in`.mypetnew.identity.domain.SessionStore
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class ConsentPurpose {
    LOCATION,
    NOTIFICATIONS,
    MARKETING,
    PRODUCT_ANALYTICS,
    PERSONALISATION,
    RECURRING_ORDER_REMINDERS,
}

enum class ConsentSource { CUSTOMER_APP, ADMIN_ASSISTED }

enum class RightsRequestType { ACCESS, CORRECTION, ERASURE, GRIEVANCE, NOMINATION }

enum class RightsRequestStatus { IDENTITY_VERIFIED, IN_REVIEW, COMPLETED, REJECTED }

data class CustomerProfile(
    val displayName: String?,
    val email: String?,
    val adultEligibilityAttestedAt: Instant?,
    val updatedAt: Instant,
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

data class AccountDeletionReceipt(
    val requestId: UUID,
    val status: String,
    val completedAt: Instant,
    val retainedCategories: List<String>,
)

data class PersonalDataSummary(
    val customerId: UUID,
    val mobileE164: String,
    val profile: CustomerProfile,
    val activeConsents: List<ConsentRecord>,
    val processingCategories: List<String>,
    val processorCategories: List<String>,
)

interface PrivacyRepository {
    fun profileFor(customerId: UUID): CustomerProfile
    fun mobileFor(customerId: UUID): String
    fun updateProfile(customerId: UUID, profile: CustomerProfile): CustomerProfile
    fun grantConsent(consent: ConsentRecord): ConsentRecord
    fun withdrawConsent(customerId: UUID, purpose: ConsentPurpose, at: Instant): ConsentRecord
    fun consentsFor(customerId: UUID): List<ConsentRecord>
    fun createRightsRequest(request: RightsRequest): RightsRequest
    fun requestsFor(customerId: UUID): List<RightsRequest>
    fun requestFor(customerId: UUID, requestId: UUID): RightsRequest?
    fun eraseDirectIdentifiers(customerId: UUID, at: Instant): AccountDeletionReceipt
}

class InMemoryPrivacyRepository : PrivacyRepository {
    private data class ProfileState(val mobile: String, val profile: CustomerProfile)

    private val profiles = mutableMapOf<UUID, ProfileState>()
    private val consents = mutableMapOf<Pair<UUID, ConsentPurpose>, ConsentRecord>()
    private val requests = mutableMapOf<UUID, RightsRequest>()
    private val deleted = mutableMapOf<UUID, AccountDeletionReceipt>()

    @Synchronized
    override fun profileFor(customerId: UUID): CustomerProfile =
        profiles.getOrPut(customerId) {
            ProfileState(
                mobile = "+910000000000",
                profile = CustomerProfile(null, null, null, Instant.EPOCH),
            )
        }.profile

    @Synchronized
    override fun mobileFor(customerId: UUID): String = profiles.getOrPut(customerId) {
        ProfileState(
            mobile = "+910000000000",
            profile = CustomerProfile(null, null, null, Instant.EPOCH),
        )
    }.mobile

    @Synchronized
    override fun updateProfile(customerId: UUID, profile: CustomerProfile): CustomerProfile {
        val existing = profiles[customerId]
        profiles[customerId] = ProfileState(existing?.mobile ?: "+910000000000", profile)
        return profile
    }

    @Synchronized
    override fun grantConsent(consent: ConsentRecord): ConsentRecord {
        consents[consent.customerId to consent.purpose] = consent
        return consent
    }

    @Synchronized
    override fun withdrawConsent(customerId: UUID, purpose: ConsentPurpose, at: Instant): ConsentRecord {
        val key = customerId to purpose
        val current = consents[key]
            ?: throw DomainException("CONSENT_NOT_FOUND", "No active consent exists for that purpose")
        if (current.withdrawnAt != null) return current
        return current.copy(withdrawnAt = at).also { consents[key] = it }
    }

    @Synchronized
    override fun consentsFor(customerId: UUID): List<ConsentRecord> = consents.values.filter { it.customerId == customerId }

    @Synchronized
    override fun createRightsRequest(request: RightsRequest): RightsRequest {
        requests[request.requestId] = request
        return request
    }

    @Synchronized
    override fun requestsFor(customerId: UUID): List<RightsRequest> = requests.values.filter { it.customerId == customerId }

    @Synchronized
    override fun requestFor(customerId: UUID, requestId: UUID): RightsRequest? =
        requests[requestId]?.takeIf { it.customerId == customerId }

    @Synchronized
    override fun eraseDirectIdentifiers(customerId: UUID, at: Instant): AccountDeletionReceipt {
        deleted[customerId]?.let { return it }
        val profile = profileFor(customerId)
        profiles[customerId] = ProfileState(
            mobile = "deleted-${customerId.toString().take(12)}",
            profile = profile.copy(displayName = null, email = null, updatedAt = at),
        )
        consents.entries.removeIf { it.key.first == customerId }
        val receipt = AccountDeletionReceipt(
            requestId = UUID.randomUUID(),
            status = "COMPLETED",
            completedAt = at,
            retainedCategories = listOf("order/accounting records", "security/audit records", "privacy-rights request evidence"),
        )
        deleted[customerId] = receipt
        return receipt
    }
}

class PrivacyService(
    private val repository: PrivacyRepository,
    private val sessions: SessionStore,
    private val devices: DeviceRegistrationService,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun summary(customerId: UUID): PersonalDataSummary {
        return PersonalDataSummary(
            customerId = customerId,
            mobileE164 = repository.mobileFor(customerId),
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
            "commerce, favourites and order history",
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
