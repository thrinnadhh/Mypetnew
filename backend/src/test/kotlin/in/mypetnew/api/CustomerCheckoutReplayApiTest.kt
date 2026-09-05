package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
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
        "mypet.security.token-issuer=mypetnew-test-checkout-replay",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:checkout-replay;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerCheckoutReplayApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var providers: ProviderService
    @Autowired private lateinit var catalog: CatalogService
    @Autowired private lateinit var inventory: InventoryService

    @Test
    fun `checkout last-unit replay succeeds, fresh stale request fails, conflict rejected, and recovery lookup works`() {
        val customerA = login("+919811122201")
        val customerB = login("+919811122202")
        val outlet = createOutlet()
        val listingId = createProduct(outlet)

        // Seed exactly 1 unit of stock (the last available unit)
        inventory.adjust(listingId, 1, StockReason.RECEIPT, "seed-stock-1-unit-${UUID.randomUUID()}")
        assertEquals(1, inventory.available(listingId))

        // Customer A quotes 1 unit
        val quoteAResponse = mockMvc.post("/api/v1/customer/quotes/pickup") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","lines":[{"listingId":"$listingId","quantity":1}],"paymentMethod":"PAY_ON_FULFILMENT"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.customerId") { value(customerA.accountId.toString()) }
        }.andReturn()
        val quoteAJson = objectMapper.readTree(quoteAResponse.response.contentAsString)
        val quoteAId = quoteAJson.path("id").asString()
        val cartSignatureA = quoteAJson.path("cartSignature").asString()

        // Customer B also quotes 1 unit while stock is still unreserved
        val quoteBResponse = mockMvc.post("/api/v1/customer/quotes/pickup") {
            header("Authorization", "Bearer ${customerB.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","lines":[{"listingId":"$listingId","quantity":1}],"paymentMethod":"PAY_ON_FULFILMENT"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.customerId") { value(customerB.accountId.toString()) }
        }.andReturn()
        val quoteBJson = objectMapper.readTree(quoteBResponse.response.contentAsString)
        val quoteBId = quoteBJson.path("id").asString()
        val cartSignatureB = quoteBJson.path("cartSignature").asString()

        val idempotencyKeyA = "checkout-key-a-100"

        // 1. Customer A completes first checkout -> succeeds, reserves the 1 unit
        val firstCheckout = mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", idempotencyKeyA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteAId","cartSignature":"$cartSignatureA"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("PLACED") }
            jsonPath("$.customerId") { value(customerA.accountId.toString()) }
        }.andReturn()
        val orderAId = objectMapper.readTree(firstCheckout.response.contentAsString).path("id").asString()

        // Available stock is now 0 (the last unit was reserved)
        assertEquals(0, inventory.available(listingId))

        // AC1: 2. Customer A retries identical checkout with same idempotency key
        // Must return the existing committed order and NOT throw QUOTE_STALE
        val replayCheckout = mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", idempotencyKeyA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteAId","cartSignature":"$cartSignatureA"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(orderAId) }
            jsonPath("$.status") { value("PLACED") }
        }.andReturn()
        val replayOrderAId = objectMapper.readTree(replayCheckout.response.contentAsString).path("id").asString()
        assertEquals(orderAId, replayOrderAId)
        assertEquals(0, inventory.available(listingId))

        // AC2: 3. Customer B attempts checkout with a NEW key for quoteB -> must fail with QUOTE_STALE
        mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customerB.accessToken}")
            header("Idempotency-Key", "checkout-key-b-200")
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteBId","cartSignature":"$cartSignatureB"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("QUOTE_STALE") }
        }

        // AC3: 4. Reusing Customer A's key with conflicting quoteId must be rejected with 409 Conflict
        mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", idempotencyKeyA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"${UUID.randomUUID()}","cartSignature":"$cartSignatureA"}"""
        }.andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("IDEMPOTENCY_FINGERPRINT_MISMATCH") }
        }

        // Reusing Customer A's key with modified cartSignature must also fail closed with 409 Conflict
        mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", idempotencyKeyA)
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteAId","cartSignature":"tampered-signature"}"""
        }.andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("IDEMPOTENCY_FINGERPRINT_MISMATCH") }
        }

        // AC5: 5. Customer B cannot recover Customer A's order using Customer A's idempotency key
        mockMvc.get("/api/v1/customer/orders/by-key?idempotencyKey=$idempotencyKeyA") {
            header("Authorization", "Bearer ${customerB.accessToken}")
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("ORDER_NOT_FOUND") }
        }

        // Recovery Lookup Contract: Customer A recovers order by key
        mockMvc.get("/api/v1/customer/orders/by-key?idempotencyKey=$idempotencyKeyA") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(orderAId) }
            jsonPath("$.status") { value("PLACED") }
        }

        // Recovery Lookup Contract: Non-existent key returns 404
        mockMvc.get("/api/v1/customer/orders/by-key?idempotencyKey=non-existent-key") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("ORDER_NOT_FOUND") }
        }

        // Recovery Lookup Contract: Invalid key format returns 400
        mockMvc.get("/api/v1/customer/orders/by-key?idempotencyKey=invalid key with spaces!") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("IDEMPOTENCY_KEY_INVALID") }
        }
    }

    private data class CustomerLogin(val accountId: UUID, val accessToken: String)

    private fun login(mobile: String): CustomerLogin {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"checkout-replay-test"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        val body = objectMapper.readTree(verified.response.contentAsString)
        return CustomerLogin(
            accountId = UUID.fromString(body.path("accountId").asString()),
            accessToken = body.path("accessToken").asString(),
        )
    }

    private fun createOutlet(): ProviderOutlet {
        val submitted = providers.submitOutlet(
            merchant = Principal(UUID.randomUUID(), Role.MERCHANT),
            name = "Checkout Replay Store ${UUID.randomUUID()}",
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            servicePinCodes = setOf("517501"),
            idempotencyKey = "submit-${UUID.randomUUID()}",
        )
        return providers.approveOutlet(
            Principal(
                actorId = UUID.randomUUID(),
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW),
            ),
            submitted.id,
            "approve-${UUID.randomUUID()}",
        )
    }

    private fun createProduct(outlet: ProviderOutlet): UUID = catalog.createListing(
        CreateListingCommand(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            barcodeType = BarcodeType.INTERNAL,
            barcode = "R1-${UUID.randomUUID().toString().take(8).uppercase()}",
            name = "R1 Dog Food",
            kind = ListingKind.PRODUCT,
            mrpPaise = 10_000,
            sellingPricePaise = 8_500,
            capabilities = outlet.capabilities,
            category = "food",
        ),
        "listing-${UUID.randomUUID()}",
    ).id
}
