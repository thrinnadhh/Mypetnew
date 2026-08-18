package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.PaymentMethods
import `in`.mypetnew.commerce.domain.QuoteService
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
        "mypet.security.token-issuer=mypetnew-p8-order-detail-test",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem=p8orderdetail;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerOrderDetailSecurityApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var providers: ProviderService
    @Autowired private lateinit var inventory: InventoryService
    @Autowired private lateinit var quotes: QuoteService
    @Autowired private lateinit var orders: OrderService

    @Test
    fun `detail is customer safe immutable owner scoped and cancellation replay safe`() {
        val customerA = login("+919855555551")
        val customerB = login("+919855555552")
        val outlet = createOutlet()
        val listingId = UUID.randomUUID()
        inventory.adjust(listingId, 5, StockReason.RECEIPT, "p8-detail-stock-${UUID.randomUUID()}")
        val quote = quotes.createPickupQuote(
            customerA.accountId,
            outlet.id,
            mapOf(listingId to Pair(2, 12_345L)),
            PaymentMethods.PAY_ON_FULFILMENT,
        )
        val order = orders.checkout(
            quote,
            outlet.organizationId,
            mapOf(listingId to "Order-time dog food name"),
            "p8-detail-checkout-${UUID.randomUUID()}",
            customerA.accountId,
            "p8-detail-test",
        )

        mockMvc.get("/api/v1/customer/orders/${order.id}") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.orderId") { value(order.id.toString()) }
            jsonPath("$.organizationId") { doesNotExist() }
            jsonPath("$.outlet.id") { value(outlet.id.toString()) }
            jsonPath("$.outlet.name") { value(outlet.name) }
            jsonPath("$.items[0].listingId") { value(listingId.toString()) }
            jsonPath("$.items[0].name") { value("Order-time dog food name") }
            jsonPath("$.items[0].quantity") { value(2) }
            jsonPath("$.items[0].unitPricePaise") { value(12_345) }
            jsonPath("$.items[0].lineTotalPaise") { value(24_690) }
            jsonPath("$.pricing.itemSubtotalPaise") { value(quote.pricing.itemSubtotalPaise) }
            jsonPath("$.pricing.platformFeePaise") { value(quote.pricing.platformFeePaise) }
            jsonPath("$.pricing.deliveryFeePaise") { value(quote.pricing.deliveryFeePaise) }
            jsonPath("$.pricing.grandTotalPaise") { value(quote.pricing.grandTotalPaise) }
            jsonPath("$.paymentMethod") { value("PAY_ON_FULFILMENT") }
            jsonPath("$.paymentStatus") { value("PENDING_EXTERNAL_COLLECTION") }
            jsonPath("$.fulfilmentMode") { value("STORE_PICKUP") }
            jsonPath("$.status") { value("PLACED") }
            jsonPath("$.statusHistory[0].toStatus") { value("PLACED") }
            jsonPath("$.canCancel") { value(true) }
            jsonPath("$.cancellation.cancelled") { value(false) }
        }

        mockMvc.get("/api/v1/customer/orders/${order.id}") {
            header("Authorization", "Bearer ${customerB.accessToken}")
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }

        mockMvc.post("/api/v1/customer/orders/${order.id}/cancel") {
            header("Authorization", "Bearer ${customerB.accessToken}")
            header("Idempotency-Key", "p8-foreign-cancel")
            contentType = MediaType.APPLICATION_JSON
            content = """{"reason":"Not my order"}"""
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }

        repeat(2) {
            mockMvc.post("/api/v1/customer/orders/${order.id}/cancel") {
                header("Authorization", "Bearer ${customerA.accessToken}")
                header("Idempotency-Key", "p8-cancel-replay")
                contentType = MediaType.APPLICATION_JSON
                content = """{"reason":"Changed my mind"}"""
            }.andExpect {
                status { isOk() }
                jsonPath("$.status") { value("CANCELLED") }
                jsonPath("$.canCancel") { value(false) }
                jsonPath("$.cancellation.cancelled") { value(true) }
                jsonPath("$.cancellation.reason") { value("Changed my mind") }
                jsonPath("$.statusHistory.length()") { value(2) }
            }
        }

        mockMvc.get("/api/v1/customer/orders?category=ACTIVE&page=0&pageSize=20") {
            header("Authorization", "Bearer ${customerB.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(0) }
        }
    }

    private fun createOutlet(): ProviderOutlet {
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            merchant = merchant,
            name = "P8 Store ${UUID.randomUUID()}",
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            servicePinCodes = setOf("517501"),
            idempotencyKey = "p8-submit-${UUID.randomUUID()}",
        )
        return providers.approveOutlet(
            Principal(
                actorId = UUID.randomUUID(),
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW),
            ),
            submitted.id,
            "p8-approve-${UUID.randomUUID()}",
        )
    }

    private fun login(mobile: String): CustomerLogin {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"p8-order-detail-test"}"""
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
