package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MockHttpServletRequestDsl
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "spring.flyway.enabled=false",
        "mypet.security.token-secret=test-only-r1-postgres-contract-token-secret-12345",
        "mypet.security.token-issuer=mypetnew-r1-postgres-contract",
        "mypet.security.token-audience=mypetnew-r1-postgres-contract-clients",
        "mypet.sync.cursor-secret=test-only-r1-cursor-secret-1234567890",
        "mypet.delivery.base-fee-paise=2500",
        "mypet.delivery.eta-minutes=35",
        "mypet.cashfree.enabled=false",
        "mypet.notifications.delivery.enabled=false",
        "mypet.notifications.device-token-encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "mypet.firebase.project-id=mypetnew-r1-test",
        "mypet.firebase.environment=development",
        "management.health.redis.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("local-isolated")
class R1ControllerReplayRecoveryPostgresContractTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var json: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var tokens: BearerTokenService
    @Autowired private lateinit var jdbc: JdbcTemplate

    @BeforeEach
    fun resetDatabase() {
        PostgresTestDatabase.resetAndMigrate()
    }

    @Test
    fun `AC2 and AC13 - customer concurrent HTTP replay converges to single order and reservation`() {
        val fixture = createCommerceFixture()
        val customer = fixture.customer
        val outletId = fixture.outletId
        val listingId = fixture.listingId

        // Stock is exactly 1 unit (the last available unit)
        receiveStock(fixture.merchantToken, outletId, listingId, 1, "seed-stock-concurrent-1")
        assertEquals(1, availableStock(listingId))

        // Create pickup quote for 1 unit
        val quoteResult = postJson(
            "/api/v1/customer/quotes/pickup",
            customer.accessToken,
            "quote-concurrent-customer",
            """{"outletId":"$outletId","lines":[{"listingId":"$listingId","quantity":1}],"paymentMethod":"PAY_ON_FULFILMENT"}""",
        )
        val quoteId = quoteResult.uuid("id")
        val cartSignature = quoteResult.path("cartSignature").asString()
        val idempotencyKey = "customer-concurrent-checkout-key"
        val checkoutBody = """{"quoteId":"$quoteId","cartSignature":"$cartSignature"}"""

        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val futures = listOf(
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    postJsonExpectStatus(
                        "/api/v1/customer/orders",
                        customer.accessToken,
                        idempotencyKey,
                        checkoutBody,
                        200,
                    )
                }),
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    postJsonExpectStatus(
                        "/api/v1/customer/orders",
                        customer.accessToken,
                        idempotencyKey,
                        checkoutBody,
                        200,
                    )
                }),
            )
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val results = futures.map { it.get(15, TimeUnit.SECONDS) }

            val orderId1 = results[0].uuid("id")
            val orderId2 = results[1].uuid("id")
            assertEquals(orderId1, orderId2, "Both concurrent HTTP checkouts must converge to the same authoritative order ID")
            assertEquals("PLACED", results[0].path("status").asString())
            assertEquals("PLACED", results[1].path("status").asString())

            // Database final-state assertions (AC13)
            assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.product_order"))
            assertEquals(0, scalarInt("SELECT COUNT(*) FROM mypet.pos_sale"))
            assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.product_order_line"))
            assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.inventory_reservation WHERE status = 'RESERVED'"))
            assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.inventory_movement WHERE reason = 'ORDER_RESERVE'"))
            assertEquals(0, availableStock(listingId))
            assertEquals(1, scalarInt("SELECT reserved FROM mypet.inventory_balance WHERE listing_id = ?", listingId))
            assertEquals(orderId1.toString(), scalarString("SELECT id::text FROM mypet.product_order WHERE customer_id = ? AND checkout_idempotency_key = ?", customer.accountId, idempotencyKey))
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `AC8 and AC13 - POS concurrent HTTP replay converges to single sale and inventory decrement`() {
        val fixture = createCommerceFixture()
        val merchantToken = fixture.merchantToken
        val outletId = fixture.outletId
        val listingId = fixture.listingId

        // Stock is exactly 1 unit
        receiveStock(merchantToken, outletId, listingId, 1, "seed-stock-pos-concurrent")
        assertEquals(1, availableStock(listingId))

        val idempotencyKey = "pos-concurrent-sale-key"
        val salePayload = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CASH",
            "lines": [{"listingId": "$listingId", "quantity": 1}]
        }""".trimIndent()

        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val futures = listOf(
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    postJsonExpectStatus(
                        "/api/v1/merchant/pos/sales",
                        merchantToken,
                        idempotencyKey,
                        salePayload,
                        200,
                    )
                }),
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    postJsonExpectStatus(
                        "/api/v1/merchant/pos/sales",
                        merchantToken,
                        idempotencyKey,
                        salePayload,
                        200,
                    )
                }),
            )
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val results = futures.map { it.get(15, TimeUnit.SECONDS) }

            val saleId1 = results[0].uuid("id")
            val saleId2 = results[1].uuid("id")
            assertEquals(saleId1, saleId2, "Both concurrent POS HTTP sales must converge to the same authoritative sale ID")

            // Database final-state assertions (AC13)
            assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.pos_sale"))
            assertEquals(0, scalarInt("SELECT COUNT(*) FROM mypet.product_order"))
            assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.pos_sale_line"))
            assertEquals(1, scalarInt("SELECT COUNT(*) FROM mypet.inventory_movement WHERE reason = 'POS_SALE'"))
            assertEquals(0, availableStock(listingId))
            assertEquals(0, scalarInt("SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?", listingId))
            assertEquals(saleId1.toString(), scalarString("SELECT id::text FROM mypet.pos_sale WHERE outlet_id = ? AND idempotency_key = ?", outletId, idempotencyKey))
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `AC1, AC3, AC4, AC5 - customer sequential replay, stale rejection, conflict rejection, and ownership`() {
        val fixture = createCommerceFixture()
        val customerA = fixture.customer
        val customerB = loginCustomer(nextMobile())
        val outletId = fixture.outletId
        val listingId = fixture.listingId

        receiveStock(fixture.merchantToken, outletId, listingId, 1, "seed-stock-sequential-1")

        val quoteA = postJson(
            "/api/v1/customer/quotes/pickup",
            customerA.accessToken,
            "quote-seq-customer-a",
            """{"outletId":"$outletId","lines":[{"listingId":"$listingId","quantity":1}],"paymentMethod":"PAY_ON_FULFILMENT"}""",
        )
        val quoteB = postJson(
            "/api/v1/customer/quotes/pickup",
            customerB.accessToken,
            "quote-seq-customer-b",
            """{"outletId":"$outletId","lines":[{"listingId":"$listingId","quantity":1}],"paymentMethod":"PAY_ON_FULFILMENT"}""",
        )

        val keyA = "seq-checkout-key-a"
        val bodyA = """{"quoteId":"${quoteA.uuid("id")}","cartSignature":"${quoteA.path("cartSignature").asString()}"}"""
        val bodyB = """{"quoteId":"${quoteB.uuid("id")}","cartSignature":"${quoteB.path("cartSignature").asString()}"}"""

        // 1. Customer A completes checkout -> consumes the last unit
        val orderA = postJson("/api/v1/customer/orders", customerA.accessToken, keyA, bodyA)
        val orderAId = orderA.uuid("id")
        assertEquals(0, availableStock(listingId))

        // AC1: 2. Identical replay when stock is 0 succeeds and returns same order
        val replayA = postJson("/api/v1/customer/orders", customerA.accessToken, keyA, bodyA)
        assertEquals(orderAId, replayA.uuid("id"))

        // AC3: 3. Customer B attempts checkout with fresh key -> fails with QUOTE_STALE
        mockMvc.post("/api/v1/customer/orders") {
            bearer(customerB.accessToken)
            header("Idempotency-Key", "seq-checkout-key-b")
            contentType = MediaType.APPLICATION_JSON
            content = bodyB
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("QUOTE_STALE") }
        }

        // AC4: 4. Same key with conflicting quoteId -> 409 IDEMPOTENCY_FINGERPRINT_MISMATCH
        mockMvc.post("/api/v1/customer/orders") {
            bearer(customerA.accessToken)
            header("Idempotency-Key", keyA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"${UUID.randomUUID()}","cartSignature":"${quoteA.path("cartSignature").asString()}"}"""
        }.andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("IDEMPOTENCY_FINGERPRINT_MISMATCH") }
        }

        // AC5: 5. Customer B cannot recover Customer A's order by key
        mockMvc.get("/api/v1/customer/orders/by-key?idempotencyKey=$keyA") {
            bearer(customerB.accessToken)
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("ORDER_NOT_FOUND") }
        }
    }

    @Test
    fun `AC6, AC11, AC12 - POS duplicate line rejection, progressed order recovery, and cross-merchant isolation`() {
        val fixture = createCommerceFixture()
        val merchantToken = fixture.merchantToken
        val outletId = fixture.outletId
        val listingId = fixture.listingId

        receiveStock(merchantToken, outletId, listingId, 5, "seed-stock-duplicate-lines")

        val saleKey = "pos-duplicate-line-test-key"
        val normalPayload = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CASH",
            "lines": [{"listingId": "$listingId", "quantity": 2}]
        }""".trimIndent()

        // Commit original sale of 2 units
        val originalSale = postJson("/api/v1/merchant/pos/sales", merchantToken, saleKey, normalPayload)
        val saleId = originalSale.uuid("id")

        // AC11: Malformed retry with duplicate lines [A x 1, A x 2] must fail closed with POS_LINE_INVALID (400)
        // and must NOT collapse into an identical replay
        val duplicatePayload1 = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CASH",
            "lines": [
                {"listingId": "$listingId", "quantity": 1},
                {"listingId": "$listingId", "quantity": 2}
            ]
        }""".trimIndent()
        mockMvc.post("/api/v1/merchant/pos/sales") {
            bearer(merchantToken)
            header("Idempotency-Key", saleKey)
            contentType = MediaType.APPLICATION_JSON
            content = duplicatePayload1
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("POS_LINE_INVALID") }
        }

        // AC11: Also test [A x 2, A x 1]
        val duplicatePayload2 = """{
            "outletId": "$outletId",
            "associationChallengeId": null,
            "paymentDeclaration": "CASH",
            "lines": [
                {"listingId": "$listingId", "quantity": 2},
                {"listingId": "$listingId", "quantity": 1}
            ]
        }""".trimIndent()
        mockMvc.post("/api/v1/merchant/pos/sales") {
            bearer(merchantToken)
            header("Idempotency-Key", saleKey)
            contentType = MediaType.APPLICATION_JSON
            content = duplicatePayload2
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("POS_LINE_INVALID") }
        }

        // AC12: Cross-outlet recovery is rejected (anti-enumeration returns 404 RESOURCE_NOT_FOUND)
        val foreignMerchantId = UUID.randomUUID()
        val foreignMerchantMobile = nextMobile()
        seedIdentity(foreignMerchantId, foreignMerchantMobile, Role.MERCHANT)
        val foreignMerchant = loginMerchant(foreignMerchantMobile)
        mockMvc.get("/api/v1/merchant/pos/sales/by-key?outletId=$outletId&idempotencyKey=$saleKey") {
            bearer(foreignMerchant.accessToken)
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }

        // AC6: Progressed order recovery returns current authoritative status
        val customer = fixture.customer
        val quote = postJson(
            "/api/v1/customer/quotes/pickup",
            customer.accessToken,
            "quote-progressed-test",
            """{"outletId":"$outletId","lines":[{"listingId":"$listingId","quantity":1}],"paymentMethod":"PAY_ON_FULFILMENT"}""",
        )
        val orderKey = "order-progressed-key"
        val order = postJson(
            "/api/v1/customer/orders",
            customer.accessToken,
            orderKey,
            """{"quoteId":"${quote.uuid("id")}","cartSignature":"${quote.path("cartSignature").asString()}"}""",
        )
        val orderId = order.uuid("id")

        // Transition order to ACCEPTED
        mockMvc.post("/api/v1/merchant/orders/$orderId/transitions") {
            bearer(merchantToken)
            header("Idempotency-Key", "transition-accept-key")
            contentType = MediaType.APPLICATION_JSON
            content = """{"target":"ACCEPTED"}"""
        }.andExpect { status { isOk() } }

        // Customer recovery by idempotency key returns ACCEPTED
        mockMvc.get("/api/v1/customer/orders/by-key?idempotencyKey=$orderKey") {
            bearer(customer.accessToken)
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(orderId.toString()) }
            jsonPath("$.status") { value("ACCEPTED") }
        }
    }

    private data class CommerceFixture(
        val admin: Session,
        val merchant: Session,
        val merchantToken: String,
        val customer: Session,
        val outletId: UUID,
        val listingId: UUID,
    )

    private val mobileSequence = java.util.concurrent.atomic.AtomicInteger(100)

    private fun nextMobile(): String = "+9198765%05d".format(mobileSequence.incrementAndGet())

    private fun createCommerceFixture(): CommerceFixture {
        val admin = seedAdmin()
        val merchantMobile = nextMobile()
        val customerMobile = nextMobile()
        val merchantId = UUID.randomUUID()

        seedIdentity(merchantId, merchantMobile, Role.MERCHANT)
        val merchant = loginMerchant(merchantMobile)
        val customer = loginCustomer(customerMobile)

        val outlet = postJson(
            "/api/v1/merchant/outlets",
            merchant.accessToken,
            "e2e-outlet-submit-${UUID.randomUUID()}",
            """{"name":"R1 Contract Store","pickupEnabled":true,"capabilities":["PRODUCT_STORE"],"servicePinCodes":["517501"]}""",
        )
        val outletId = outlet.uuid("id")

        postJson(
            "/api/v1/admin/outlets/$outletId/approve",
            admin.accessToken,
            "e2e-outlet-approve-${UUID.randomUUID()}",
            "{}",
            mapOf(
                "X-Admin-Purpose" to "PROVIDER_REVIEW",
                "X-Admin-Reason" to "R1 contract provider approval",
            ),
        )

        val listing = postJson(
            "/api/v1/merchant/listings",
            merchant.accessToken,
            "listing-create-${UUID.randomUUID()}",
            """{"outletId":"$outletId","barcodeType":"INTERNAL","barcode":"R1-PROD-${UUID.randomUUID().toString().take(8).uppercase()}","name":"R1 Product","kind":"PRODUCT","mrpPaise":10000,"sellingPricePaise":8000,"category":"food"}""",
        )
        val listingId = listing.uuid("id")

        return CommerceFixture(admin, merchant, merchant.accessToken, customer, outletId, listingId)
    }

    private fun receiveStock(token: String, outletId: UUID, listingId: UUID, quantity: Int, key: String) {
        postJson(
            "/api/v1/merchant/inventory/receive",
            token,
            key,
            """{"outletId":"$outletId","listingId":"$listingId","quantity":$quantity}""",
        )
    }

    private fun availableStock(listingId: UUID): Int =
        scalarInt("SELECT on_hand - reserved FROM mypet.inventory_balance WHERE listing_id = ?", listingId)

    private fun loginCustomer(mobile: String): Session {
        val challengeId = requestOtp(mobile, "r1-customer-device-${UUID.randomUUID()}")
        val code = (otpProvider as InMemoryOtpProvider).codeFor(challengeId)
        val result = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        return session(result.response.contentAsString)
    }

    private fun loginMerchant(mobile: String): Session {
        val challengeId = requestOtp(mobile, "r1-merchant-device-${UUID.randomUUID()}")
        val code = (otpProvider as InMemoryOtpProvider).codeFor(challengeId)
        val result = mockMvc.post("/api/v1/auth/merchant/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("MERCHANT") }
        }.andReturn()
        return session(result.response.contentAsString)
    }

    private val ipSequence = java.util.concurrent.atomic.AtomicInteger(1)

    private fun requestOtp(mobile: String, deviceId: String): UUID {
        val ip = "10.0.0.${ipSequence.incrementAndGet()}"
        val result = mockMvc.post("/api/v1/auth/otp/request") {
            with { req -> req.remoteAddr = ip; req }
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"$deviceId"}"""
        }.andExpect { status { isOk() } }.andReturn()
        return UUID.fromString(json.readTree(result.response.contentAsString).path("challengeId").asString())
    }

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
        val adminMobile = nextMobile()
        seedIdentity(adminId, adminMobile, Role.ADMIN)
        jdbc.update(
            """
            INSERT INTO mypet.user_session(id, account_id, refresh_token_hash, device_id, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """.trimIndent(),
            sessionId,
            adminId,
            "r1-admin-${UUID.randomUUID()}",
            "r1-admin-device",
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

    private fun postJsonExpectStatus(
        path: String,
        token: String,
        idempotencyKey: String,
        body: String,
        expectedStatus: Int,
    ): JsonNode {
        val result = mockMvc.post(path) {
            bearer(token)
            header("Idempotency-Key", idempotencyKey)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andExpect { status { isEqualTo(expectedStatus) } }.andReturn()
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
