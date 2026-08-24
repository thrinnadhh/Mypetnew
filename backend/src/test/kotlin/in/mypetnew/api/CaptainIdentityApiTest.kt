package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem=captain-identity;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CaptainIdentityApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var json: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var dispatch: DispatchService

    @Test
    fun `captain verification fixes role server side and refresh preserves it`() {
        val mobile = "+919876543211"
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"captain-device-a"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = json.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(java.util.UUID.fromString(challengeId))

        val verified = mockMvc.post("/api/v1/auth/captain/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            // Any client-supplied role is ignored because the Captain endpoint fixes authority server-side.
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","role":"ADMIN"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("CAPTAIN") }
            jsonPath("$.accessToken") { isNotEmpty() }
            jsonPath("$.refreshToken") { isNotEmpty() }
        }.andReturn()

        val session = json.readTree(verified.response.contentAsString)
        val originalAccessToken = session.path("accessToken").asString()
        val refreshToken = session.path("refreshToken").asString()

        val refreshed = mockMvc.post("/api/v1/auth/sessions/refresh") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"refreshToken":"$refreshToken"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("CAPTAIN") }
            jsonPath("$.accessToken") { isNotEmpty() }
            jsonPath("$.refreshToken") { isNotEmpty() }
        }.andReturn()
        val refreshedAccessToken = json.readTree(refreshed.response.contentAsString).path("accessToken").asString()

        mockMvc.put("/api/v1/captain/availability") {
            header("Authorization", "Bearer $originalAccessToken")
            contentType = MediaType.APPLICATION_JSON
            content = """{"online":true,"latitude":13.6288,"longitude":79.4192}"""
        }.andExpect { status { isUnauthorized() } }

        dispatch.approveCaptain(UUID.fromString(session.path("accountId").asString()))

        mockMvc.put("/api/v1/captain/availability") {
            header("Authorization", "Bearer $refreshedAccessToken")
            contentType = MediaType.APPLICATION_JSON
            content = """{"online":true,"latitude":13.6288,"longitude":79.4192}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.online") { value(true) }
        }
    }
}
