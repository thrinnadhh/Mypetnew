package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.provider.domain.ProviderCapability
import org.hamcrest.Matchers.equalTo
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
        "mypet.security.token-issuer=mypetnew-test-api",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:public-catalog-test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PublicCatalogApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var tokens: BearerTokenService
    @Autowired private lateinit var json: ObjectMapper

    @Test
    fun `public outlets endpoints enforce active filter, capability, q search, bounded pagination, invalid params, and data minimization`() {
        val admin = Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW))
        val adminToken = tokens.issue(admin)
        val isolatedPincode = "517599"

        val merchant1Token = tokens.issue(Principal(UUID.randomUUID(), Role.MERCHANT))
        val outlet1Node = post(
            "/api/v1/merchant/outlets",
            merchant1Token,
            "out-1",
            """{"name":"Happy Pets Outlet Alpha","capabilities":["PRODUCT_STORE"],"servicePinCodes":["$isolatedPincode"]}""",
        )
        val outlet1Id = outlet1Node.uuid("id")
        post("/api/v1/admin/outlets/$outlet1Id/approve", adminToken, "app-1", "{}")

        val merchant2Token = tokens.issue(Principal(UUID.randomUUID(), Role.MERCHANT))
        val outlet2Node = post(
            "/api/v1/merchant/outlets",
            merchant2Token,
            "out-2",
            """{"name":"Unapproved Pet Clinic","capabilities":["PRODUCT_STORE"],"servicePinCodes":["$isolatedPincode"]}""",
        )
        val outlet2Id = outlet2Node.uuid("id")

        mockMvc.get("/api/v1/public/outlets") {
            param("q", "happy pets")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(outlet1Id.toString()) }
            jsonPath("$.items[0].name") { value("Happy Pets Outlet Alpha") }
            jsonPath("$.items[0].pickupEnabled") { value(true) }
            jsonPath("$.items[0].ownerActorId") { doesNotExist() }
            jsonPath("$.items[0].servicePinCodes") { doesNotExist() }
            jsonPath("$.items[0].merchantStaff") { doesNotExist() }
            jsonPath("$.items[0].bank") { doesNotExist() }
            jsonPath("$.items[0].tax") { doesNotExist() }
        }

        mockMvc.get("/api/v1/public/outlets") {
            param("capability", "PRODUCT_STORE")
            param("pincode", isolatedPincode)
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(outlet1Id.toString()) }
        }

        mockMvc.get("/api/v1/public/outlets") {
            param("capability", "MEDICINE_CATALOG_VIEW_ONLY")
            param("pincode", isolatedPincode)
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(0) }
        }

        mockMvc.get("/api/v1/public/outlets") {
            param("page", "5000")
            param("pageSize", "20")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(0) }
            jsonPath("$.page") { value(5000) }
            jsonPath("$.hasNext") { value(false) }
        }

        mockMvc.get("/api/v1/public/outlets") {
            param("page", "5001")
            param("pageSize", "20")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAGE_SIZE_INVALID") }
            jsonPath("$.traceId") { exists() }
        }

        mockMvc.get("/api/v1/public/outlets") {
            param("page", "-1")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAGE_SIZE_INVALID") }
            jsonPath("$.traceId") { exists() }
        }

        mockMvc.get("/api/v1/public/outlets") {
            param("pageSize", "51")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAGE_SIZE_INVALID") }
        }

        mockMvc.get("/api/v1/public/outlets/$outlet1Id")
            .andExpect {
                status { isOk() }
                jsonPath("$.id") { value(outlet1Id.toString()) }
            }

        mockMvc.get("/api/v1/public/outlets/$outlet2Id")
            .andExpect {
                status { isNotFound() }
                jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
            }
    }

    @Test
    fun `public catalog list and detail enforce filters, availability, medicine view only, bounded pagination, and data minimization`() {
        val adminToken = tokens.issue(Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)))

        val merchantActor = UUID.randomUUID()
        val outletNode = post(
            "/api/v1/merchant/outlets",
            tokens.issue(Principal(merchantActor, Role.MERCHANT)),
            "out-cat-1",
            """{"name":"Tirupati Pet Store","capabilities":["PRODUCT_STORE","MEDICINE_CATALOG_VIEW_ONLY"],"servicePinCodes":["517501"]}""",
        )
        val outletId = outletNode.uuid("id")
        val orgId = outletNode.uuid("organizationId")
        post("/api/v1/admin/outlets/$outletId/approve", adminToken, "app-cat-1", "{}")

        val merchantToken = tokens.issue(
            Principal(merchantActor, Role.MERCHANT, organizationId = orgId, outletIds = setOf(outletId)),
        )

        // M4 forbids arbitrary external image URL injection during listing creation.
        // Managed images are attached through the dedicated media lifecycle instead.
        val productNode = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "list-prod-1",
            """{
                "outletId": "$outletId",
                "barcodeType": "INTERNAL",
                "barcode": "INT-PROD-001",
                "name": "Royal Canin Adult",
                "kind": "PRODUCT",
                "mrpPaise": 250000,
                "sellingPricePaise": 220000,
                "category": "food",
                "brand": "Royal Canin",
                "petType": "DOG",
                "lifeStage": "ADULT",
                "packLabel": "3 kg",
                "sku": "RC-ADULT-3KG"
            }""",
        )
        val productId = productNode.uuid("id")

        val medNode = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "list-med-1",
            """{
                "outletId": "$outletId",
                "barcodeType": "INTERNAL",
                "barcode": "INT-MED-001",
                "name": "Pet Antibiotic",
                "kind": "MEDICINE",
                "mrpPaise": 50000,
                "sellingPricePaise": 45000,
                "category": "health",
                "brand": "VetMed"
            }""",
        )
        val medId = medNode.uuid("id")

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(2) }
            jsonPath("$.items[0].id") { value(medId.toString()) }
            jsonPath("$.items[0].commerceMode") { value("VIEW_ONLY") }
            jsonPath("$.items[1].id") { value(productId.toString()) }
            jsonPath("$.items[1].availableQuantity") { value(0) }
            jsonPath("$.items[1].commerceMode") { value("COMMERCE") }
            jsonPath("$.items[0].normalizedBarcode") { doesNotExist() }
            jsonPath("$.items[0].rawBarcodeAudit") { doesNotExist() }
            jsonPath("$.items[0].inventoryMovementHistory") { doesNotExist() }
            jsonPath("$.items[0].verificationDocuments") { doesNotExist() }
        }

        post(
            "/api/v1/merchant/inventory/receive",
            merchantToken,
            "recv-1",
            """{"outletId":"$outletId","listingId":"$productId","quantity":10}""",
        )

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("kind", "PRODUCT")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(productId.toString()) }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("kind", "MEDICINE")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(medId.toString()) }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("availability", "IN_STOCK")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(productId.toString()) }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("availability", "OUT_OF_STOCK")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(medId.toString()) }
        }

        listOf("Antibiotic", "VetMed", "health").forEach { query ->
            mockMvc.get("/api/v1/public/catalog") {
                param("outletId", outletId.toString())
                param("q", query)
            }.andExpect {
                status { isOk() }
                jsonPath("$.items.length()") { value(1) }
                jsonPath("$.items[0].id") { value(medId.toString()) }
            }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("q", "Tirupati")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(2) }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("page", "5000")
            param("pageSize", "20")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(0) }
            jsonPath("$.page") { value(5000) }
            jsonPath("$.hasNext") { value(false) }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("page", "5001")
            param("pageSize", "20")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAGE_SIZE_INVALID") }
            jsonPath("$.traceId") { exists() }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("kind", "INVALID_KIND")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("VALIDATION_FAILED") }
            jsonPath("$.traceId") { exists() }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", "not-a-uuid")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("VALIDATION_FAILED") }
        }

        mockMvc.get("/api/v1/public/catalog/$productId")
            .andExpect {
                status { isOk() }
                jsonPath("$.id") { value(productId.toString()) }
                jsonPath("$.name") { value("Royal Canin Adult") }
                jsonPath("$.category") { value("food") }
                jsonPath("$.brand") { value("Royal Canin") }
                jsonPath("$.sku") { value("RC-ADULT-3KG") }
                jsonPath("$.imageUrls.length()") { value(0) }
                jsonPath("$.availableQuantity") { value(10) }
                jsonPath("$.normalizedBarcode") { doesNotExist() }
            }

        mockMvc.get("/api/v1/public/catalog/${UUID.randomUUID()}")
            .andExpect {
                status { isNotFound() }
                jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
            }
    }

    @Test
    fun `sorting and filtering happen before pagination`() {
        val adminToken = tokens.issue(Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)))
        val merchantActor = UUID.randomUUID()
        val outletNode = post(
            "/api/v1/merchant/outlets",
            tokens.issue(Principal(merchantActor, Role.MERCHANT)),
            "out-sort-1",
            """{"name":"Sort Test Store","capabilities":["PRODUCT_STORE"],"servicePinCodes":["517501"]}""",
        )
        val outletId = outletNode.uuid("id")
        val orgId = outletNode.uuid("organizationId")
        post("/api/v1/admin/outlets/$outletId/approve", adminToken, "app-sort-1", "{}")

        val merchantToken = tokens.issue(
            Principal(merchantActor, Role.MERCHANT, organizationId = orgId, outletIds = setOf(outletId)),
        )

        val itemA = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "item-a",
            """{"outletId":"$outletId","barcodeType":"INTERNAL","barcode":"INT-ITEM-A","name":"Item Alpha","kind":"PRODUCT","mrpPaise":10000,"sellingPricePaise":10000,"category":"testsort"}""",
        ).uuid("id")
        val itemB = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "item-b",
            """{"outletId":"$outletId","barcodeType":"INTERNAL","barcode":"INT-ITEM-B","name":"Item Beta","kind":"PRODUCT","mrpPaise":30000,"sellingPricePaise":30000,"category":"testsort"}""",
        ).uuid("id")
        val itemC = post(
            "/api/v1/merchant/listings",
            merchantToken,
            "item-c",
            """{"outletId":"$outletId","barcodeType":"INTERNAL","barcode":"INT-ITEM-C","name":"Item Charlie","kind":"PRODUCT","mrpPaise":20000,"sellingPricePaise":20000,"category":"testsort"}""",
        ).uuid("id")

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("category", "testsort")
            param("sort", "PRICE_DESC")
            param("page", "0")
            param("pageSize", "2")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(2) }
            jsonPath("$.items[0].id") { value(itemB.toString()) }
            jsonPath("$.items[1].id") { value(itemC.toString()) }
            jsonPath("$.hasNext") { value(true) }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("category", "testsort")
            param("sort", "PRICE_ASC")
            param("page", "0")
            param("pageSize", "2")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(2) }
            jsonPath("$.items[0].id") { value(itemA.toString()) }
            jsonPath("$.items[1].id") { value(itemC.toString()) }
            jsonPath("$.hasNext") { value(true) }
        }

        mockMvc.get("/api/v1/public/catalog") {
            param("outletId", outletId.toString())
            param("category", "testsort")
            param("sort", "PRICE_DESC")
            param("page", "1")
            param("pageSize", "2")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].id") { value(itemA.toString()) }
            jsonPath("$.hasNext") { value(false) }
        }
    }

    private fun post(path: String, token: String, key: String, body: String): tools.jackson.databind.JsonNode {
        val result = mockMvc.post(path) {
            header("Authorization", "Bearer $token")
            header("Idempotency-Key", key)
            if (path.startsWith("/api/v1/admin/outlets/")) {
                header("X-Admin-Purpose", "PROVIDER_REVIEW")
                header("X-Admin-Reason", "Approve provider after verification review")
            }
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect { status { is2xxSuccessful() } }.andReturn()
        return json.readTree(result.response.contentAsString)
    }

    private fun tools.jackson.databind.JsonNode.uuid(name: String): UUID = UUID.fromString(path(name).asString())
}
