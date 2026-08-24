package `in`.mypetnew.delivery.domain

import `in`.mypetnew.common.error.DomainException
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class OnboardingStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
}

data class OnboardingPersonalDetails(
    val fullName: String? = null,
    val dob: String? = null,
    val emergencyContact: String? = null,
    val address: String? = null,
    val city: String? = null,
    val pincode: String? = null,
)

data class OnboardingIdentityDetails(
    val identityType: String? = null,
    val identityNumber: String? = null,
    val drivingLicenseNumber: String? = null,
    val licenseExpiry: String? = null,
    val licenseUploaded: Boolean = false,
)

data class OnboardingVehicleDetails(
    val vehicleType: String? = null,
    val registrationNumber: String? = null,
    val model: String? = null,
    val colour: String? = null,
    val rcUploaded: Boolean = false,
)

data class OnboardingBankDetails(
    val accountHolder: String? = null,
    val accountNumber: String? = null,
    val ifsc: String? = null,
    val bankName: String? = null,
)

data class OnboardingConsentDetails(
    val captainAgreementAccepted: Boolean = false,
    val privacyPolicyAccepted: Boolean = false,
    val locationUsageAccepted: Boolean = false,
    val safetyPolicyAccepted: Boolean = false,
    val settlementTermsAccepted: Boolean = false,
)

data class CaptainOnboardingRecord(
    val captainId: UUID,
    val status: OnboardingStatus = OnboardingStatus.DRAFT,
    val personal: OnboardingPersonalDetails = OnboardingPersonalDetails(),
    val identity: OnboardingIdentityDetails = OnboardingIdentityDetails(),
    val vehicle: OnboardingVehicleDetails = OnboardingVehicleDetails(),
    val bank: OnboardingBankDetails = OnboardingBankDetails(),
    val consent: OnboardingConsentDetails = OnboardingConsentDetails(),
    val stepCompleted: Int = 1,
    val submitIdempotencyKey: String? = null,
    val rejectionReason: String? = null,
    val submittedAt: Instant? = null,
    val reviewedAt: Instant? = null,
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now(),
)

data class SaveOnboardingDraftCommand(
    val personal: OnboardingPersonalDetails? = null,
    val identity: OnboardingIdentityDetails? = null,
    val vehicle: OnboardingVehicleDetails? = null,
    val bank: OnboardingBankDetails? = null,
    val consent: OnboardingConsentDetails? = null,
    val stepCompleted: Int? = null,
)

interface CaptainOnboardingPersistence {
    fun get(captainId: UUID): CaptainOnboardingRecord?
    fun save(record: CaptainOnboardingRecord): CaptainOnboardingRecord
}

class InMemoryCaptainOnboardingPersistence : CaptainOnboardingPersistence {
    private val records = mutableMapOf<UUID, CaptainOnboardingRecord>()

    @Synchronized
    override fun get(captainId: UUID): CaptainOnboardingRecord? = records[captainId]

    @Synchronized
    override fun save(record: CaptainOnboardingRecord): CaptainOnboardingRecord {
        records[record.captainId] = record
        return record
    }
}

