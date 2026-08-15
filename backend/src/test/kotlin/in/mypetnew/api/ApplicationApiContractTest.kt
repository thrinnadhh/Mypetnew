package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import org.hamcrest.Matchers.containsString
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import tools.jackson.databind.ObjectMapper

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:mypet;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApplicationApiContractTest {
    @Autowired
    private lateinit var mockMvc: MockMvc

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    @Autowired
    private lateinit var otpProvider: OtpProvider

    @Test
    fun `public readiness and catalog are guest accessible and bounded`() {
        mockMvc.get("/actuator/health/readiness").andExpect { status { isOk() } }
        mockMvc.get("/api/v1/public/catalog?pageSize=501").andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAGE_SIZE_INVALID") }
            jsonPath("$.traceId") { isNotEmpty() }
        }
    }

    @Test
    fun `protected command is denied without bearer token using stable envelope`() {
        mockMvc.post("/api/v1/merchant/listings") {
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
            header("Idempotency-Key", "listing-1")
        }.andExpect {
            status { isUnauthorized() }
            content { string(containsString("AUTHENTICATION_REQUIRED")) }
            jsonPath("$.traceId") { isNotEmpty() }
        }
    }

    @Test
    fun `public OTP login issues a customer token but rejects non-login purposes`() {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"+919876543210","purpose":"LOGIN","deviceId":"test-device"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.challengeId") { isNotEmpty() }
            jsonPath("$.resendAfterSeconds") { value(30) }
        }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(java.util.UUID.fromString(challengeId))

        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"+919876543210","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.accountId") { isNotEmpty() }
            jsonPath("$.accessToken") { isNotEmpty() }
            jsonPath("$.refreshToken") { isNotEmpty() }
            jsonPath("$.role") { value("CUSTOMER") }
        }.andReturn()
        val firstSession = objectMapper.readTree(verified.response.contentAsString)
        val firstAccountId = firstSession.path("accountId").asString()
        org.junit.jupiter.api.Assertions.assertNotNull(firstAccountId)

        val refreshed = mockMvc.post("/api/v1/auth/sessions/refresh") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"refreshToken":"${firstSession.path("refreshToken").asString()}"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.accountId") { value(firstAccountId) }
            jsonPath("$.role") { value("CUSTOMER") }
            jsonPath("$.accessToken") { isNotEmpty() }
            jsonPath("$.refreshToken") { isNotEmpty() }
        }.andReturn()
        val secondSession = objectMapper.readTree(refreshed.response.contentAsString)
        org.junit.jupiter.api.Assertions.assertNotEquals(
            firstSession.path("refreshToken").asString(),
            secondSession.path("refreshToken").asString(),
        )

        mockMvc.post("/api/v1/auth/sessions/refresh") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"refreshToken":"${firstSession.path("refreshToken").asString()}"}"""
        }.andExpect {
            status { isBadRequest() }
        }
        mockMvc.get("/api/v1/notifications") {
            header("Authorization", "Bearer ${firstSession.path("accessToken").asString()}")
        }.andExpect { status { isUnauthorized() } }
        mockMvc.get("/api/v1/notifications") {
            header("Authorization", "Bearer ${secondSession.path("accessToken").asString()}")
        }.andExpect { status { isUnauthorized() } }

        mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"+919876543211","purpose":"LOYALTY_ONBOARDING","deviceId":"test-device-2"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("OTP_PURPOSE_INVALID") }
        }
    }

    @Test
    fun `malformed JSON returns a stable client error instead of an internal failure`() {
        mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("MALFORMED_REQUEST") }
            jsonPath("$.traceId") { isNotEmpty() }
        }
    }

    @Test
    fun `device registration and revoke endpoint flow works for authenticated customer`() {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"+919876543299","purpose":"LOGIN","deviceId":"test-device"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(java.util.UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"+919876543299","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        val accessToken = objectMapper.readTree(verified.response.contentAsString).path("accessToken").asString()

        val installationId = java.util.UUID.randomUUID().toString()

        mockMvc.put("/api/v1/privacy/consents/NOTIFICATIONS") {
            contentType = MediaType.APPLICATION_JSON
            header("Authorization", "Bearer $accessToken")
            content = """{"noticeVersion":"privacy-v1","source":"CUSTOMER_APP"}"""
        }.andExpect { status { isOk() } }

        mockMvc.post("/api/v1/devices/registrations") {
            contentType = MediaType.APPLICATION_JSON
            header("Authorization", "Bearer $accessToken")
            content = """{
                "appKind": "CUSTOMER",
                "environment": "development",
                "installationId": "$installationId",
                "platform": "ANDROID",
                "nativeToken": "sample-token",
                "permissionState": "GRANTED"
            }"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("ACTIVE") }
        }

        mockMvc.delete("/api/v1/devices/registrations/$installationId?appKind=CUSTOMER&environment=development") {
            header("Authorization", "Bearer $accessToken")
        }.andExpect {
            status { isOk() }
        }

        // Repeated DELETE is idempotent (returns 200 OK)
        mockMvc.delete("/api/v1/devices/registrations/$installationId?appKind=CUSTOMER&environment=development") {
            header("Authorization", "Bearer $accessToken")
        }.andExpect {
            status { isOk() }
        }
    }

    @Test
    fun `customer token attempting merchant appKind registration or revocation returns 403 FORBIDDEN`() {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"+919876543288","purpose":"LOGIN","deviceId":"test-device"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(java.util.UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"+919876543288","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        val customerToken = objectMapper.readTree(verified.response.contentAsString).path("accessToken").asString()

        val installationId = java.util.UUID.randomUUID().toString()

        // Customer token registering as MERCHANT -> 403 FORBIDDEN
        mockMvc.post("/api/v1/devices/registrations") {
            contentType = MediaType.APPLICATION_JSON
            header("Authorization", "Bearer $customerToken")
            content = """{
                "appKind": "MERCHANT",
                "environment": "development",
                "installationId": "$installationId",
                "platform": "ANDROID",
                "nativeToken": "sample-token",
                "permissionState": "GRANTED"
            }"""
        }.andExpect {
            status { isForbidden() }
        }

        // Customer token revoking as MERCHANT -> 403 FORBIDDEN
        mockMvc.delete("/api/v1/devices/registrations/$installationId?appKind=MERCHANT&environment=development") {
            header("Authorization", "Bearer $customerToken")
        }.andExpect {
            status { isForbidden() }
        }
    }

    @Test
    fun `foreign customer attempting to revoke another users installation fails with 400 Bad Request`() {
        // Register user A installation
        val reqA = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"+919876543277","purpose":"LOGIN","deviceId":"test-device-a"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val chA = objectMapper.readTree(reqA.response.contentAsString).path("challengeId").asString()
        val codeA = (otpProvider as InMemoryOtpProvider).codeFor(java.util.UUID.fromString(chA))
        val verA = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$chA","mobile":"+919876543277","purpose":"LOGIN","code":"$codeA","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        val tokenA = objectMapper.readTree(verA.response.contentAsString).path("accessToken").asString()

        val installationIdA = java.util.UUID.randomUUID().toString()

        mockMvc.put("/api/v1/privacy/consents/NOTIFICATIONS") {
            contentType = MediaType.APPLICATION_JSON
            header("Authorization", "Bearer $tokenA")
            content = """{"noticeVersion":"privacy-v1","source":"CUSTOMER_APP"}"""
        }.andExpect { status { isOk() } }

        mockMvc.post("/api/v1/devices/registrations") {
            contentType = MediaType.APPLICATION_JSON
            header("Authorization", "Bearer $tokenA")
            content = """{
                "appKind": "CUSTOMER",
                "environment": "development",
                "installationId": "$installationIdA",
                "platform": "ANDROID",
                "nativeToken": "token-a",
                "permissionState": "GRANTED"
            }"""
        }.andExpect { status { isOk() } }

        // Register user B
        val reqB = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"+919876543266","purpose":"LOGIN","deviceId":"test-device-b"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val chB = objectMapper.readTree(reqB.response.contentAsString).path("challengeId").asString()
        val codeB = (otpProvider as InMemoryOtpProvider).codeFor(java.util.UUID.fromString(chB))
        val verB = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$chB","mobile":"+919876543266","purpose":"LOGIN","code":"$codeB","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        val tokenB = objectMapper.readTree(verB.response.contentAsString).path("accessToken").asString()

        // User B attempts to revoke User A's installationId -> 400 Bad Request
        mockMvc.delete("/api/v1/devices/registrations/$installationIdA?appKind=CUSTOMER&environment=development") {
            header("Authorization", "Bearer $tokenB")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("DEVICE_REGISTRATION_INVALID") }
        }
    }
}
