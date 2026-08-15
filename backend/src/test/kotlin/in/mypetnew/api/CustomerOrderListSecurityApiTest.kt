package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-order-list-test",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem=orderlistsecurity;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerOrderListSecurityApiTest {
    @Autowired private lateinit var mockMvc: MockMvc

    @Test
    fun `order list rejects unauthenticated requests`() {
        mockMvc.get("/api/v1/customer/orders?page=0&pageSize=20")
            .andExpect {
                status { isUnauthorized() }
                jsonPath("$.code") { value("AUTHENTICATION_REQUIRED") }
            }
    }
}
