package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.appointment.domain.AppointmentService
import `in`.mypetnew.appointment.domain.ServiceCapability
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.customer.domain.PetSpecies
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.time.Instant
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-appointments",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:appointment-api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerAppointmentApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var providers: ProviderService
    @Autowired private lateinit var customerData: CustomerDataService
    @Autowired private lateinit var appointments: AppointmentService

    @Test
    fun `public service discovery and customer appointment lifecycle use canonical ownership`() {
        val customerA = login("+919811100001")
        val customerB = login("+919811100002")
        val petA = customerData.createPet(customerA.accountId, "Milo", PetSpecies.DOG, null, null)
        val outlet = createOutlet()
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT, outlet.organizationId, setOf(outlet.id))
        val service = appointments.createOffering(
            merchant,
            outlet.id,
            ServiceCapability.GROOMING,
            "Full Spa",
            "Bath, dry and trim",
            60,
            129_900,
        )
        val slot = appointments.createSlot(merchant, service.id, Instant.now().plusSeconds(7_200))

        mockMvc.get("/api/v1/public/services") {
            param("capability", "GROOMING")
            param("outletId", outlet.id.toString())
        }.andExpect {
            status { isOk() }
            jsonPath("$.items[0].serviceId") { value(service.id.toString()) }
            jsonPath("$.items[0].pricePaise") { value(129_900) }
        }

        mockMvc.get("/api/v1/public/services/${service.id}/availability") {
            param("from", Instant.now().toString())
            param("to", Instant.now().plusSeconds(86_400).toString())
        }.andExpect {
            status { isOk() }
            jsonPath("$.items[0].slotId") { value(slot.id.toString()) }
        }

        val held = mockMvc.post("/api/v1/customer/appointments") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", "appointment-api-hold")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","serviceId":"${service.id}","petId":"${petA.id}","slotId":"${slot.id}","pincode":"517501","paymentMethod":"PAY_AT_PROVIDER","notes":"Sensitive paws"}"""
        }.andExpect {
            status { isCreated() }
            jsonPath("$.status") { value("HOLD") }
            jsonPath("$.paymentMethod") { value("PAY_AT_PROVIDER") }
            jsonPath("$.paymentStatus") { value("NOT_REQUIRED") }
            jsonPath("$.pricePaise") { value(129_900) }
            jsonPath("$.providerName") { value(outlet.name) }
            jsonPath("$.petName") { value("Milo") }
        }.andReturn()
        val appointmentId = objectMapper.readTree(held.response.contentAsString).path("appointmentId").asString()

        mockMvc.post("/api/v1/customer/appointments") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", "appointment-api-hold")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","serviceId":"${service.id}","petId":"${petA.id}","slotId":"${slot.id}","pincode":"517501","paymentMethod":"PAY_AT_PROVIDER","notes":"Sensitive paws"}"""
        }.andExpect {
            status { isCreated() }
            jsonPath("$.appointmentId") { value(appointmentId) }
        }

        mockMvc.get("/api/v1/customer/appointments/$appointmentId") {
            header("Authorization", "Bearer ${customerB.accessToken}")
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }

        mockMvc.post("/api/v1/customer/appointments/$appointmentId/confirm") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("BOOKED") }
        }

        mockMvc.get("/api/v1/customer/appointments") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items[0].appointmentId") { value(appointmentId) }
            jsonPath("$.items[0].serviceName") { value("Full Spa") }
        }

        mockMvc.post("/api/v1/customer/appointments/$appointmentId/cancel") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"reason":"Plans changed"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("CANCELLED") }
        }
    }

    @Test
    fun `appointment API rejects unauthenticated foreign pet and stale PIN requests`() {
        val customerA = login("+919811100003")
        val customerB = login("+919811100004")
        val ownedPet = customerData.createPet(customerA.accountId, "Bruno", PetSpecies.DOG, null, null)
        val foreignPet = customerData.createPet(customerB.accountId, "Luna", PetSpecies.CAT, null, null)
        val outlet = createOutlet()
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT, outlet.organizationId, setOf(outlet.id))
        val service = appointments.createOffering(merchant, outlet.id, ServiceCapability.VETERINARY, "Vet consult", null, 30, 50_000)
        val slot = appointments.createSlot(merchant, service.id, Instant.now().plusSeconds(7_200))

        mockMvc.post("/api/v1/customer/appointments") {
            header("Idempotency-Key", "missing-auth")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","serviceId":"${service.id}","petId":"${foreignPet.id}","slotId":"${slot.id}","pincode":"517501"}"""
        }.andExpect { status { isUnauthorized() } }

        mockMvc.post("/api/v1/customer/appointments") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", "foreign-pet-api")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","serviceId":"${service.id}","petId":"${foreignPet.id}","slotId":"${slot.id}","pincode":"517501"}"""
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }

        mockMvc.post("/api/v1/customer/appointments") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", "stale-service-pin")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","serviceId":"${service.id}","petId":"${ownedPet.id}","slotId":"${slot.id}","pincode":"517502"}"""
        }.andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("APPOINTMENT_PIN_NOT_SERVICEABLE") }
        }

        mockMvc.post("/api/v1/customer/appointments") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", "invalid-service-pin")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","serviceId":"${service.id}","petId":"${ownedPet.id}","slotId":"${slot.id}","pincode":"012345"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PIN_CODE_INVALID") }
        }
    }

    private fun createOutlet(): ProviderOutlet {
        val submitted = providers.submitOutlet(
            Principal(UUID.randomUUID(), Role.MERCHANT),
            "Appointment Provider ${UUID.randomUUID()}",
            setOf(ProviderCapability.GROOMING, ProviderCapability.VETERINARY_CLINIC),
            setOf("517501"),
            "appointment-api-submit-${UUID.randomUUID()}",
        )
        return providers.approveOutlet(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
            submitted.id,
            "appointment-api-approve-${UUID.randomUUID()}",
        )
    }

    private fun login(mobile: String): CustomerLogin {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"appointment-api-test"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        val body = objectMapper.readTree(verified.response.contentAsString)
        return CustomerLogin(UUID.fromString(body.path("accountId").asString()), body.path("accessToken").asString())
    }

    private data class CustomerLogin(val accountId: UUID, val accessToken: String)
}
