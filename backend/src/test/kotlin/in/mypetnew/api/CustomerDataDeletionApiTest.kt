package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.post
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-p2-delete-test",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem=p2delete;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerDataDeletionApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var customerData: CustomerDataService

    @Test
    fun `account deletion erases customer pets and addresses`() {
        val mobile = "+919812345682"
        val session = login(mobile, "p2-delete-device")
        val customerId = UUID.nameUUIDFromBytes(mobile.toByteArray())

        post(
            "/api/v1/customer/pets",
            session,
            """{"name":"Bruno","species":"DOG"}""",
        )
        post(
            "/api/v1/customer/addresses",
            session,
            """{
              "label":"Home",
              "recipientName":"Customer",
              "phoneNumber":"9812345682",
              "line1":"Main Road",
              "city":"Tirupati",
              "state":"Andhra Pradesh",
              "pincode":"517501",
              "isDefault":true
            }""",
        )

        assertTrue(customerData.listPets(customerId, 0, 20).items.isNotEmpty())
        assertTrue(customerData.listAddresses(customerId).isNotEmpty())

        mockMvc.delete("/api/v1/privacy/account") {
            bearer(session)
            contentType = MediaType.APPLICATION_JSON
            content = """{"confirmation":"DELETE"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("DIRECT_IDENTIFIERS_ERASED") }
        }

        assertTrue(customerData.listPets(customerId, 0, 20).items.isEmpty())
        assertTrue(customerData.listAddresses(customerId).isEmpty())
    }

    private fun post(path: String, session: JsonNode, body: String) {
        mockMvc.post(path) {
            bearer(session)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect { status { isCreated() } }
    }

    private fun login(mobile: String, deviceId: String): JsonNode {
        val request = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"$deviceId"}"""
        }.andReturn()
        val challengeId = objectMapper.readTree(request.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verify = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{
              "challengeId":"$challengeId",
              "mobile":"$mobile",
              "purpose":"LOGIN",
              "code":"$code",
              "adultEligibilityAttested":true
            }"""
        }.andExpect { status { isOk() } }.andReturn()
        return objectMapper.readTree(verify.response.contentAsString)
    }

    private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.bearer(session: JsonNode) {
        header("Authorization", "Bearer ${session.path("accessToken").asString()}")
    }
}
