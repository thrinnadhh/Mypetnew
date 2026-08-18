package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-p2-test",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:p2api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerProfileDataApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var tokens: BearerTokenService

    @Test
    fun `profile pets and addresses are authenticated owner scoped and validated`() {
        val customerA = login("+919812345680", "p2-device-a")
        val customerB = login("+919812345681", "p2-device-b")

        mockMvc.get("/api/v1/customer/profile") { bearer(customerA) }.andExpect {
            status { isOk() }
            jsonPath("$.mobile") { value("+919812345680") }
            jsonPath("$.profileCompletion") { value(50) }
        }
        mockMvc.patch("/api/v1/customer/profile") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Customer A","email":"customer.a@example.com"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.name") { value("Customer A") }
            jsonPath("$.email") { value("customer.a@example.com") }
            jsonPath("$.profileCompletion") { value(100) }
        }

        val pet = create(
            "/api/v1/customer/pets",
            customerA,
            """{"name":"Bruno","species":"DOG","breed":"Indie","dateOfBirth":"2024-01-10"}""",
        )
        val petId = pet.path("petId").asString()
        mockMvc.get("/api/v1/customer/pets?page=0&pageSize=20") { bearer(customerA) }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].petId") { value(petId) }
        }
        mockMvc.patch("/api/v1/customer/pets/$petId") {
            bearer(customerB)
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Stolen","species":"DOG"}"""
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }
        mockMvc.delete("/api/v1/customer/pets/$petId") { bearer(customerB) }.andExpect {
            status { isNotFound() }
        }

        val firstAddress = create(
            "/api/v1/customer/addresses",
            customerA,
            """{
              "label":"Home",
              "recipientName":"Customer A",
              "phoneNumber":"9812345680",
              "line1":"Renigunta Road",
              "city":"Tirupati",
              "state":"Andhra Pradesh",
              "pincode":"517501",
              "isDefault":false
            }""",
        )
        val firstId = firstAddress.path("addressId").asString()
        org.junit.jupiter.api.Assertions.assertTrue(firstAddress.path("isDefault").asBoolean())
        org.junit.jupiter.api.Assertions.assertEquals("+919812345680", firstAddress.path("phoneNumber").asString())
        org.junit.jupiter.api.Assertions.assertFalse(firstAddress.has("geoLat"))
        org.junit.jupiter.api.Assertions.assertFalse(firstAddress.has("geoLng"))

        val secondAddress = create(
            "/api/v1/customer/addresses",
            customerA,
            """{
              "label":"Work",
              "recipientName":"Customer A",
              "phoneNumber":"+919812345680",
              "line1":"Town Club Road",
              "city":"Tirupati",
              "state":"Andhra Pradesh",
              "pincode":"517502",
              "isDefault":false
            }""",
        )
        val secondId = secondAddress.path("addressId").asString()
        org.junit.jupiter.api.Assertions.assertFalse(secondAddress.path("isDefault").asBoolean())

        mockMvc.patch("/api/v1/customer/addresses/$secondId") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{
              "label":"Work",
              "recipientName":"Customer A",
              "phoneNumber":"9812345680",
              "line1":"Town Club Road",
              "city":"Tirupati",
              "state":"Andhra Pradesh",
              "pincode":"517502",
              "isDefault":true
            }"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.isDefault") { value(true) }
        }
        mockMvc.get("/api/v1/customer/addresses") { bearer(customerA) }.andExpect {
            status { isOk() }
            jsonPath("$[0].addressId") { value(secondId) }
            jsonPath("$[0].isDefault") { value(true) }
            jsonPath("$[1].addressId") { value(firstId) }
            jsonPath("$[1].isDefault") { value(false) }
        }
        mockMvc.delete("/api/v1/customer/addresses/$secondId") { bearer(customerB) }.andExpect {
            status { isNotFound() }
        }
        mockMvc.delete("/api/v1/customer/addresses/$secondId") { bearer(customerA) }.andExpect {
            status { isNoContent() }
        }
        mockMvc.get("/api/v1/customer/addresses") { bearer(customerA) }.andExpect {
            status { isOk() }
            jsonPath("$[0].addressId") { value(firstId) }
            jsonPath("$[0].isDefault") { value(true) }
        }

        mockMvc.post("/api/v1/customer/addresses") {
            bearer(customerA)
            contentType = MediaType.APPLICATION_JSON
            content = """{
              "label":"Bad",
              "recipientName":"Customer A",
              "phoneNumber":"9812345680",
              "line1":"Road",
              "city":"Tirupati",
              "state":"Andhra Pradesh",
              "pincode":"12345"
            }"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("ADDRESS_INVALID") }
        }

        mockMvc.get("/api/v1/customer/pets?page=0&pageSize=101") { bearer(customerA) }.andExpect {
            status { isBadRequest() }
        }
        mockMvc.get("/api/v1/customer/pets?page=0&pageSize=20").andExpect { status { isUnauthorized() } }
        mockMvc.get("/api/v1/customer/pets?page=0&pageSize=20") {
            header("Authorization", "Bearer ${tokens.issue(Principal(UUID.randomUUID(), Role.MERCHANT))}")
        }.andExpect { status { isForbidden() } }
    }

    @Test
    fun `pin serviceability is server derived and pickup is independent of delivery pins`() {
        val merchantActor = UUID.randomUUID()
        val merchantToken = tokens.issue(Principal(merchantActor, Role.MERCHANT))
        val adminToken = tokens.issue(
            Principal(UUID.randomUUID(), Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
        )
        val submitted = postWithToken(
            "/api/v1/merchant/outlets",
            merchantToken,
            "p2-outlet",
            """{"name":"P2 Pet Store","capabilities":["PRODUCT_STORE"],"servicePinCodes":["517501"]}""",
        )
        val outletId = submitted.path("id").asString()
        postWithToken("/api/v1/admin/outlets/$outletId/approve", adminToken, "p2-approve", "{}")

        mockMvc.get("/api/v1/public/outlets/$outletId/serviceability?pincode=517501&mode=DELIVERY").andExpect {
            status { isOk() }
            jsonPath("$.serviceable") { value(false) }
            jsonPath("$.fulfilmentMode") { value("MYPET_CAPTAIN_DELIVERY") }
            jsonPath("$.reasonCode") { value("DELIVERY_ORIGIN_UNAVAILABLE") }
        }

        val outletScopedMerchantToken = tokens.issue(
            Principal(merchantActor, Role.MERCHANT, outletIds = setOf(UUID.fromString(outletId))),
        )
        mockMvc.put("/api/v1/merchant/outlets/$outletId/dispatch-origin") {
            header("Authorization", "Bearer $outletScopedMerchantToken")
            contentType = MediaType.APPLICATION_JSON
            content = """{"latitude":13.6288,"longitude":79.4192}"""
        }.andExpect { status { isOk() } }

        mockMvc.get("/api/v1/public/outlets/$outletId/serviceability?pincode=517501&mode=DELIVERY").andExpect {
            status { isOk() }
            jsonPath("$.serviceable") { value(true) }
            jsonPath("$.fulfilmentMode") { value("MYPET_CAPTAIN_DELIVERY") }
            jsonPath("$.reasonCode") { value("SERVICEABLE") }
        }
        mockMvc.get("/api/v1/public/outlets/$outletId/serviceability?pincode=517502&mode=DELIVERY").andExpect {
            status { isOk() }
            jsonPath("$.serviceable") { value(false) }
            jsonPath("$.reasonCode") { value("PIN_NOT_SERVICEABLE") }
        }
        mockMvc.get("/api/v1/public/outlets/$outletId/serviceability?pincode=517502&mode=PICKUP").andExpect {
            status { isOk() }
            jsonPath("$.serviceable") { value(true) }
            jsonPath("$.fulfilmentMode") { value("STORE_PICKUP") }
        }
    }

    private fun create(path: String, session: JsonNode, body: String): JsonNode {
        val result = mockMvc.post(path) {
            bearer(session)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect { status { isCreated() } }.andReturn()
        return objectMapper.readTree(result.response.contentAsString)
    }

    private fun postWithToken(path: String, token: String, key: String, body: String): JsonNode {
        val result = mockMvc.post(path) {
            header("Authorization", "Bearer $token")
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect { status { is2xxSuccessful() } }.andReturn()
        return objectMapper.readTree(result.response.contentAsString)
    }

    private fun login(mobile: String, deviceId: String): JsonNode {
        val response = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"$deviceId"}"""
        }.andReturn()
        val challengeId = objectMapper.readTree(response.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verify = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{
              "challengeId":"$challengeId",
              "mobile":"$mobile",
              "purpose":"LOGIN",
              "code":"$code",
              "adultEligibilityAttested":true
            }"""
        }.andExpect { status { isOk() } }.andReturn()
        return objectMapper.readTree(verify.response.contentAsString)
    }

    private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.bearer(session: JsonNode) {
        header("Authorization", "Bearer ${session.path("accessToken").asString()}")
    }
}
