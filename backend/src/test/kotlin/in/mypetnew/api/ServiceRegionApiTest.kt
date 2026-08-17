package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.beans.factory.annotation.Autowired

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:service-regions;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ServiceRegionApiTest {
    @Autowired
    private lateinit var mockMvc: MockMvc

    @Test
    fun `active service regions are guest accessible and expose Tirupati contract`() {
        mockMvc.get("/api/v1/service-regions/active").andExpect {
            status { isOk() }
            jsonPath("$[0].id") { value("81111111-1111-1111-1111-111111111111") }
            jsonPath("$[0].cityIdentity") { value("tirupati") }
            jsonPath("$[0].displayName") { value("Tirupati") }
            jsonPath("$[0].pincodes[0]") { value("517501") }
            jsonPath("$[0].featureFlags.allowProducts") { value(true) }
            jsonPath("$[0].featureFlags.allowGrooming") { value(true) }
            jsonPath("$[0].featureFlags.allowVet") { value(true) }
        }
    }

    @Test
    fun `launch request is guest accessible and duplicate safe`() {
        val body = """{"cityName":"Chittoor","contactInfo":"+919876543210"}"""

        mockMvc.post("/api/v1/service-regions/launch-requests") {
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("REGISTERED") }
        }

        mockMvc.post("/api/v1/service-regions/launch-requests") {
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("ALREADY_REGISTERED") }
        }
    }

    @Test
    fun `launch request rejects invalid contact`() {
        mockMvc.post("/api/v1/service-regions/launch-requests") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"cityName":"Chittoor","contactInfo":"invalid"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("SERVICE_REGION_REQUEST_INVALID") }
        }
    }
}
