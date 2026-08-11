package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
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

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
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
}
