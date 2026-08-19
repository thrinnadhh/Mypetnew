package `in`.mypetnew.appointment

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.InMemoryAppointmentPersistence
import `in`.mypetnew.appointment.domain.ServiceCapability
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
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class P12AppointmentAuthoritySecurityTest {
    private val now = Instant.parse("2026-08-19T06:00:00Z")
    private lateinit var appointments: AppointmentService
    private lateinit var customer: Principal
    private lateinit var merchant: Principal
    private lateinit var petId: UUID
    private lateinit var outletId: UUID
    private lateinit var firstServiceId: UUID
    private lateinit var secondServiceId: UUID
    private lateinit var firstSlotId: UUID
    private lateinit var secondSlotId: UUID

    @BeforeEach
    fun setUp() {
        val providers = ProviderService()
        val customerData = CustomerDataService(
            InMemoryCustomerDataPersistence(),
            Clock.fixed(now, ZoneOffset.UTC),
        )
        appointments = AppointmentService(
            InMemoryAppointmentPersistence(),
            providers,
            customerData,
            Clock.fixed(now, ZoneOffset.UTC),
        )
        customer = Principal(UUID.randomUUID(), Role.CUSTOMER)
        petId = customerData.createPet(customer.actorId, "Milo", PetSpecies.DOG, null, null).id

        val submitter = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            submitter,
            "P12 Authority Provider",
            setOf(ProviderCapability.GROOMING, ProviderCapability.VETERINARY_CLINIC),
            setOf("517501"),
            "p12-authority-submit-${UUID.randomUUID()}",
        )
        val outlet = providers.approveOutlet(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
            submitted.id,
            "p12-authority-approve-${UUID.randomUUID()}",
        )
        outletId = outlet.id
        merchant = submitter.copy(organizationId = outlet.organizationId, outletIds = setOf(outlet.id))

        firstServiceId = appointments.createOffering(
            merchant,
            outletId,
            ServiceCapability.GROOMING,
            "Full Groom",
            null,
            60,
            90_000,
        ).id
        secondServiceId = appointments.createOffering(
            merchant,
            outletId,
            ServiceCapability.GROOMING,
            "Quick Groom",
            null,
            30,
            45_000,
        ).id
        firstSlotId = appointments.createSlot(merchant, firstServiceId, now.plusSeconds(3_600)).id
        secondSlotId = appointments.createSlot(merchant, secondServiceId, now.plusSeconds(7_200)).id
    }

    @Test
    fun `merchant and admin principals cannot create customer appointment holds`() {
        listOf(
            merchant,
            Principal(UUID.randomUUID(), Role.ADMIN),
        ).forEachIndexed { index, wrongRole ->
            val error = assertThrows(DomainException::class.java) {
                appointments.hold(
                    wrongRole,
                    outletId,
                    firstServiceId,
                    petId,
                    firstSlotId,
                    AppointmentPaymentMethod.PAY_AT_PROVIDER,
                    null,
                    "wrong-role-$index",
                    "517501",
                )
            }
            assertEquals("FORBIDDEN", error.code)
        }
    }

    @Test
    fun `slot from a different service cannot be combined with selected service`() {
        val error = assertThrows(DomainException::class.java) {
            appointments.hold(
                customer,
                outletId,
                firstServiceId,
                petId,
                secondSlotId,
                AppointmentPaymentMethod.PAY_AT_PROVIDER,
                null,
                "cross-service-slot",
                "517501",
            )
        }

        assertEquals("RESOURCE_NOT_FOUND", error.code)
        assertEquals(0, appointments.list(customer, 0, 20).items.size)
    }

    @Test
    fun `selected provider cannot be swapped while retaining another providers service`() {
        val foreignProviderId = UUID.randomUUID()
        val error = assertThrows(DomainException::class.java) {
            appointments.hold(
                customer,
                foreignProviderId,
                firstServiceId,
                petId,
                firstSlotId,
                AppointmentPaymentMethod.PAY_AT_PROVIDER,
                null,
                "cross-provider-service",
                "517501",
            )
        }

        assertEquals("RESOURCE_NOT_FOUND", error.code)
        assertEquals(0, appointments.list(customer, 0, 20).items.size)
    }
}