class CaptainOnboardingService(
    private val persistence: CaptainOnboardingPersistence,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun getDraft(captainId: UUID): CaptainOnboardingRecord {
        return persistence.get(captainId) ?: CaptainOnboardingRecord(captainId = captainId)
    }

    fun saveDraft(captainId: UUID, command: SaveOnboardingDraftCommand): CaptainOnboardingRecord {
        val existing = persistence.get(captainId) ?: CaptainOnboardingRecord(captainId = captainId)
        if (existing.status == OnboardingStatus.SUBMITTED || existing.status == OnboardingStatus.APPROVED) {
            throw DomainException("ONBOARDING_LOCKED", "Submitted onboarding application cannot be edited")
        }

        val updated = existing.copy(
            personal = command.personal?.let { p ->
                existing.personal.copy(
                    fullName = p.fullName ?: existing.personal.fullName,
                    dob = p.dob ?: existing.personal.dob,
                    emergencyContact = p.emergencyContact ?: existing.personal.emergencyContact,
                    address = p.address ?: existing.personal.address,
                    city = p.city ?: existing.personal.city,
                    pincode = p.pincode ?: existing.personal.pincode,
                )
            } ?: existing.personal,
            identity = command.identity?.let { i ->
                existing.identity.copy(
                    identityType = i.identityType ?: existing.identity.identityType,
                    identityNumber = i.identityNumber ?: existing.identity.identityNumber,
                    drivingLicenseNumber = i.drivingLicenseNumber ?: existing.identity.drivingLicenseNumber,
                    licenseExpiry = i.licenseExpiry ?: existing.identity.licenseExpiry,
                    licenseUploaded = i.licenseUploaded,
                )
            } ?: existing.identity,
            vehicle = command.vehicle?.let { v ->
                existing.vehicle.copy(
                    vehicleType = v.vehicleType ?: existing.vehicle.vehicleType,
                    registrationNumber = v.registrationNumber ?: existing.vehicle.registrationNumber,
                    model = v.model ?: existing.vehicle.model,
                    colour = v.colour ?: existing.vehicle.colour,
                    rcUploaded = v.rcUploaded,
                )
            } ?: existing.vehicle,
            bank = command.bank?.let { b ->
                existing.bank.copy(
                    accountHolder = b.accountHolder ?: existing.bank.accountHolder,
                    accountNumber = b.accountNumber ?: existing.bank.accountNumber,
                    ifsc = b.ifsc ?: existing.bank.ifsc,
                    bankName = b.bankName ?: existing.bank.bankName,
                )
            } ?: existing.bank,
            consent = command.consent?.let { c ->
                existing.consent.copy(
                    captainAgreementAccepted = c.captainAgreementAccepted,
                    privacyPolicyAccepted = c.privacyPolicyAccepted,
                    locationUsageAccepted = c.locationUsageAccepted,
                    safetyPolicyAccepted = c.safetyPolicyAccepted,
                    settlementTermsAccepted = c.settlementTermsAccepted,
                )
            } ?: existing.consent,
            stepCompleted = command.stepCompleted ?: existing.stepCompleted,
            updatedAt = clock.instant(),
        )
        return persistence.save(updated)
    }

    fun submit(captainId: UUID, idempotencyKey: String?): CaptainOnboardingRecord {
        val existing = persistence.get(captainId) ?: throw DomainException("ONBOARDING_INCOMPLETE", "Onboarding draft not found")
        if (existing.status == OnboardingStatus.SUBMITTED || existing.status == OnboardingStatus.APPROVED) {
            if (idempotencyKey != null && existing.submitIdempotencyKey == idempotencyKey) {
                return existing
            }
            if (existing.status == OnboardingStatus.APPROVED) {
                return existing
            }
            return existing
        }

        if (
            existing.personal.fullName.isNullOrBlank() ||
            existing.personal.city.isNullOrBlank() ||
            existing.identity.drivingLicenseNumber.isNullOrBlank() ||
            existing.vehicle.registrationNumber.isNullOrBlank() ||
            existing.bank.accountHolder.isNullOrBlank() ||
            existing.bank.ifsc.isNullOrBlank() ||
            !existing.consent.captainAgreementAccepted ||
            !existing.consent.privacyPolicyAccepted ||
            !existing.consent.locationUsageAccepted ||
            !existing.consent.safetyPolicyAccepted ||
            !existing.consent.settlementTermsAccepted
        ) {
            throw DomainException("ONBOARDING_INCOMPLETE", "All mandatory onboarding sections and consents must be completed before submission")
        }

        val now = clock.instant()
        val submitted = existing.copy(
            status = OnboardingStatus.SUBMITTED,
            submittedAt = now,
            updatedAt = now,
            submitIdempotencyKey = idempotencyKey,
            stepCompleted = 6,
        )
        return persistence.save(submitted)
    }

    fun approve(captainId: UUID): CaptainOnboardingRecord {
        val existing = persistence.get(captainId) ?: CaptainOnboardingRecord(captainId = captainId)
        val now = clock.instant()
        val approved = existing.copy(
            status = OnboardingStatus.APPROVED,
            reviewedAt = now,
            updatedAt = now,
        )
        return persistence.save(approved)
    }
}
