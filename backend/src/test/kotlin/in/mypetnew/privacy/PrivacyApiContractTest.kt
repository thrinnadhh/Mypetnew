package `in`.mypetnew.privacy

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.engagement.domain.DeviceRegistrationService
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
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:privacy;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PrivacyApiContractTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var devices: DeviceRegistrationService

    @Test
    fun `privacy centre is owner scoped and account deletion revokes identity and devices`() {
        val customerA = login("+919812345670", "privacy-device-a")
        val customerB = login("+919812345671", "privacy-device-b")
        val installationId = UUID.randomUUID()

        mockMvc.patch("/api/v1/privacy/me") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"Customer A","email":"customer.a@example.com"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.email") { value("customer.a@example.com") }
        }
        mockMvc.put("/api/v1/privacy/consents/MARKETING") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"noticeVersion":"privacy-v1","source":"CUSTOMER_APP"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.purpose") { value("MARKETING") }
            jsonPath("$.withdrawnAt") { doesNotExist() }
        }
        mockMvc.post("/api/v1/devices/registrations") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"appKind":"CUSTOMER","environment":"development","installationId":"$installationId","platform":"ANDROID","nativeToken":"private-device-token","permissionState":"GRANTED"}"""
        }.andExpect {
            status { isForbidden() }
            jsonPath("$.code") { value("CONSENT_REQUIRED") }
        }
        mockMvc.put("/api/v1/privacy/consents/NOTIFICATIONS") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"noticeVersion":"privacy-v1","source":"CUSTOMER_APP"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.source") { value("CUSTOMER_APP") }
        }
        mockMvc.post("/api/v1/devices/registrations") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"appKind":"CUSTOMER","environment":"development","installationId":"$installationId","platform":"ANDROID","nativeToken":"private-device-token","permissionState":"GRANTED"}"""
        }.andExpect { status { isOk() } }
        mockMvc.delete("/api/v1/privacy/consents/NOTIFICATIONS") { bearer(customerA) }.andExpect {
            status { isOk() }
        }
        val customerAId = UUID.nameUUIDFromBytes("+919812345670".toByteArray())
        assertTrue(devices.activeFor(customerAId).isEmpty())
        mockMvc.put("/api/v1/privacy/consents/NOTIFICATIONS") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"noticeVersion":"privacy-v1","source":"CUSTOMER_APP"}"""
        }.andExpect { status { isOk() } }
        mockMvc.post("/api/v1/devices/registrations") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"appKind":"CUSTOMER","environment":"development","installationId":"$installationId","platform":"ANDROID","nativeToken":"private-device-token","permissionState":"GRANTED"}"""
        }.andExpect { status { isOk() } }

        val rightsResponse = mockMvc.post("/api/v1/privacy/rights-requests") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"requestType":"ACCESS","details":"Provide the statutory processing summary"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("IDENTITY_VERIFIED") }
        }.andReturn()
        val requestId = objectMapper.readTree(rightsResponse.response.contentAsString).path("requestId").asString()

        mockMvc.get("/api/v1/privacy/rights-requests/$requestId") { bearer(customerB) }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }
        mockMvc.get("/api/v1/privacy/me") { bearer(customerA) }.andExpect {
            status { isOk() }
            jsonPath("$.mobileE164") { value("+919812345670") }
            jsonPath("$.activeConsents.length()") { value(2) }
        }

        mockMvc.delete("/api/v1/privacy/account") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"confirmation":"DELETE"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("DIRECT_IDENTIFIERS_ERASED") }
        }

        mockMvc.get("/api/v1/privacy/me") { bearer(customerA) }.andExpect { status { isUnauthorized() } }
        mockMvc.post("/api/v1/auth/sessions/refresh") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"refreshToken":"${customerA.path("refreshToken").asString()}"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("REFRESH_TOKEN_INVALID") }
        }
        assertTrue(devices.activeFor(customerAId).isEmpty())

        val relogin = requestOtp("+919812345670", "privacy-device-a-new")
        mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = verifyBody(relogin, "+919812345670")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("REFRESH_TOKEN_INVALID") }
        }
    }

    @Test
    fun `consent withdrawal is as direct as grant and adult attestation is mandatory`() {
        val requested = requestOtp("+919812345672", "privacy-device-c")
        mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = verifyBody(requested, "+919812345672", adult = false)
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("ADULT_ELIGIBILITY_REQUIRED") }
        }

        val customer = loginFromRequested(requested, "+919812345672")
        mockMvc.put("/api/v1/privacy/consents/MARKETING") {
            bearer(customer)
            contentType = MediaType.APPLICATION_JSON
            content = """{"noticeVersion":"privacy-v1","source":"SUPPORT_ASSISTED"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("CONSENT_SOURCE_INVALID") }
        }
        mockMvc.put("/api/v1/privacy/consents/PRODUCT_ANALYTICS") {
            bearer(customer)
            contentType = MediaType.APPLICATION_JSON
            content = """{"noticeVersion":"privacy-v1","source":"CUSTOMER_APP"}"""
        }.andExpect { status { isOk() } }
        mockMvc.delete("/api/v1/privacy/consents/PRODUCT_ANALYTICS") { bearer(customer) }.andExpect {
            status { isOk() }
            jsonPath("$.withdrawnAt") { isNotEmpty() }
        }
    }

    private fun login(mobile: String, deviceId: String): JsonNode = loginFromRequested(requestOtp(mobile, deviceId), mobile)

    private fun requestOtp(mobile: String, deviceId: String): Pair<String, String> {
        val response = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"$deviceId"}"""
        }.andReturn()
        val challengeId = objectMapper.readTree(response.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        return challengeId to code
    }

    private fun loginFromRequested(requested: Pair<String, String>, mobile: String): JsonNode {
        val response = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = verifyBody(requested, mobile)
        }.andExpect { status { isOk() } }.andReturn()
        return objectMapper.readTree(response.response.contentAsString)
    }

    private fun verifyBody(requested: Pair<String, String>, mobile: String, adult: Boolean = true): String =
        """{"challengeId":"${requested.first}","mobile":"$mobile","purpose":"LOGIN","code":"${requested.second}","adultEligibilityAttested":$adult}"""

    private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.bearer(session: JsonNode) {
        header("Authorization", "Bearer ${session.path("accessToken").asString()}")
    }
}
