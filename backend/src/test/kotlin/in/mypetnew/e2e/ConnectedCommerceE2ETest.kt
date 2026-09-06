package `in`.mypetnew.e2e

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.merchantops.testsupport.ConnectedE2E
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockHttpServletRequestDsl
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "spring.flyway.enabled=false",
        "mypet.security.token-secret=test-only-connected-e2e-token-secret-1234567890",
        "mypet.security.token-issuer=mypetnew-connected-e2e",
        "mypet.security.token-audience=mypetnew-connected-e2e-clients",
        "mypet.sync.cursor-secret=test-only-connected-e2e-cursor-secret-1234567890",
        "mypet.delivery.base-fee-paise=2500",
        "mypet.delivery.eta-minutes=35",
        "mypet.cashfree.enabled=false",
        "mypet.notifications.delivery.enabled=false",
        "mypet.notifications.device-token-encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "mypet.firebase.project-id=mypetnew-e2e",
        "mypet.firebase.environment=development",
        "management.health.redis.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("local-isolated")
@ConnectedE2E
class ConnectedCommerceE2ETest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var json: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var tokens: BearerTokenService
    @Autowired private lateinit var jdbc: JdbcTemplate

    @Test
    fun `customer merchant captain and admin complete one canonical delivery transaction`() {
        val merchantMobile = "+919876540101"
        val captainMobile = "+919876540102"
        val customerMobile = "+919876540103"
        val merchantId = UUID.randomUUID()
        val captainId = UUID.randomUUID()

        seedIdentity(merchantId, merchantMobile, Role.MERCHANT)
        seedIdentity(captainId, captainMobile, Role.CAPTAIN)
        val admin = seedAdmin()

        val merchant = loginMerchant(merchantMobile)
        assertEquals(merchantId, merchant.accountId)

        val submitted = postJson(
            "/api/v1/merchant/outlets",
            merchant.accessToken,
            "e2e-outlet-submit",
            """{"name":"Connected Pets Tirupati","capabilities":["PRODUCT_STORE"],"servicePinCodes":["517501"]}""",
        )
        val outletId = submitted.uuid("id")
        val organizationId = submitted.uuid("organizationId")

        postJson(
            "/api/v1/admin/outlets/$outletId/approve",
            admin.accessToken,
            "e2e-outlet-approve",
            "{}",
            mapOf(
                "X-Admin-Purpose" to "PROVIDER_REVIEW",
                "X-Admin-Reason" to "Connected E2E provider verification approval",
            ),
        )

        mockMvc.put("/api/v1/merchant/outlets/$outletId/dispatch-origin") {
            bearer(merchant.accessToken)
            contentType = MediaType.APPLICATION_JSON
            content = """{"latitude":13.6287,"longitude":79.4191}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(outletId.toString()) }
        }

        val listing = postJson(
            "/api/v1/merchant/listings",
            merchant.accessToken,
            "e2e-listing-create",
            """{"outletId":"$outletId","barcodeType":"GTIN_13","barcode":"8901234567890","name":"Connected Dog Food","kind":"PRODUCT","mrpPaise":15000,"sellingPricePaise":12500,"category":"food"}""",
        )
        val listingId = listing.uuid("id")
        postJson(
            "/api/v1/merchant/inventory/receive",
            merchant.accessToken,
            "e2e-stock-receive",
            """{"outletId":"$outletId","listingId":"$listingId","quantity":1}""",
        )

        val captain = loginCaptain(captainMobile)
        assertEquals(captainId, captain.accountId)
        completeCaptainOnboarding(captain.accessToken)
        mockMvc.post("/api/v1/admin/captains/$captainId/approve") {
            bearer(admin.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.approved") { value(true) }
        }
        mockMvc.put("/api/v1/captain/availability") {
            bearer(captain.accessToken)
            contentType = MediaType.APPLICATION_JSON
            content = """{"online":true,"latitude":13.6288,"longitude":79.4192,"accuracy":8}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.approved") { value(true) }
            jsonPath("$.online") { value(true) }
        }

        val customer = loginCustomer(customerMobile)
        val address = mockMvc.post("/api/v1/customer/addresses") {
            bearer(customer.accessToken)
            contentType = MediaType.APPLICATION_JSON
            content = """
                {
                  "label":"Home",
                  "recipientName":"E2E Customer",
                  "phoneNumber":"9876540103",
                  "line1":"1 Connected Street",
                  "city":"Tirupati",
                  "state":"Andhra Pradesh",
                  "pincode":"517501",
                  "isDefault":true
                }
            """.trimIndent()
        }.andExpect {
            status { isCreated() }
            jsonPath("$.pincode") { value("517501") }
        }.andReturn()
        val addressId = json.readTree(address.response.contentAsString).uuid("addressId")

        val quoteResult = mockMvc.post("/api/v1/customer/quotes/delivery") {
            bearer(customer.accessToken)
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"$outletId","addressId":"$addressId","lines":[{"listingId":"$listingId","quantity":1}]}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.fulfilmentMode") { value("MYPET_CAPTAIN_DELIVERY") }
            jsonPath("$.pricing.deliveryFeePaise") { value(2500) }
            jsonPath("$.etaMinutes") { value(35) }
        }.andReturn()
        val quote = json.readTree(quoteResult.response.contentAsString)
        val checkoutBody = """{"quoteId":"${quote.uuid("id")}","cartSignature":"${quote.path("cartSignature").asString()}"}"""

        val firstOrder = postJson("/api/v1/customer/orders", customer.accessToken, "e2e-checkout", checkoutBody)
        val replayOrder = postJson("/api/v1/customer/orders", customer.accessToken, "e2e-checkout", checkoutBody)
        val orderId = firstOrder.uuid("id")
        assertEquals(orderId, replayOrder.uuid("id"))
        assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.product_order WHERE id = ?", orderId))
        assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.inventory_reservation WHERE order_id = ?", orderId))
        assertEquals(0, scalarInt("SELECT on_hand - reserved FROM mypet.inventory_balance WHERE listing_id = ?", listingId), "available stock must be 0 (last unit reserved)")

        transitionMerchant(orderId, merchant.accessToken, "ACCEPTED", "e2e-order-accepted")
        transitionMerchant(orderId, merchant.accessToken, "PREPARING", "e2e-order-preparing")
        transitionMerchant(orderId, merchant.accessToken, "READY_FOR_PICKUP", "e2e-order-ready")
        transitionMerchant(orderId, merchant.accessToken, "READY_FOR_PICKUP", "e2e-order-ready")
        assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.dispatch_job WHERE order_id = ?", orderId))

        val offers = mockMvc.get("/api/v1/captain/dispatch/offers") {
            bearer(captain.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.length()") { value(1) }
        }.andReturn()
        val offerId = UUID.fromString(json.readTree(offers.response.contentAsString).path(0).path("offerId").asString())

        val assignment = mockMvc.post("/api/v1/captain/dispatch/offers/$offerId/respond") {
            bearer(captain.accessToken)
            contentType = MediaType.APPLICATION_JSON
            content = """{"action":"ACCEPT"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.accepted") { value(true) }
            jsonPath("$.orderId") { value(orderId.toString()) }
            jsonPath("$.deliveryAddress.pincode") { value("517501") }
        }.andReturn()
        val jobId = json.readTree(assignment.response.contentAsString).uuid("jobId")

        val assignedTracking = mockMvc.get("/api/v1/customer/orders/$orderId/tracking") {
            bearer(customer.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.flowStep") { value("assigned") }
            jsonPath("$.captain.captainId") { value(captainId.toString()) }
            jsonPath("$.deliveryPin") { isNotEmpty() }
        }.andReturn()
        val deliveryPin = json.readTree(assignedTracking.response.contentAsString).path("deliveryPin").asString()

        val handoff = mockMvc.get("/api/v1/merchant/orders/$orderId/delivery-handoff") {
            bearer(merchant.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.jobId") { value(jobId.toString()) }
            jsonPath("$.status") { value("ASSIGNED") }
            jsonPath("$.assignedCaptainId") { value(captainId.toString()) }
            jsonPath("$.pickupPin") { isNotEmpty() }
        }.andReturn()
        val pickupPin = json.readTree(handoff.response.contentAsString).path("pickupPin").asString()
        assertNotEquals(deliveryPin, pickupPin)

        mockMvc.get("/api/v1/merchant/orders/$orderId/delivery-handoff") {
            bearer(customer.accessToken)
        }.andExpect { status { isForbidden() } }

        captainProof("/api/v1/captain/dispatch/$jobId/picked-up", captain.accessToken, "e2e-captain-pickup", pickupPin, "PICKED_UP")
        captainProof("/api/v1/captain/dispatch/$jobId/picked-up", captain.accessToken, "e2e-captain-pickup", pickupPin, "PICKED_UP")
        mockMvc.get("/api/v1/merchant/orders/$orderId/delivery-handoff") {
            bearer(merchant.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("PICKED_UP") }
            jsonPath("$.pickupPin") { doesNotExist() }
        }

        mockMvc.post("/api/v1/captain/location") {
            bearer(captain.accessToken)
            contentType = MediaType.APPLICATION_JSON
            content = """{"latitude":13.6290,"longitude":79.4194,"accuracy":7}"""
        }.andExpect { status { isOk() } }
        mockMvc.get("/api/v1/customer/orders/$orderId/tracking") {
            bearer(customer.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("PICKED_UP") }
            jsonPath("$.flowStep") { value("outForDelivery") }
            jsonPath("$.lastLocation.latitude") { isNumber() }
            jsonPath("$.deliveryPin") { value(deliveryPin) }
        }

        captainProof("/api/v1/captain/dispatch/$jobId/delivered", captain.accessToken, "e2e-captain-delivered", deliveryPin, "DELIVERED")
        captainProof("/api/v1/captain/dispatch/$jobId/delivered", captain.accessToken, "e2e-captain-delivered", deliveryPin, "DELIVERED")

        mockMvc.get("/api/v1/customer/orders/$orderId/tracking") {
            bearer(customer.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("DELIVERED") }
            jsonPath("$.flowStep") { value("delivered") }
            jsonPath("$.deliveryStatus") { value("DELIVERED") }
            jsonPath("$.deliveryPin") { doesNotExist() }
            jsonPath("$.lastLocation") { doesNotExist() }
        }
        mockMvc.get("/api/v1/captain/dispatch/active") {
            bearer(captain.accessToken)
        }.andExpect { status { isNoContent() } }

        assertEquals("DELIVERED", scalarString("SELECT status FROM mypet.product_order WHERE id = ?", orderId))
        assertEquals("DELIVERED", scalarString("SELECT status FROM mypet.dispatch_job WHERE id = ?", jobId))
        assertEquals("FULFILLED", scalarString("SELECT status FROM mypet.inventory_reservation WHERE order_id = ?", orderId))
        assertEquals(0, scalarInt("SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?", listingId))
        assertEquals(0, scalarInt("SELECT reserved FROM mypet.inventory_balance WHERE listing_id = ?", listingId))
        assertEquals(
            1,
            scalarInt(
                "SELECT COUNT(*) FROM mypet.audit_event WHERE target_id = ? AND action = 'ADMIN_PROVIDER_OUTLET_APPROVED'",
                outletId,
            ),
        )
        assertTrue(
            scalarInt("SELECT COUNT(*) FROM mypet.notification_item WHERE recipient_id = ?", customer.accountId) >= 3,
            "customer should receive durable order notification records",
        )
        assertEquals(organizationId, submitted.uuid("organizationId"))
    }

    private fun transitionMerchant(orderId: UUID, token: String, target: String, key: String) {
        mockMvc.post("/api/v1/merchant/orders/$orderId/transitions") {
            bearer(token)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = """{"target":"$target"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value(target) }
        }
    }

    private fun captainProof(path: String, token: String, key: String, pin: String, status: String) {
        mockMvc.post(path) {
            bearer(token)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = """{"proof":{"type":"PIN","pinCode":"$pin"}}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value(status) }
        }
    }

    private fun completeCaptainOnboarding(token: String) {
        mockMvc.put("/api/v1/captain/onboarding/draft") {
            bearer(token)
            contentType = MediaType.APPLICATION_JSON
            content = """
                {
                  "personal":{"fullName":"Connected Captain","dob":"1994-05-12","emergencyContact":"+919800000000","address":"2 Rider Street","city":"Tirupati","pincode":"517501"},
                  "identity":{"identityType":"AADHAAR","identityNumber":"999988887777","drivingLicenseNumber":"AP0320210001234","licenseExpiry":"2032-12-31","licenseUploaded":true},
                  "vehicle":{"vehicleType":"BIKE","registrationNumber":"AP03EZ1234","model":"E2E Bike","colour":"Black","rcUploaded":true},
                  "bank":{"accountHolder":"Connected Captain","accountNumber":"123456789012","ifsc":"SBIN0001234","bankName":"State Bank of India"},
                  "consent":{"captainAgreementAccepted":true,"privacyPolicyAccepted":true,"locationUsageAccepted":true,"safetyPolicyAccepted":true,"settlementTermsAccepted":true},
                  "stepCompleted":5
                }
            """.trimIndent()
        }.andExpect { status { isOk() } }
        mockMvc.post("/api/v1/captain/onboarding/submit") {
            bearer(token)
            header("Idempotency-Key", "e2e-captain-onboarding")
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("SUBMITTED") }
        }
    }

    private fun loginCustomer(mobile: String): Session {
        val challengeId = requestOtp(mobile, "e2e-customer-device")
        val code = inMemoryOtp().codeFor(challengeId)
        val result = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        return session(result.response.contentAsString)
    }

    private fun loginMerchant(mobile: String): Session {
        val challengeId = requestOtp(mobile, "e2e-merchant-device")
        val code = inMemoryOtp().codeFor(challengeId)
        val result = mockMvc.post("/api/v1/auth/merchant/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("MERCHANT") }
        }.andReturn()
        return session(result.response.contentAsString)
    }

    private fun loginCaptain(mobile: String): Session {
        val challengeId = requestOtp(mobile, "e2e-captain-device")
        val code = inMemoryOtp().codeFor(challengeId)
        val result = mockMvc.post("/api/v1/auth/captain/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("CAPTAIN") }
        }.andReturn()
        return session(result.response.contentAsString)
    }

    private fun requestOtp(mobile: String, deviceId: String): UUID {
        val result = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"$deviceId"}"""
        }.andExpect { status { isOk() } }.andReturn()
        return UUID.fromString(json.readTree(result.response.contentAsString).path("challengeId").asString())
    }

    private fun inMemoryOtp(): InMemoryOtpProvider = otpProvider as? InMemoryOtpProvider
        ?: error("connected E2E requires local-isolated InMemoryOtpProvider")

    private fun seedIdentity(accountId: UUID, mobile: String, role: Role) {
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, ?, 'ACTIVE')",
            accountId,
            mobile,
            role.name,
        )
    }

    private fun seedAdmin(): Session {
        val adminId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        seedIdentity(adminId, "+919876540199", Role.ADMIN)
        jdbc.update(
            """
            INSERT INTO mypet.user_session(id, account_id, refresh_token_hash, device_id, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """.trimIndent(),
            sessionId,
            adminId,
            "e2e-admin-${UUID.randomUUID()}",
            "e2e-admin-device",
            Timestamp.from(Instant.now().plus(1, ChronoUnit.HOURS)),
        )
        val token = tokens.issue(
            Principal(
                actorId = adminId,
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW, AdminPermission.CAPTAIN_REVIEW, AdminPermission.AUDIT_VIEW),
                sessionId = sessionId,
            ),
        )
        return Session(adminId, token)
    }

    private fun postJson(
        path: String,
        token: String,
        idempotencyKey: String,
        body: String,
        headers: Map<String, String> = emptyMap(),
    ): JsonNode {
        val result = mockMvc.post(path) {
            bearer(token)
            header("Idempotency-Key", idempotencyKey)
            headers.forEach { (name, value) -> header(name, value) }
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect { status { is2xxSuccessful() } }.andReturn()
        return json.readTree(result.response.contentAsString)
    }

    private fun MockHttpServletRequestDsl.bearer(token: String) {
        header("Authorization", "Bearer $token")
    }

    private fun session(body: String): Session {
        val node = json.readTree(body)
        return Session(node.uuid("accountId"), node.path("accessToken").asString())
    }

    private fun JsonNode.uuid(field: String): UUID = UUID.fromString(path(field).asString())

    private fun scalarInt(sql: String, vararg args: Any): Int =
        requireNotNull(jdbc.queryForObject(sql, Int::class.java, *args))

    private fun scalarString(sql: String, vararg args: Any): String =
        requireNotNull(jdbc.queryForObject(sql, String::class.java, *args))

    private data class Session(val accountId: UUID, val accessToken: String)

    companion object {
        private class RedisContainer : GenericContainer<RedisContainer>(DockerImageName.parse("redis:7.4-alpine"))

        private val postgres = run {
            PostgresTestDatabase.resetAndMigrate()
            PostgresTestDatabase.connectionInfo()
        }
        private val redis = RedisContainer().withExposedPorts(6379).also { it.start() }

        @JvmStatic
        @DynamicPropertySource
        fun connectedInfrastructure(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { postgres.jdbcUrl }
            registry.add("spring.datasource.username") { postgres.username }
            registry.add("spring.datasource.password") { postgres.password }
            registry.add("spring.data.redis.host") { redis.host }
            registry.add("spring.data.redis.port") { redis.getMappedPort(6379) }
        }
    }
}
