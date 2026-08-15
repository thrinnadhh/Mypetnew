package `in`.mypetnew.appointment

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.AppointmentStatus
import `in`.mypetnew.appointment.domain.InMemoryAppointmentPersistence
import `in`.mypetnew.appointment.domain.ServiceCapability
import `in`.mypetnew.application.web.MerchantAppointmentApiController
import `in`.mypetnew.application.web.MerchantAppointmentStatusRequest
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.InMemoryCustomerDataPersistence
import `in`.mypetnew.customer.domain.PetSpecies
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.security.authentication.TestingAuthenticationToken
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class AppointmentMerchantLifecycleTest {
    private val now = Instant.parse("2026-08-16T06:00:00Z")
    private lateinit var appointments: AppointmentService
    private lateinit var merchant: Principal
    private lateinit var customer: Principal
    private lateinit var outletId: UUID
    private lateinit var petId: UUID
    private lateinit var serviceId: UUID

    @BeforeEach
    fun setUp() {
        val providers = ProviderService()
        val customerData = CustomerDataService(InMemoryCustomerDataPersistence(), Clock.fixed(now, ZoneOffset.UTC))
        appointments = AppointmentService(
            InMemoryAppointmentPersistence(),
            providers,
            customerData,
            Clock.fixed(now, ZoneOffset.UTC),
        )
        customer = Principal(UUID.randomUUID(), Role.CUSTOMER)
        petId = customerData.createPet(customer.actorId, "Milo", PetSpecies.DOG, null, null).id

        val submittingMerchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            submittingMerchant,
            "Lifecycle Groom & Vet",
            setOf(ProviderCapability.GROOMING, ProviderCapability.VETERINARY_CLINIC),
            setOf("517501"),
            "lifecycle-submit-${UUID.randomUUID()}",
        )
        val outlet = providers.approveOutlet(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
            submitted.id,
            "lifecycle-approve-${UUID.randomUUID()}",
        )
        outletId = outlet.id
        merchant = submittingMerchant.copy(organizationId = outlet.organizationId, outletIds = setOf(outlet.id))
        serviceId = appointments.createOffering(
            merchant,
            outletId,
            ServiceCapability.GROOMING,
            "Full Spa",
            "Bath and trim",
            60,
            129_900,
        ).id
    }

    @Test
    fun `merchant advances booked appointment through the supported lifecycle`() {
        val booked = bookedAppointment("merchant-lifecycle")
        assertEquals(AppointmentStatus.BOOKED, booked.status)

        val confirmed = appointments.merchantTransition(merchant, outletId, booked.id, AppointmentStatus.CONFIRMED)
        assertEquals(AppointmentStatus.CONFIRMED, confirmed.status)
        assertEquals(
            confirmed.id,
            appointments.merchantTransition(merchant, outletId, booked.id, AppointmentStatus.CONFIRMED).id,
            "repeating the same status is idempotent",
        )
        assertEquals(
            AppointmentStatus.CHECKED_IN,
            appointments.merchantTransition(merchant, outletId, booked.id, AppointmentStatus.CHECKED_IN).status,
        )
        assertEquals(
            AppointmentStatus.IN_SERVICE,
            appointments.merchantTransition(merchant, outletId, booked.id, AppointmentStatus.IN_SERVICE).status,
        )
        assertEquals(
            AppointmentStatus.COMPLETED,
            appointments.merchantTransition(merchant, outletId, booked.id, AppointmentStatus.COMPLETED).status,
        )

        val backwards = assertThrows(DomainException::class.java) {
            appointments.merchantTransition(merchant, outletId, booked.id, AppointmentStatus.CONFIRMED)
        }
        assertEquals("APPOINTMENT_STATE_INVALID", backwards.code)
    }

    @Test
    fun `merchant transition hides foreign outlets and rejects unsupported targets`() {
        val booked = bookedAppointment("merchant-ownership")
        val foreignMerchant = Principal(UUID.randomUUID(), Role.MERCHANT, outletIds = setOf(UUID.randomUUID()))

        val foreign = assertThrows(DomainException::class.java) {
            appointments.merchantTransition(foreignMerchant, outletId, booked.id, AppointmentStatus.CONFIRMED)
        }
        assertEquals("RESOURCE_NOT_FOUND", foreign.code)

        val invalidTarget = assertThrows(DomainException::class.java) {
            appointments.merchantTransition(merchant, outletId, booked.id, AppointmentStatus.HOLD)
        }
        assertEquals("APPOINTMENT_STATUS_TARGET_INVALID", invalidTarget.code)
    }

    @Test
    fun `merchant appointment controller delegates authenticated outlet-owned status change`() {
        val booked = bookedAppointment("merchant-controller")
        val controller = MerchantAppointmentApiController(appointments)
        val authentication = TestingAuthenticationToken(merchant, null)

        val response = controller.transition(
            authentication,
            booked.id,
            MerchantAppointmentStatusRequest(outletId, AppointmentStatus.CONFIRMED),
        )

        assertEquals(booked.id, response.appointmentId)
        assertEquals(AppointmentStatus.CONFIRMED, response.status)
        assertEquals(outletId, response.outletId)
    }

    @Test
    fun `merchant may reject booked appointment or mark confirmed appointment no-show`() {
        val rejected = bookedAppointment("merchant-reject")
        assertEquals(
            AppointmentStatus.REJECTED,
            appointments.merchantTransition(merchant, outletId, rejected.id, AppointmentStatus.REJECTED).status,
        )

        val noShow = bookedAppointment("merchant-noshow")
        appointments.merchantTransition(merchant, outletId, noShow.id, AppointmentStatus.CONFIRMED)
        assertEquals(
            AppointmentStatus.NO_SHOW,
            appointments.merchantTransition(merchant, outletId, noShow.id, AppointmentStatus.NO_SHOW).status,
        )
    }

    private fun bookedAppointment(key: String) = appointments.confirm(
        customer,
        appointments.hold(
            customer,
            outletId,
            serviceId,
            petId,
            appointments.createSlot(merchant, serviceId, now.plusSeconds(3_600 + key.hashCode().toLong().mod(30_000))).id,
            AppointmentPaymentMethod.PAY_AT_PROVIDER,
            null,
            key,
        ).id,
    )
}
