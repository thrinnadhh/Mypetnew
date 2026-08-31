package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:m12-admin-api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
@MerchantOpsContract
class M12AdminApiContractTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var tokens: BearerTokenService

    @Test
    fun `admin inventory control plane exposes no direct stock mutation method`() {
        val token = tokens.issue(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.CATALOG_MODERATION)),
        )
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()

        mockMvc.post("/api/v1/admin/organizations/$organizationId/outlets/$outletId/inventory") {
            header("Authorization", "Bearer $token")
            header("X-Admin-Purpose", "INVENTORY_INVESTIGATION")
            header("X-Admin-Reason", "Investigate reported stock discrepancy")
        }.andExpect {
            status { isMethodNotAllowed() }
        }
    }

    @Test
    fun `provider approval requires explicit purpose reason and permission before target lookup`() {
        val outletId = UUID.randomUUID()
        val permitted = tokens.issue(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
        )
        val unprivileged = tokens.issue(Principal(UUID.randomUUID(), Role.ADMIN))

        mockMvc.post("/api/v1/admin/outlets/$outletId/approve") {
            header("Authorization", "Bearer $permitted")
            header("Idempotency-Key", "m12-missing-context")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("VALIDATION_FAILED") }
        }

        mockMvc.post("/api/v1/admin/outlets/$outletId/approve") {
            header("Authorization", "Bearer $permitted")
            header("Idempotency-Key", "m12-wrong-purpose")
            header("X-Admin-Purpose", "INVENTORY_INVESTIGATION")
            header("X-Admin-Reason", "Review provider verification evidence")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("ADMIN_PURPOSE_INVALID") }
        }

        mockMvc.post("/api/v1/admin/outlets/$outletId/approve") {
            header("Authorization", "Bearer $permitted")
            header("Idempotency-Key", "m12-short-reason")
            header("X-Admin-Purpose", "PROVIDER_REVIEW")
            header("X-Admin-Reason", "short")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("ADMIN_REASON_INVALID") }
        }

        mockMvc.post("/api/v1/admin/outlets/$outletId/approve") {
            header("Authorization", "Bearer $unprivileged")
            header("Idempotency-Key", "m12-no-permission")
            header("X-Admin-Purpose", "PROVIDER_REVIEW")
            header("X-Admin-Reason", "Review provider verification evidence")
        }.andExpect {
            status { isForbidden() }
            jsonPath("$.code") { value("ADMIN_PERMISSION_REQUIRED") }
        }
    }
}
