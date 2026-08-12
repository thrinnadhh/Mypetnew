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
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
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
            content = """{"challengeId":"$challengeId","mobile":"+919876543210","purpose":"LOGIN","code":"$code"}"""
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
        }.andExpect { status { isOk() } }

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
}
