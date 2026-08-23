package `in`.mypetnew.delivery

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.delivery.domain.CaptainEarningsService
import `in`.mypetnew.delivery.domain.CaptainOnboardingRecord
import `in`.mypetnew.delivery.domain.CaptainOnboardingService
import `in`.mypetnew.delivery.domain.CaptainSupportService
import `in`.mypetnew.delivery.domain.CreateSupportTicketCommand
import `in`.mypetnew.delivery.domain.InMemoryCaptainEarningsPersistence
import `in`.mypetnew.delivery.domain.InMemoryCaptainOnboardingPersistence
import `in`.mypetnew.delivery.domain.InMemoryCaptainSupportPersistence
import `in`.mypetnew.delivery.domain.InMemoryDispatchPersistence
import `in`.mypetnew.delivery.domain.OnboardingBankDetails
import `in`.mypetnew.delivery.domain.OnboardingConsentDetails
import `in`.mypetnew.delivery.domain.OnboardingIdentityDetails
import `in`.mypetnew.delivery.domain.OnboardingPersonalDetails
import `in`.mypetnew.delivery.domain.OnboardingStatus
import `in`.mypetnew.delivery.domain.OnboardingVehicleDetails
import `in`.mypetnew.delivery.domain.SaveOnboardingDraftCommand
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class CaptainDomainServicesTest {

    @Test
    fun `captain onboarding domain unit tests`() {
        val persistence = InMemoryCaptainOnboardingPersistence()
        val clock = Clock.fixed(Instant.parse("2026-08-23T10:00:00Z"), ZoneOffset.UTC)
        val service = CaptainOnboardingService(persistence, clock)
        val captainId = UUID.randomUUID()

        // Draft get when empty
        val draft = service.getDraft(captainId)
        assertEquals(captainId, draft.captainId)
        assertEquals(OnboardingStatus.DRAFT, draft.status)

        // Partial save
        val saved = service.saveDraft(
            captainId,
            SaveOnboardingDraftCommand(
                personal = OnboardingPersonalDetails(fullName = "Ramesh Kumar", city = "Tirupati"),
                stepCompleted = 2,
            ),
        )
        assertEquals("Ramesh Kumar", saved.personal.fullName)
        assertEquals(2, saved.stepCompleted)

        // Submit incomplete throws
        assertThrows(DomainException::class.java) {
            service.submit(captainId, "submit-key-1")
        }

        // Fill all fields
        service.saveDraft(
            captainId,
            SaveOnboardingDraftCommand(
                identity = OnboardingIdentityDetails(
                    identityType = "AADHAAR",
                    identityNumber = "123456789012",
                    drivingLicenseNumber = "DL12345",
                    licenseUploaded = true,
                ),
                vehicle = OnboardingVehicleDetails(
                    vehicleType = "BIKE",
                    registrationNumber = "AP03AB1234",
                    rcUploaded = true,
                ),
                bank = OnboardingBankDetails(
                    accountHolder = "Ramesh Kumar",
                    accountNumber = "9876543210",
                    ifsc = "SBIN0001",
                ),
                consent = OnboardingConsentDetails(
                    captainAgreementAccepted = true,
                    privacyPolicyAccepted = true,
                    locationUsageAccepted = true,
                    safetyPolicyAccepted = true,
                    settlementTermsAccepted = true,
                ),
                stepCompleted = 5,
            ),
        )

        // Submit succeeds
        val submitted = service.submit(captainId, "submit-key-1")
        assertEquals(OnboardingStatus.SUBMITTED, submitted.status)
        assertEquals(6, submitted.stepCompleted)

        // Idempotent submit
        val resubmitted = service.submit(captainId, "submit-key-1")
        assertEquals(OnboardingStatus.SUBMITTED, resubmitted.status)

        // Modification of submitted application fails
        assertThrows(DomainException::class.java) {
            service.saveDraft(captainId, SaveOnboardingDraftCommand(stepCompleted = 1))
        }

        // Approval
        val approved = service.approve(captainId)
        assertEquals(OnboardingStatus.APPROVED, approved.status)
    }

    @Test
    fun `captain earnings domain unit tests`() {
        val dispatch = InMemoryDispatchPersistence()
        val persistence = InMemoryCaptainEarningsPersistence(dispatch)
        val service = CaptainEarningsService(persistence)
        val captainId = UUID.randomUUID()

        val summary = service.getSummary(captainId)
        assertEquals(0L, summary.todayPaise)
        assertEquals(0, summary.todayDeliveryCount)
        assertEquals(0L, summary.thisWeekPaise)
        assertEquals(0L, summary.thisMonthPaise)
        assertTrue(summary.recentEarnings.isEmpty())

        val history = service.getDeliveryHistory(captainId)
        assertTrue(history.isEmpty())
    }

    @Test
    fun `captain support domain unit tests`() {
        val persistence = InMemoryCaptainSupportPersistence()
        val service = CaptainSupportService(persistence)
        val captainId = UUID.randomUUID()

        // Valid ticket
        val ticket = service.createTicket(
            captainId,
            CreateSupportTicketCommand(
                category = "PAYMENT",
                subject = "Settlement issue",
                description = "My daily settlement is not reflected in bank account.",
            ),
        )
        assertNotNull(ticket.id)
        assertEquals(captainId, ticket.captainId)
        assertEquals("Settlement issue", ticket.subject)

        // Short subject
        assertThrows(DomainException::class.java) {
            service.createTicket(
                captainId,
                CreateSupportTicketCommand(category = "GENERAL", subject = "Hi", description = "Valid description here"),
            )
        }

        // Short description
        assertThrows(DomainException::class.java) {
            service.createTicket(
                captainId,
                CreateSupportTicketCommand(category = "GENERAL", subject = "Valid subject", description = "No"),
            )
        }
    }
}
