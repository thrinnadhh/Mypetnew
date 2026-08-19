package `in`.mypetnew.appointment

import `in`.mypetnew.appointment.domain.AppointmentPaymentMethod
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.AppointmentStatus
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
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class AppointmentServiceTest {
    private val now = Instant.parse("2026-08-16T06:00:00Z")
    private lateinit var persistence: InMemoryAppointmentPersistence
    private lateinit var providers: ProviderService
    private lateinit var customerData: CustomerDataService
    private lateinit var service: AppointmentService
    private lateinit var merchant: Principal
    private lateinit var customerA: Principal
    private lateinit var customerB: Principal
    private lateinit var outletId: UUID
    private lateinit var petA: UUID
    private lateinit var petB: UUID

    @BeforeEach
    fun setUp() {
        persistence = InMemoryAppointmentPersistence()
        providers = ProviderService()
        customerData = CustomerDataService(InMemoryCustomerDataPersistence(), Clock.fixed(now, ZoneOffset.UTC))
        service = AppointmentService(persistence, providers, customerData, Clock.fixed(now, ZoneOffset.UTC))
        customerA = Principal(UUID.randomUUID(), Role.CUSTOMER)
        customerB = Principal(UUID.randomUUID(), Role.CUSTOMER)
        petA = customerData.createPet(customerA.actorId, "Milo", PetSpecies.DOG, null, null).id
        petB = customerData.createPet(customerB.actorId, "Luna", PetSpecies.CAT, null, null).id

        val submitter = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            submitter,
            "Happy Groom & Vet",
            setOf(ProviderCapability.GROOMING, ProviderCapability.VETERINARY_CLINIC),
            setOf("517501"),
            "appointment-provider-${UUID.randomUUID()}",
        )
        val active = providers.approveOutlet(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
            submitted.id,
            "appointment-approve-${UUID.randomUUID()}",
        )
        outletId = active.id
        merchant = submitter.copy(organizationId = active.organizationId, outletIds = setOf(active.id))
    }

    @Test
    fun `service catalog and availability expose only configured active slots`() {
        val grooming = service.createOffering(
            merchant,
            outletId,
            ServiceCapability.GROOMING,
            "Full Spa",
            "Bath and trim",
            60,
            129_900,
        )
        val veterinary = service.createOffering(
            merchant,
            outletId,
            ServiceCapability.VETERINARY,
            "Consultation",
            null,
            30,
            50_000,
        )
        val groomingSlot = service.createSlot(merchant, grooming.id, now.plusSeconds(3_600))
        service.createSlot(merchant, veterinary.id, now.plusSeconds(7_200))

        assertEquals(listOf(grooming.id), service.listServices(ServiceCapability.GROOMING, outletId).map { it.id })
        assertEquals(
            listOf(groomingSlot.id),
            service.availability(grooming.id, now, now.plusSeconds(86_400)).map { it.id },
        )
        assertEquals(129_900, grooming.pricePaise)
    }

    @Test
    fun `hold is server priced customer owned idempotent and prevents double booking`() {
        val offering = service.createOffering(
            merchant,
            outletId,
            ServiceCapability.GROOMING,
            "Full Spa",
            null,
            60,
            129_900,
        )
        val slot = service.createSlot(merchant, offering.id, now.plusSeconds(3_600))

        val first = service.hold(
            customerA,
            outletId,
            offering.id,
            petA,
            slot.id,
            AppointmentPaymentMethod.PAY_AT_PROVIDER,
            "Sensitive paws",
            "hold-one",
            "517501",
        )
        val replay = service.hold(
            customerA,
            outletId,
            offering.id,
            petA,
            slot.id,
            AppointmentPaymentMethod.PAY_AT_PROVIDER,
            "Sensitive paws",
            "hold-one",
            "517501",
        )
        assertEquals(first.id, replay.id)
        assertEquals(129_900, first.pricePaise)
        assertEquals("Milo", first.petName)
        assertEquals(AppointmentStatus.HOLD, first.status)
        assertTrue(service.availability(offering.id, now, now.plusSeconds(86_400)).isEmpty())

        val conflict = assertThrows(DomainException::class.java) {
            service.hold(
                customerB,
                outletId,
                offering.id,
                petB,
                slot.id,
                AppointmentPaymentMethod.PAY_AT_PROVIDER,
                null,
                "hold-two",
                "517501",
            )
        }
        assertEquals("APPOINTMENT_SLOT_UNAVAILABLE", conflict.code)

        val foreign = assertThrows(DomainException::class.java) { service.get(customerB, first.id) }
        assertEquals("RESOURCE_NOT_FOUND", foreign.code)
        val confirmed = service.confirm(customerA, first.id)
        assertEquals(AppointmentStatus.BOOKED, confirmed.status)
        assertEquals(AppointmentStatus.CANCELLED, service.cancel(customerA, first.id, "Plans changed").status)
        assertEquals(1, service.list(customerA, 0, 20).items.size)
    }

    @Test
    fun `foreign pet stale PIN and idempotency mismatch fail closed`() {
        val offering = service.createOffering(
            merchant,
            outletId,
            ServiceCapability.VETERINARY,
            "Vet consult",
            null,
            30,
            40_000,
        )
        val firstSlot = service.createSlot(merchant, offering.id, now.plusSeconds(3_600))
        val secondSlot = service.createSlot(merchant, offering.id, now.plusSeconds(7_200))

        val foreignPet = assertThrows(DomainException::class.java) {
            service.hold(
                customerA,
                outletId,
                offering.id,
                petB,
                firstSlot.id,
                AppointmentPaymentMethod.PAY_AT_PROVIDER,
                null,
                "foreign-pet",
                "517501",
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", foreignPet.code)

        val stalePin = assertThrows(DomainException::class.java) {
            service.hold(
                customerA,
                outletId,
                offering.id,
                petA,
                firstSlot.id,
                AppointmentPaymentMethod.PAY_AT_PROVIDER,
                null,
                "stale-pin",
                "517502",
            )
        }
        assertEquals("APPOINTMENT_PIN_NOT_SERVICEABLE", stalePin.code)

        service.hold(
            customerA,
            outletId,
            offering.id,
            petA,
            firstSlot.id,
            AppointmentPaymentMethod.PAY_AT_PROVIDER,
            null,
            "same-key",
            "517501",
        )
        val mismatch = assertThrows(DomainException::class.java) {
            service.hold(
                customerA,
                outletId,
                offering.id,
                petA,
                secondSlot.id,
                AppointmentPaymentMethod.PAY_AT_PROVIDER,
                null,
                "same-key",
                "517501",
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", mismatch.code)
    }

    @Test
    fun `expired hold releases slot and cannot be confirmed or cancelled`() {
        val offering = service.createOffering(
            merchant,
            outletId,
            ServiceCapability.GROOMING,
            "Quick bath",
            null,
            30,
            30_000,
        )
        val slot = service.createSlot(merchant, offering.id, now.plusSeconds(3_600))
        val held = service.hold(
            customerA,
            outletId,
            offering.id,
            petA,
            slot.id,
            AppointmentPaymentMethod.PAY_AT_PROVIDER,
            null,
            "expires",
            "517501",
        )

        val later = AppointmentService(
            persistence,
            providers,
            customerData,
            Clock.fixed(now.plusSeconds(601), ZoneOffset.UTC),
        )
        val confirmError = assertThrows(DomainException::class.java) { later.confirm(customerA, held.id) }
        assertEquals("APPOINTMENT_HOLD_EXPIRED", confirmError.code)
        assertEquals(AppointmentStatus.HOLD_EXPIRED, later.get(customerA, held.id).status)
        val cancelError = assertThrows(DomainException::class.java) {
            later.cancel(customerA, held.id, "Too late")
        }
        assertEquals("APPOINTMENT_HOLD_EXPIRED", cancelError.code)
        assertEquals(
            listOf(slot.id),
            later.availability(offering.id, now, now.plusSeconds(86_400)).map { it.id },
        )
    }

    @Test
    fun `merchant ownership and validation are enforced`() {
        val foreignMerchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val forbidden = assertThrows(DomainException::class.java) {
            service.createOffering(
                foreignMerchant,
                outletId,
                ServiceCapability.GROOMING,
                "Spa",
                null,
                60,
                10_000,
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", forbidden.code)

        val invalid = assertThrows(DomainException::class.java) {
            service.createOffering(
                merchant,
                outletId,
                ServiceCapability.GROOMING,
                "x",
                null,
                1,
                -1,
            )
        }
        assertEquals("SERVICE_INVALID", invalid.code)
    }
}
