package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import org.junit.jupiter.api.Assertions.assertEquals
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
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "spring.datasource.url=jdbc:h2:mem=walking;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class WalkingSkeletonApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var tokens: BearerTokenService
    @Autowired private lateinit var json: ObjectMapper

    @Test
    fun `connected pickup and POS loyalty walking skeleton is role and tenant scoped`() {
        val merchantActor = UUID.randomUUID()
        val admin = Principal(
            UUID.randomUUID(),
            Role.ADMIN,
            permissions = setOf(AdminPermission.PROVIDER_REVIEW),
        )
        val customer = Principal(UUID.randomUUID(), Role.CUSTOMER)
        val merchantBootstrapToken = tokens.issue(Principal(merchantActor, Role.MERCHANT))
        val adminToken = tokens.issue(admin)
        val customerToken = tokens.issue(customer)

        val submitted = post(
            "/api/v1/merchant/outlets",
            merchantBootstrapToken,
            "submit-outlet",
            """{"name":"Happy Pets Tirupati","capabilities":["PRODUCT_STORE"],"servicePinCodes":["517501"]}""",
        )
        val outletId = submitted.uuid("id")
        val organizationId = submitted.uuid("organizationId")
        post("/api/v1/admin/outlets/$outletId/approve", adminToken, "approve-outlet", "{}")

        val merchant = Principal(
            merchantActor,
            Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
        )
        val merchantToken = tokens.issue(merchant)
        val listing = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "listing-create",
            """{"outletId":"$outletId","barcodeType":"GTIN_13","barcode":"4006381333931","name":"Dog Food","kind":"PRODUCT","mrpPaise":15000,"sellingPricePaise":12500}""",
        )
        val listingId = listing.uuid("id")
        post(
            "/api/v1/merchant/inventory/receive",
            merchantToken,
            "receive-stock",
            """{"outletId":"$outletId","listingId":"$listingId","quantity":5}""",
        )

        mockMvc.get("/api/v1/public/catalog?pageSize=20").andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].sellingPricePaise") { value(12500) }
        }

        val quote = post(
            "/api/v1/customer/quotes/pickup",
            customerToken,
            "quote-1",
            """{"outletId":"$outletId","lines":[{"listingId":"$listingId","quantity":1}]}""",
        )
        assertEquals(13_500, quote.path("pricing").path("grandTotalPaise").asLong())
        val order = post(
            "/api/v1/customer/orders",
            customerToken,
            "checkout-1",
            """{"quoteId":"${quote.uuid("id")}","cartSignature":"${quote.path("cartSignature").asText()}"}""",
        )
        val orderId = order.uuid("id")
        listOf("ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "DELIVERED").forEachIndexed { index, status ->
            post(
                "/api/v1/merchant/orders/$orderId/transitions",
                merchantToken,
                "order-transition-$index",
                """{"target":"$status"}""",
            )
        }

        val challenge = post(
            "/api/v1/customer/pos-association-challenges",
            customerToken,
            "association-1",
            """{"organizationId":"$organizationId","outletId":"$outletId"}""",
        )
        post(
            "/api/v1/merchant/pos/sales",
            merchantToken,
            "pos-sale-1",
            """{"outletId":"$outletId","associationChallengeId":"${challenge.uuid("id")}","paymentDeclaration":"CASH","lines":[{"listingId":"$listingId","quantity":1}]}""",
        )

        mockMvc.get("/api/v1/customer/loyalty/$organizationId") {
            header("Authorization", "Bearer $customerToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.availableStars") { value(1) }
        }

        mockMvc.get("/api/v1/merchant/orders/$orderId") {
            header("Authorization", "Bearer ${tokens.issue(merchant.copy(outletIds = setOf(UUID.randomUUID())))}")
        }.andExpect {
            status { isNotFound() }
        }
    }

    private fun post(path: String, token: String, key: String, body: String): tools.jackson.databind.JsonNode {
        val result = mockMvc.post(path) {
            header("Authorization", "Bearer $token")
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect { status { is2xxSuccessful() } }.andReturn()
        return json.readTree(result.response.contentAsString)
    }

    private fun tools.jackson.databind.JsonNode.uuid(name: String): UUID = UUID.fromString(path(name).asText())
}

