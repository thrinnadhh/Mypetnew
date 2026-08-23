package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
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
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem=merchant-identity;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MerchantIdentityApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var json: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider

    @Test
    fun `merchant verification fixes role server side and refresh preserves it`() {
        val mobile = "+919876543210"
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"merchant-device-a"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challenge = json.readTree(requested.response.contentAsString)
        val challengeId = challenge.path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(java.util.UUID.fromString(challengeId))

        val verified = mockMvc.post("/api/v1/auth/merchant/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","role":"ADMIN"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("MERCHANT") }
            jsonPath("$.accessToken") { isNotEmpty() }
            jsonPath("$.refreshToken") { isNotEmpty() }
        }.andReturn()

        val session = json.readTree(verified.response.contentAsString)
        val refreshToken = session.path("refreshToken").asString()
        val originalAccessToken = session.path("accessToken").asString()
        val reportedExpiry = Instant.parse(session.path("accessTokenExpiresAt").asString())
        val signedExpiry = signedAccessTokenExpiry(originalAccessToken)
        assertTrue(
            kotlin.math.abs(reportedExpiry.epochSecond - signedExpiry.epochSecond) <= 2,
            "reportedExpiry=$reportedExpiry signedExpiry=$signedExpiry",
        )

        val refreshed = mockMvc.post("/api/v1/auth/sessions/refresh") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"refreshToken":"$refreshToken"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("MERCHANT") }
            jsonPath("$.accessToken") { isNotEmpty() }
            jsonPath("$.refreshToken") { isNotEmpty() }
        }.andReturn()
        val refreshedSession = json.readTree(refreshed.response.contentAsString)
        val refreshedAccessToken = refreshedSession.path("accessToken").asString()
        val refreshedReportedExpiry = Instant.parse(refreshedSession.path("accessTokenExpiresAt").asString())
        val refreshedSignedExpiry = signedAccessTokenExpiry(refreshedAccessToken)
        assertTrue(
            kotlin.math.abs(refreshedReportedExpiry.epochSecond - refreshedSignedExpiry.epochSecond) <= 2,
            "refreshedReportedExpiry=$refreshedReportedExpiry refreshedSignedExpiry=$refreshedSignedExpiry",
        )

        // Rotation revokes the original session, so its access token must fail closed.
        mockMvc.post("/api/v1/merchant/outlets") {
            header("Authorization", "Bearer $originalAccessToken")
            header("Idempotency-Key", "merchant-bootstrap-stale-session")
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Merchant Bootstrap","capabilities":["PRODUCT_STORE"],"servicePinCodes":["517501"]}"""
        }.andExpect { status { isUnauthorized() } }

        // The newly rotated session preserves MERCHANT authority and is usable for onboarding.
        mockMvc.post("/api/v1/merchant/outlets") {
            header("Authorization", "Bearer $refreshedAccessToken")
            header("Idempotency-Key", "merchant-bootstrap-outlet")
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Merchant Bootstrap","capabilities":["PRODUCT_STORE"],"servicePinCodes":["517501"]}"""
        }.andExpect { status { is2xxSuccessful() } }
    }

    private fun signedAccessTokenExpiry(token: String): Instant {
        val encodedPayload = token.substringBefore('.')
        val payload = String(Base64.getUrlDecoder().decode(encodedPayload), StandardCharsets.UTF_8)
        val expiryEpochSeconds = payload.substringAfterLast('|').toLong()
        return Instant.ofEpochSecond(expiryEpochSeconds)
    }
}
