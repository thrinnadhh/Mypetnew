package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.MerchantPermission
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
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:merchantpos;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MerchantPosApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var tokens: BearerTokenService
    @Autowired private lateinit var json: ObjectMapper

    @Test
    fun `POS sale completion, idempotency replay, payload conflict, and sale lookups`() {
        val merchantActor = UUID.randomUUID()
        val admin = Principal(
            UUID.randomUUID(),
            Role.ADMIN,
            permissions = setOf(AdminPermission.PROVIDER_REVIEW),
        )
        val merchantBootstrapToken = tokens.issue(Principal(merchantActor, Role.MERCHANT))
        val adminToken = tokens.issue(admin)

        val submitted = post(
            "/api/v1/merchant/outlets",
            merchantBootstrapToken,
            "submit-outlet-pos",
            """{"name":"Pet Care Store","capabilities":["PRODUCT_STORE"],"servicePinCodes":["560001"]}""",
        )
        val outletId = submitted.uuid("id")
        val organizationId = submitted.uuid("organizationId")
        post("/api/v1/admin/outlets/$outletId/approve", adminToken, "approve-outlet-pos", "{}")

        val merchant = Principal(
            merchantActor,
            Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
            merchantPermissionsByOutlet = mapOf(outletId to setOf(MerchantPermission.OWNER)),
        )
        val merchantToken = tokens.issue(merchant)

        val listing = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "listing-create-pos",
            """{"outletId":"$outletId","barcodeType":"GTIN_13","barcode":"4006381333931","name":"Puppy Chew Toy","kind":"PRODUCT","mrpPaise":30000,"sellingPricePaise":25000,"category":"toys"}""",
        )
        val listingId = listing.uuid("id")

        post(
            "/api/v1/merchant/inventory/receive",
            merchantToken,
            "receive-pos-stock",
            """{"outletId":"$outletId","listingId":"$listingId","quantity":10}""",
        )

        // 1. Complete POS sale
        val idempotencyKey = "pos-checkout-001"
        val salePayload = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CASH",
            "lines": [{"listingId": "$listingId", "quantity": 2}]
        }""".trimIndent()

        val sale = post(
            "/api/v1/merchant/pos/sales",
            merchantToken,
            idempotencyKey,
            salePayload,
        )
        val saleId = sale.uuid("id")
        assertEquals(50000L, sale.path("totalPaise").asLong())
        assertEquals("CASH", sale.path("paymentDeclaration").asString())

        // 2. Idempotent replay returns same sale without error or extra decrement
        val replay = post(
            "/api/v1/merchant/pos/sales",
            merchantToken,
            idempotencyKey,
            salePayload,
        )
        assertEquals(saleId, replay.uuid("id"))
        assertEquals(50000L, replay.path("totalPaise").asLong())

        // 3. GET /api/v1/merchant/pos/sales/{saleId}
        mockMvc.get("/api/v1/merchant/pos/sales/$saleId") {
            header("Authorization", "Bearer $merchantToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(saleId.toString()) }
            jsonPath("$.totalPaise") { value(50000) }
            jsonPath("$.paymentDeclaration") { value("CASH") }
            jsonPath("$.outletId") { value(outletId.toString()) }
        }

        // 4. GET /api/v1/merchant/pos/sales/by-key
        mockMvc.get("/api/v1/merchant/pos/sales/by-key?outletId=$outletId&idempotencyKey=$idempotencyKey") {
            header("Authorization", "Bearer $merchantToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(saleId.toString()) }
            jsonPath("$.totalPaise") { value(50000) }
        }

        // 5. Same idempotency key with different payload returns 409 Conflict (IDEMPOTENCY_FINGERPRINT_MISMATCH)
        val conflictingPayload = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CARD_TERMINAL",
            "lines": [{"listingId": "$listingId", "quantity": 1}]
        }""".trimIndent()

        mockMvc.post("/api/v1/merchant/pos/sales") {
            header("Authorization", "Bearer $merchantToken")
            header("Idempotency-Key", idempotencyKey)
            contentType = MediaType.APPLICATION_JSON
            content = conflictingPayload
        }.andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("IDEMPOTENCY_FINGERPRINT_MISMATCH") }
        }

        // 6. Unauthorized outlet access for sale retrieval is rejected
        val otherOutletMerchant = Principal(
            UUID.randomUUID(),
            Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(UUID.randomUUID()),
            merchantPermissionsByOutlet = mapOf(UUID.randomUUID() to setOf(MerchantPermission.OWNER)),
        )
        val otherToken = tokens.issue(otherOutletMerchant)
        mockMvc.get("/api/v1/merchant/pos/sales/$saleId") {
            header("Authorization", "Bearer $otherToken")
        }.andExpect {
            status { isNotFound() }
        }

        // 7. Invalid idempotency key format on lookup returns 400 IDEMPOTENCY_KEY_INVALID
        mockMvc.get("/api/v1/merchant/pos/sales/by-key?outletId=$outletId&idempotencyKey=invalid key with spaces!") {
            header("Authorization", "Bearer $merchantToken")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("IDEMPOTENCY_KEY_INVALID") }
        }
    }

    @Test
    fun `POS sale last-unit replay succeeds and recovers committed sale when stock is zero`() {
        val merchantActor = UUID.randomUUID()
        val admin = Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW))
        val merchantBootstrapToken = tokens.issue(Principal(merchantActor, Role.MERCHANT))
        val adminToken = tokens.issue(admin)

        val submitted = post(
            "/api/v1/merchant/outlets",
            merchantBootstrapToken,
            "submit-outlet-pos-last-unit",
            """{"name":"Last Unit Pet Store","capabilities":["PRODUCT_STORE"],"servicePinCodes":["560002"]}""",
        )
        val outletId = submitted.uuid("id")
        val organizationId = submitted.uuid("organizationId")

        post("/api/v1/admin/outlets/$outletId/approve", adminToken, "approve-outlet-pos-last-unit", "{}")
        val merchant = Principal(
            merchantActor,
            Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
            merchantPermissionsByOutlet = mapOf(outletId to setOf(MerchantPermission.OWNER, MerchantPermission.POS_OPERATE)),
        )
        val merchantToken = tokens.issue(merchant)

        val listing = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "listing-create-pos-last-unit",
            """{"outletId":"$outletId","barcodeType":"INTERNAL","barcode":"POS-LAST-UNIT-1","name":"Last Unit Chew Toy","kind":"PRODUCT","mrpPaise":10000,"sellingPricePaise":8000,"category":"toys"}""",
        )
        val listingId = listing.uuid("id")

        // Receive exactly 2 units (the exact sale quantity)
        post(
            "/api/v1/merchant/inventory/receive",
            merchantToken,
            "receive-pos-stock-last-unit",
            """{"outletId":"$outletId","listingId":"$listingId","quantity":2}""",
        )

        val idempotencyKey = "pos-last-unit-001"
        val salePayload = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CASH",
            "lines": [{"listingId": "$listingId", "quantity": 2}]
        }""".trimIndent()

        // 1. First sale completes -> consumes all 2 units
        val sale = post(
            "/api/v1/merchant/pos/sales",
            merchantToken,
            idempotencyKey,
            salePayload,
        )
        val saleId = sale.uuid("id")
        assertEquals(16000L, sale.path("totalPaise").asLong())

        // AC6: 2. Identical replay when stock is 0 succeeds, returns existing sale, NOT LISTING_UNAVAILABLE
        val replay = post(
            "/api/v1/merchant/pos/sales",
            merchantToken,
            idempotencyKey,
            salePayload,
        )
        assertEquals(saleId, replay.uuid("id"))
        assertEquals(16000L, replay.path("totalPaise").asLong())

        // AC2/POS: 3. Genuinely new sale for now-depleted stock fails with LISTING_UNAVAILABLE
        mockMvc.post("/api/v1/merchant/pos/sales") {
            header("Authorization", "Bearer $merchantToken")
            header("Idempotency-Key", "pos-fresh-sale-002")
            contentType = MediaType.APPLICATION_JSON
            content = salePayload
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("LISTING_UNAVAILABLE") }
        }

        // AC7: 4. Same key with conflicting lines fails with 409 IDEMPOTENCY_FINGERPRINT_MISMATCH
        val conflictingPayload = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CASH",
            "lines": [{"listingId": "$listingId", "quantity": 1}]
        }""".trimIndent()
        mockMvc.post("/api/v1/merchant/pos/sales") {
            header("Authorization", "Bearer $merchantToken")
            header("Idempotency-Key", idempotencyKey)
            contentType = MediaType.APPLICATION_JSON
            content = conflictingPayload
        }.andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("IDEMPOTENCY_FINGERPRINT_MISMATCH") }
        }

        // 5. Recovery lookup recovers the committed sale
        mockMvc.get("/api/v1/merchant/pos/sales/by-key?outletId=$outletId&idempotencyKey=$idempotencyKey") {
            header("Authorization", "Bearer $merchantToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(saleId.toString()) }
            jsonPath("$.totalPaise") { value(16000) }
        }
    }

    private fun post(path: String, token: String, idempotencyKey: String, body: String): JsonNode {
        val result = mockMvc.post(path) {
            header("Authorization", "Bearer $token")
            header("Idempotency-Key", idempotencyKey)
            if (path.startsWith("/api/v1/admin/outlets/")) {
                header("X-Admin-Purpose", "PROVIDER_REVIEW")
                header("X-Admin-Reason", "Approve provider after verification review")
            }
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andReturn()
        val response = result.response
        if (response.status !in 200..299) {
            throw AssertionError("POST $path failed with status ${response.status}: ${response.contentAsString}")
        }
        return json.readTree(response.contentAsString)
    }

    private fun JsonNode.uuid(field: String): UUID = UUID.fromString(path(field).asString())
}
