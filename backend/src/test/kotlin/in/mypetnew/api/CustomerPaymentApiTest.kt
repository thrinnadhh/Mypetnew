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
        "mypet.security.token-issuer=mypetnew-test-payments",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:payment-api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerPaymentApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var providers: ProviderService
    @Autowired private lateinit var catalog: CatalogService
    @Autowired private lateinit var inventory: InventoryService

    @Test
    fun `online payment API is customer owned server priced and idempotent across keys`() {
        val customerA = login("+919844455551")
        val customerB = login("+919844455552")
        val outlet = createOutlet()
        val listingId = createProduct(outlet)
        inventory.adjust(listingId, 5, StockReason.RECEIPT, "p5-api-stock-${UUID.randomUUID()}")

        val quoted = mockMvc.post("/api/v1/customer/quotes/pickup") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","lines":[{"listingId":"$listingId","quantity":2}],"paymentMethod":"ONLINE_PAYMENT"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.customerId") { value(customerA.accountId.toString()) }
            jsonPath("$.paymentMethod") { value("ONLINE_PAYMENT") }
            jsonPath("$.fulfilmentMode") { value("STORE_PICKUP") }
        }.andReturn()
        val quoteJson = objectMapper.readTree(quoted.response.contentAsString)
        val quoteId = quoteJson.path("id").asString()
        val cartSignature = quoteJson.path("cartSignature").asString()

        val ordered = mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", "p5-checkout-$quoteId")
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteId","cartSignature":"$cartSignature"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.paymentMethod") { value("ONLINE_PAYMENT") }
            jsonPath("$.paymentStatus") { value("PENDING_ONLINE_PAYMENT") }
            jsonPath("$.paymentHoldExpiresAt") { exists() }
        }.andReturn()
        val orderJson = objectMapper.readTree(ordered.response.contentAsString)
        val orderId = orderJson.path("id").asString()
        val orderTotal = orderJson.path("grandTotalPaise").asLong()

        val first = initiate(customerA.accessToken, orderId, "payment-key-one")
            .andExpect {
                status { isOk() }
                jsonPath("$.referenceId") { value(orderId) }
                jsonPath("$.provider") { value("CASHFREE") }
                jsonPath("$.status") { value("PENDING") }
                jsonPath("$.amountPaise") { value(orderTotal) }
                jsonPath("$.currency") { value("INR") }
                jsonPath("$.providerOrderId") { value(org.hamcrest.Matchers.startsWith("mp_")) }
                jsonPath("$.paymentSessionId") { exists() }
            }
            .andReturn()
        val paymentId = objectMapper.readTree(first.response.contentAsString).path("paymentId").asString()

        initiate(customerA.accessToken, orderId, "payment-key-one")
            .andExpect { status { isOk() }; jsonPath("$.paymentId") { value(paymentId) } }
        initiate(customerA.accessToken, orderId, "payment-key-two")
            .andExpect { status { isOk() }; jsonPath("$.paymentId") { value(paymentId) } }

        mockMvc.get("/api/v1/customer/payments/$paymentId") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.paymentId") { value(paymentId) }
            jsonPath("$.amountPaise") { value(orderTotal) }
        }

        mockMvc.get("/api/v1/customer/payments/$paymentId") {
            header("Authorization", "Bearer ${customerB.accessToken}")
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }
    }

    @Test
    fun `payment API rejects client authority fields and fails closed when appointment payment backend is unavailable`() {
        val customer = login("+919844455553")
        val foreignIdentity = UUID.randomUUID()
        val arbitraryReference = UUID.randomUUID()

        mockMvc.post("/api/v1/customer/payments") {
            header("Authorization", "Bearer ${customer.accessToken}")
            header("Idempotency-Key", "p5-forbidden-authority")
            contentType = MediaType.APPLICATION_JSON
            content = """{"referenceType":"PRODUCT_ORDER","referenceId":"$arbitraryReference","provider":"CASHFREE","userId":"$foreignIdentity","amountPaise":1,"currency":"INR","status":"CAPTURED"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAYMENT_REQUEST_INVALID") }
        }

        mockMvc.post("/api/v1/customer/payments") {
            header("Authorization", "Bearer ${customer.accessToken}")
            header("Idempotency-Key", "p5-appointment-fail-closed")
            contentType = MediaType.APPLICATION_JSON
            content = """{"referenceType":"APPOINTMENT","referenceId":"$arbitraryReference","provider":"CASHFREE"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAYMENT_PROVIDER_UNAVAILABLE") }
        }
    }

    private fun initiate(accessToken: String, orderId: String, key: String) =
        mockMvc.post("/api/v1/customer/payments") {
            header("Authorization", "Bearer $accessToken")
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = """{"referenceType":"PRODUCT_ORDER","referenceId":"$orderId","provider":"CASHFREE"}"""
        }

    private fun createOutlet(): ProviderOutlet {
        val submitted = providers.submitOutlet(
            merchant = Principal(UUID.randomUUID(), Role.MERCHANT),
            name = "P5 Payment Store ${UUID.randomUUID()}",
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            servicePinCodes = setOf("517501"),
            idempotencyKey = "p5-submit-${UUID.randomUUID()}",
        )
        return providers.approveOutlet(
            Principal(
                actorId = UUID.randomUUID(),
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW),
            ),
            submitted.id,
            "p5-approve-${UUID.randomUUID()}",
        )
    }

    private fun createProduct(outlet: ProviderOutlet): UUID = catalog.createListing(
        CreateListingCommand(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            barcodeType = BarcodeType.INTERNAL,
            barcode = "P5-${UUID.randomUUID().toString().take(8).uppercase()}",
            name = "P5 Dog Food",
            kind = ListingKind.PRODUCT,
            mrpPaise = 12_000,
            sellingPricePaise = 10_000,
            capabilities = outlet.capabilities,
            category = "food",
        ),
        "p5-listing-${UUID.randomUUID()}",
    ).id

    private fun login(mobile: String): CustomerLogin {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"p5-payment-test"}"""
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

    private data class CustomerLogin(val accountId: UUID, val accessToken: String)
}
