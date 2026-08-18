package `in`.mypetnew.appointment

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.InMemoryAppointmentPersistence
import `in`.mypetnew.appointment.domain.ServiceCapability
import `in`.mypetnew.appointment.domain.ServiceSlot
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.InMemoryCustomerDataPersistence
import `in`.mypetnew.customer.domain.PetSpecies
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class P10AppointmentContractTest {
    private val now = Instant.parse("2026-08-18T06:00:00Z")
    private lateinit var persistence: InMemoryAppointmentPersistence
    private lateinit var providers: ProviderService
    private lateinit var customerData: CustomerDataService
    private lateinit var appointments: AppointmentService
    private lateinit var customer: Principal
    private lateinit var petId: UUID

    @BeforeEach
    fun setUp() {
        persistence = InMemoryAppointmentPersistence()
        providers = ProviderService()
        customerData = CustomerDataService(InMemoryCustomerDataPersistence(), Clock.fixed(now, ZoneOffset.UTC))
        appointments = AppointmentService(persistence, providers, customerData, Clock.fixed(now, ZoneOffset.UTC))
        customer = Principal(UUID.randomUUID(), Role.CUSTOMER)
        petId = customerData.createPet(customer.actorId, "Milo", PetSpecies.DOG, null, null).id
    }

    @Test
    fun `P10 service discovery isolates provider and capability and arbitrary provider-service booking fails closed`() {
        val outletA = createOutlet("Groomer A", setOf(ProviderCapability.GROOMING, ProviderCapability.VETERINARY_CLINIC))
        val outletB = createOutlet("Groomer B", setOf(ProviderCapability.GROOMING))
        val merchantA = merchant(outletA)
        val merchantB = merchant(outletB)

        val groomingA = appointments.createOffering(
            merchantA,
            outletA.id,
            ServiceCapability.GROOMING,
            "Full Spa",
            "Bath and trim",
            60,
            129_900,
        )
        appointments.createOffering(
            merchantA,
            outletA.id,
            ServiceCapability.VETERINARY,
            "Consultation",
            null,
            30,
            50_000,
        )
        val groomingB = appointments.createOffering(
            merchantB,
            outletB.id,
            ServiceCapability.GROOMING,
            "Quick Bath",
            null,
            30,
            40_000,
        )

        assertEquals(listOf(groomingA.id), appointments.listServices(ServiceCapability.GROOMING, outletA.id).map { it.id })
        assertEquals(listOf(groomingB.id), appointments.listServices(ServiceCapability.GROOMING, outletB.id).map { it.id })

        val slotA = appointments.createSlot(merchantA, groomingA.id, now.plusSeconds(7_200))
        val mismatch = assertThrows(DomainException::class.java) {
            appointments.hold(
                customer,
                outletB.id,
                groomingA.id,
                petId,
                slotA.id,
                AppointmentPaymentMethod.PAY_AT_PROVIDER,
                null,
                "p10-cross-provider",
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", mismatch.code)
        assertTrue(appointments.list(customer, 0, 20).items.isEmpty())
    }

    @Test
    fun `P10 availability is read-only excludes past slots and becomes stale after an authoritative hold`() {
        val outlet = createOutlet("Fresh Slots Groomer", setOf(ProviderCapability.GROOMING))
        val merchant = merchant(outlet)
        val offering = appointments.createOffering(
            merchant,
            outlet.id,
            ServiceCapability.GROOMING,
            "Nail Care",
            null,
            30,
            0,
        )
        val past = ServiceSlot(
            UUID.randomUUID(),
            offering.id,
            now.minusSeconds(3_600),
            now.minusSeconds(1_800),
            true,
        )
        persistence.saveSlot(past)
        val future = appointments.createSlot(merchant, offering.id, now.plusSeconds(7_200))

        val discovered = appointments.availability(offering.id, now.minusSeconds(86_400), now.plusSeconds(86_400))
        assertEquals(listOf(future.id), discovered.map { it.id })
        assertTrue(appointments.list(customer, 0, 20).items.isEmpty(), "reading availability must not create an appointment")

        appointments.hold(
            customer,
            outlet.id,
            offering.id,
            petId,
            future.id,
            AppointmentPaymentMethod.PAY_AT_PROVIDER,
            null,
            "p10-stale-slot",
        )
        assertTrue(appointments.availability(offering.id, now, now.plusSeconds(86_400)).isEmpty())
    }

    private fun createOutlet(name: String, capabilities: Set<ProviderCapability>): ProviderOutlet {
        val submitter = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            submitter,
            name,
            capabilities,
            setOf("517501"),
            "p10-submit-${UUID.randomUUID()}",
        )
        return providers.approveOutlet(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
            submitted.id,
            "p10-approve-${UUID.randomUUID()}",
        )
    }

    private fun merchant(outlet: ProviderOutlet): Principal = Principal(
        actorId = UUID.randomUUID(),
        role = Role.MERCHANT,
        organizationId = outlet.organizationId,
        outletIds = setOf(outlet.id),
    )
}
