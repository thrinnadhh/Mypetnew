package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.delivery.domain.CaptainOnboardingPersistence
import `in`.mypetnew.delivery.domain.CaptainOnboardingRecord
import `in`.mypetnew.delivery.domain.OnboardingBankDetails
import `in`.mypetnew.delivery.domain.OnboardingConsentDetails
import `in`.mypetnew.delivery.domain.OnboardingIdentityDetails
import `in`.mypetnew.delivery.domain.OnboardingPersonalDetails
import `in`.mypetnew.delivery.domain.OnboardingStatus
import `in`.mypetnew.delivery.domain.OnboardingVehicleDetails
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.sql.Timestamp
import java.util.UUID

class JdbcCaptainOnboardingPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : CaptainOnboardingPersistence {
    override fun get(captainId: UUID): CaptainOnboardingRecord? = jdbc.query(
        """
        SELECT captain_id, status, full_name, dob, emergency_contact, address, city, pincode,
               identity_type, identity_number_masked, driving_license_number, license_expiry,
               vehicle_type, registration_number, vehicle_model, vehicle_colour,
               bank_account_holder, bank_account_number_masked, bank_ifsc, bank_name,
               consent_agreement, consent_privacy, consent_location, consent_safety, consent_settlement,
               step_completed, submit_idempotency_key, rejection_reason, submitted_at, reviewed_at,
               created_at, updated_at
        FROM mypet.captain_onboarding
        WHERE captain_id = ?
        """.trimIndent(),
        { rs, _ -> mapRow(rs) },
        captainId,
    ).singleOrNull()

    override fun save(record: CaptainOnboardingRecord): CaptainOnboardingRecord = transactions.execute {
        jdbc.update(
            """
            INSERT INTO mypet.captain_onboarding(
                captain_id, status, full_name, dob, emergency_contact, address, city, pincode,
                identity_type, identity_number_masked, driving_license_number, license_expiry,
                vehicle_type, registration_number, vehicle_model, vehicle_colour,
                bank_account_holder, bank_account_number_masked, bank_ifsc, bank_name,
                consent_agreement, consent_privacy, consent_location, consent_safety, consent_settlement,
                step_completed, submit_idempotency_key, rejection_reason, submitted_at, reviewed_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (captain_id) DO UPDATE
            SET status = EXCLUDED.status,
                full_name = EXCLUDED.full_name,
                dob = EXCLUDED.dob,
                emergency_contact = EXCLUDED.emergency_contact,
                address = EXCLUDED.address,
                city = EXCLUDED.city,
                pincode = EXCLUDED.pincode,
                identity_type = EXCLUDED.identity_type,
                identity_number_masked = EXCLUDED.identity_number_masked,
                driving_license_number = EXCLUDED.driving_license_number,
                license_expiry = EXCLUDED.license_expiry,
                vehicle_type = EXCLUDED.vehicle_type,
                registration_number = EXCLUDED.registration_number,
                vehicle_model = EXCLUDED.vehicle_model,
                vehicle_colour = EXCLUDED.vehicle_colour,
                bank_account_holder = EXCLUDED.bank_account_holder,
                bank_account_number_masked = EXCLUDED.bank_account_number_masked,
                bank_ifsc = EXCLUDED.bank_ifsc,
                bank_name = EXCLUDED.bank_name,
                consent_agreement = EXCLUDED.consent_agreement,
                consent_privacy = EXCLUDED.consent_privacy,
                consent_location = EXCLUDED.consent_location,
                consent_safety = EXCLUDED.consent_safety,
                consent_settlement = EXCLUDED.consent_settlement,
                step_completed = EXCLUDED.step_completed,
                submit_idempotency_key = EXCLUDED.submit_idempotency_key,
                rejection_reason = EXCLUDED.rejection_reason,
                submitted_at = EXCLUDED.submitted_at,
                reviewed_at = EXCLUDED.reviewed_at,
                updated_at = CURRENT_TIMESTAMP
            """.trimIndent(),
            record.captainId,
            record.status.name,
            record.personal.fullName,
            record.personal.dob,
            record.personal.emergencyContact,
            record.personal.address,
            record.personal.city,
            record.personal.pincode,
            record.identity.identityType,
            record.identity.identityNumber?.let { mask(it) },
            record.identity.drivingLicenseNumber,
            record.identity.licenseExpiry,
            record.vehicle.vehicleType,
            record.vehicle.registrationNumber,
            record.vehicle.model,
            record.vehicle.colour,
            record.bank.accountHolder,
            record.bank.accountNumber?.let { mask(it) },
            record.bank.ifsc,
            record.bank.bankName,
            record.consent.captainAgreementAccepted,
            record.consent.privacyPolicyAccepted,
            record.consent.locationUsageAccepted,
            record.consent.safetyPolicyAccepted,
            record.consent.settlementTermsAccepted,
            record.stepCompleted,
            record.submitIdempotencyKey,
            record.rejectionReason,
            record.submittedAt?.let(Timestamp::from),
            record.reviewedAt?.let(Timestamp::from),
            Timestamp.from(record.createdAt),
            Timestamp.from(record.updatedAt),
        )
        get(record.captainId)
    } ?: record

    private fun mapRow(rs: ResultSet): CaptainOnboardingRecord = CaptainOnboardingRecord(
        captainId = rs.getObject("captain_id", UUID::class.java),
        status = OnboardingStatus.valueOf(rs.getString("status")),
        personal = OnboardingPersonalDetails(
            fullName = rs.getString("full_name"),
            dob = rs.getString("dob"),
            emergencyContact = rs.getString("emergency_contact"),
            address = rs.getString("address"),
            city = rs.getString("city"),
            pincode = rs.getString("pincode"),
        ),
        identity = OnboardingIdentityDetails(
            identityType = rs.getString("identity_type"),
            identityNumber = rs.getString("identity_number_masked"),
            drivingLicenseNumber = rs.getString("driving_license_number"),
            licenseExpiry = rs.getString("license_expiry"),
            licenseUploaded = rs.getString("driving_license_number") != null,
        ),
        vehicle = OnboardingVehicleDetails(
            vehicleType = rs.getString("vehicle_type"),
            registrationNumber = rs.getString("registration_number"),
            model = rs.getString("vehicle_model"),
            colour = rs.getString("vehicle_colour"),
            rcUploaded = rs.getString("registration_number") != null,
        ),
        bank = OnboardingBankDetails(
            accountHolder = rs.getString("bank_account_holder"),
            accountNumber = rs.getString("bank_account_number_masked"),
            ifsc = rs.getString("bank_ifsc"),
            bankName = rs.getString("bank_name"),
        ),
        consent = OnboardingConsentDetails(
            captainAgreementAccepted = rs.getBoolean("consent_agreement"),
            privacyPolicyAccepted = rs.getBoolean("consent_privacy"),
            locationUsageAccepted = rs.getBoolean("consent_location"),
            safetyPolicyAccepted = rs.getBoolean("consent_safety"),
            settlementTermsAccepted = rs.getBoolean("consent_settlement"),
        ),
        stepCompleted = rs.getInt("step_completed"),
        submitIdempotencyKey = rs.getString("submit_idempotency_key"),
        rejectionReason = rs.getString("rejection_reason"),
        submittedAt = rs.getTimestamp("submitted_at")?.toInstant(),
        reviewedAt = rs.getTimestamp("reviewed_at")?.toInstant(),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    private fun mask(value: String): String = if (value.length > 4) {
        "••••••••" + value.takeLast(4)
    } else {
        value
    }
}
