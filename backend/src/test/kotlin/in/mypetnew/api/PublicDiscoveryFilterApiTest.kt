package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:public-discovery-filter-test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PublicDiscoveryFilterApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var tokens: BearerTokenService
    @Autowired private lateinit var json: ObjectMapper

    @Test
    fun `public outlet discovery filters active outlets by exact service PIN without exposing PIN lists`() {
        val adminToken = tokens.issue(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
        )

        val tirupatiOutlet = createAndApproveOutlet(
            adminToken = adminToken,
            name = "Tirupati Pet Store",
            pincode = "517501",
            key = "tirupati",
        )
        createAndApproveOutlet(
            adminToken = adminToken,
            name = "Renigunta Pet Store",
            pincode = "517520",
            key = "renigunta",
        )

        mockMvc.get("/api/v1/public/outlets") {
            param("capability", "PRODUCT_STORE")
            param("pincode", "517501")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(tirupatiOutlet.uuid("id").toString()) }
            jsonPath("$.items[0].name") { value("Tirupati Pet Store") }
            jsonPath("$.items[0].servicePinCodes") { doesNotExist() }
        }

        mockMvc.get("/api/v1/public/outlets") {
            param("pincode", "517507")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(0) }
        }

        listOf("51750", "000000", "ABCDEF", " 51750 ").forEach { invalid ->
            mockMvc.get("/api/v1/public/outlets") {
                param("pincode", invalid)
            }.andExpect {
                status { isBadRequest() }
                jsonPath("$.code") { value("PIN_CODE_INVALID") }
            }
        }
    }

    @Test
    fun `public catalog commerceMode filter separates commerce from view-only medicine`() {
        val adminToken = tokens.issue(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
        )
        val merchantActor = UUID.randomUUID()
        val merchantFoundationToken = tokens.issue(Principal(merchantActor, Role.MERCHANT))
        val outlet = postJson(
            path = "/api/v1/merchant/outlets",
            token = merchantFoundationToken,
            idempotencyKey = "discovery-outlet",
            body = """{
                "name":"Discovery Filter Store",
                "capabilities":["PRODUCT_STORE","MEDICINE_CATALOG_VIEW_ONLY"],
                "servicePinCodes":["517501"]
            }""",
        )
        val outletId = outlet.uuid("id")
        val organizationId = outlet.uuid("organizationId")
        postJson(
            path = "/api/v1/admin/outlets/$outletId/approve",
            token = adminToken,
            idempotencyKey = "discovery-approve",
            body = "{}",
        )

        val merchantToken = tokens.issue(
            Principal(
                actorId = merchantActor,
                role = Role.MERCHANT,
                organizationId = organizationId,
                outletIds = setOf(outletId),
            ),
        )

        val product = postJson(
            path = "/api/v1/merchant/listings",
            token = merchantToken,
            idempotencyKey = "discovery-product",
            body = """{
                "outletId":"$outletId",
                "barcodeType":"INTERNAL",
                "barcode":"DISCOVERY-PRODUCT-1",
                "name":"Adult Dog Food",
                "kind":"PRODUCT",
                "mrpPaise":10000,
                "sellingPricePaise":9000,
                "category":"food"
            }""",
        )
        val medicine = postJson(
            path = "/api/v1/merchant/listings",
            token = merchantToken,
            idempotencyKey = "discovery-medicine",
            body = """{
                "outletId":"$outletId",
                "barcodeType":"INTERNAL",
                "barcode":"DISCOVERY-MEDICINE-1",
                "name":"Pet Medicine",
                "kind":"MEDICINE",
                "mrpPaise":20000,
                "sellingPricePaise":18000,
                "category":"health"
            }""",
        )

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("commerceMode", "COMMERCE")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(product.uuid("id").toString()) }
            jsonPath("$.items[0].commerceMode") { value("COMMERCE") }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("commerceMode", "VIEW_ONLY")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(medicine.uuid("id").toString()) }
            jsonPath("$.items[0].commerceMode") { value("VIEW_ONLY") }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("commerceMode", "INVALID")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("VALIDATION_FAILED") }
        }
    }

    private fun createAndApproveOutlet(
        adminToken: String,
        name: String,
        pincode: String,
        key: String,
    ): JsonNode {
        val merchantToken = tokens.issue(Principal(UUID.randomUUID(), Role.MERCHANT))
        val outlet = postJson(
            path = "/api/v1/merchant/outlets",
            token = merchantToken,
            idempotencyKey = "outlet-$key",
            body = """{
                "name":"$name",
                "capabilities":["PRODUCT_STORE"],
                "servicePinCodes":["$pincode"]
            }""",
        )
        postJson(
            path = "/api/v1/admin/outlets/${outlet.uuid("id")}/approve",
            token = adminToken,
            idempotencyKey = "approve-$key",
            body = "{}",
        )
        return outlet
    }

    private fun postJson(
        path: String,
        token: String,
        idempotencyKey: String,
        body: String,
    ): JsonNode {
        val response = mockMvc.post(path) {
            header("Authorization", "Bearer $token")
            header("Idempotency-Key", idempotencyKey)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect {
            status { is2xxSuccessful() }
        }.andReturn().response.contentAsString
        return json.readTree(response)
    }

    private fun JsonNode.uuid(field: String): UUID = UUID.fromString(get(field).asText())
}
