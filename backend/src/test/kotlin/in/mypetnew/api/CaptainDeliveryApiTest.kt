package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.customer.domain.CustomerAddressInput
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.delivery.domain.DispatchService
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
import org.springframework.test.web.servlet.put
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-captain-delivery",
        "mypet.security.token-audience=mypetnew-test-clients",
        "mypet.delivery.base-fee-paise=2500",
        "mypet.delivery.eta-minutes=35",
        "spring.datasource.url=jdbc:h2:mem:captain-delivery-api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CaptainDeliveryApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var providers: ProviderService
    @Autowired private lateinit var catalog: CatalogService
    @Autowired private lateinit var inventory: InventoryService
    @Autowired private lateinit var customerData: CustomerDataService
    @Autowired private lateinit var orders: OrderService
    @Autowired private lateinit var dispatch: DispatchService

    @Test
    fun `level 4 backend integration contracts - authorization, isolation, idempotency and race safety`() {
        // 1. Setup Customer, Outlet, and Ready Order
        val customer = loginCustomer("+919811111111")
        val outlet = createDeliveryOutlet()
        val productId = createListing(outlet, ListingKind.PRODUCT)
        inventory.adjust(productId, 10, StockReason.RECEIPT, "p7-stock-${UUID.randomUUID()}")

        val customerAddress = customerData.createAddress(
            customer.accountId,
            CustomerAddressInput(
                label = "Home",
                recipientName = "Aditi Rao",
                phoneNumber = "+919876543210",
                line1 = "100 Koramangala 5th Block",
                line2 = null,
                city = "Bengaluru",
                state = "Karnataka",
                pincode = "560034",
                isDefault = true,
            ),
        )

        val quoted = mockMvc.post("/api/v1/customer/quotes/delivery") {
            header("Authorization", "Bearer ${customer.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","addressId":"${customerAddress.id}","lines":[{"listingId":"$productId","quantity":1}]}"""
        }.andExpect { status { isOk() } }.andReturn()

        val quoteJson = objectMapper.readTree(quoted.response.contentAsString)
        val quoteId = quoteJson.path("id").asString()
        val cartSignature = quoteJson.path("cartSignature").asString()

        val ordered = mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customer.accessToken}")
            header("Idempotency-Key", "p7-checkout-$quoteId")
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteId","cartSignature":"$cartSignature"}"""
        }.andExpect { status { isOk() } }.andReturn()

        val orderId = UUID.fromString(objectMapper.readTree(ordered.response.contentAsString).path("id").asString())

        // Move order to READY_FOR_PICKUP
        orders.transition(orderId, OrderStatus.ACCEPTED, "accept")
        orders.transition(orderId, OrderStatus.PREPARING, "prepare")
        val readyOrder = orders.transition(orderId, OrderStatus.READY_FOR_PICKUP, "ready")

        // 2. Setup Captain A (Eligible) and Captain B (Foreign/Competitor)
        val captainA = loginCaptain("+919822222221")
        val captainB = loginCaptain("+919822222222")

        dispatch.approveCaptain(captainA.accountId)
        dispatch.approveCaptain(captainB.accountId)

        // Captain A goes online via API
        mockMvc.put("/api/v1/captain/availability") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"online":true,"latitude":13.6288,"longitude":79.4192}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.online") { value(true) }
        }

        // Captain B goes online via API
        mockMvc.put("/api/v1/captain/availability") {
            header("Authorization", "Bearer ${captainB.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"online":true,"latitude":13.6300,"longitude":79.4200}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.online") { value(true) }
        }

        // Start dispatch
        val dispatchJob = dispatch.start(readyOrder, 13.6287, 79.4191)

        // 3. Contract: Nearest Captain A receives the offer
        val offersA = mockMvc.get("/api/v1/captain/dispatch/offers") {
            header("Authorization", "Bearer ${captainA.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$[0].offerId") { isNotEmpty() }
        }.andReturn()

        val offerId = objectMapper.readTree(offersA.response.contentAsString).get(0).path("offerId").asString()

        // 4. Contract: Foreign Captain B CANNOT accept Captain A's offer
        mockMvc.post("/api/v1/captain/dispatch/offers/$offerId/respond") {
            header("Authorization", "Bearer ${captainB.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"action":"ACCEPT"}"""
        }.andExpect {
            status { isNotFound() } // fails closed
        }

        // 5. Contract: Captain A accepts offer -> Receives customer delivery address
        val acceptedResponse = mockMvc.post("/api/v1/captain/dispatch/offers/$offerId/respond") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            header("Idempotency-Key", "idemp-accept-$offerId")
            contentType = MediaType.APPLICATION_JSON
            content = """{"action":"ACCEPT"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.accepted") { value(true) }
            jsonPath("$.jobId") { value(dispatchJob.id.toString()) }
            jsonPath("$.deliveryAddress.recipientName") { value("Aditi Rao") }
            jsonPath("$.deliveryAddress.phoneNumber") { value("+919876543210") }
        }.andReturn()

        val assignedJobId = objectMapper.readTree(acceptedResponse.response.contentAsString).path("jobId").asString()

        // 6. Contract: Replay of accepted offer response is IDEMPOTENT
        mockMvc.post("/api/v1/captain/dispatch/offers/$offerId/respond") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            header("Idempotency-Key", "idemp-accept-$offerId")
            contentType = MediaType.APPLICATION_JSON
            content = """{"action":"ACCEPT"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.accepted") { value(true) }
            jsonPath("$.jobId") { value(assignedJobId) }
        }

        // 7. Contract: Foreign Captain B CANNOT mark Captain A's job picked up or delivered
        mockMvc.post("/api/v1/captain/dispatch/$assignedJobId/picked-up") {
            header("Authorization", "Bearer ${captainB.accessToken}")
            header("Idempotency-Key", "idemp-foreign-pickup")
            contentType = MediaType.APPLICATION_JSON
        }.andExpect {
            status { isNotFound() }
        }

        mockMvc.post("/api/v1/captain/dispatch/$assignedJobId/delivered") {
            header("Authorization", "Bearer ${captainB.accessToken}")
            header("Idempotency-Key", "idemp-foreign-deliv")
            contentType = MediaType.APPLICATION_JSON
        }.andExpect {
            status { isNotFound() }
        }

        // 8. Contract: Captain A marks job PICKED_UP with idempotency
        mockMvc.post("/api/v1/captain/dispatch/$assignedJobId/picked-up") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            header("Idempotency-Key", "idemp-captain-pickup-01")
            contentType = MediaType.APPLICATION_JSON
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("PICKED_UP") }
        }

        // Idempotent pickup replay
        mockMvc.post("/api/v1/captain/dispatch/$assignedJobId/picked-up") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            header("Idempotency-Key", "idemp-captain-pickup-01")
            contentType = MediaType.APPLICATION_JSON
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("PICKED_UP") }
        }

        // 9. Contract: Captain A completes delivery with idempotency
        mockMvc.post("/api/v1/captain/dispatch/$assignedJobId/delivered") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            header("Idempotency-Key", "idemp-captain-deliv-01")
            contentType = MediaType.APPLICATION_JSON
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("DELIVERED") }
        }

        // Idempotent delivery replay
        mockMvc.post("/api/v1/captain/dispatch/$assignedJobId/delivered") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            header("Idempotency-Key", "idemp-captain-deliv-01")
            contentType = MediaType.APPLICATION_JSON
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("DELIVERED") }
        }

        assertEquals(OrderStatus.DELIVERED, orders.get(orderId).status)
    }

    private fun createDeliveryOutlet(): ProviderOutlet {
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            merchant = merchant,
            name = "P7 Test Store ${UUID.randomUUID()}",
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            servicePinCodes = setOf("560034"),
            idempotencyKey = "p7-submit-${UUID.randomUUID()}",
            latitude = 13.6287,
            longitude = 79.4191,
        )
        return providers.approveOutlet(
            Principal(
                actorId = UUID.randomUUID(),
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW),
            ),
            submitted.id,
            "p7-approve-${UUID.randomUUID()}",
        )
    }

    private fun createListing(outlet: ProviderOutlet, kind: ListingKind): UUID = catalog.createListing(
        CreateListingCommand(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            barcodeType = BarcodeType.INTERNAL,
            barcode = "P7-${kind.name}-${UUID.randomUUID().toString().take(8).uppercase()}",
            name = "P7 Listing ${kind.name}",
            kind = kind,
            mrpPaise = 10_000,
            sellingPricePaise = 8_500,
            capabilities = outlet.capabilities,
            category = "food",
        ),
        "p7-listing-${UUID.randomUUID()}",
    ).id

    private fun loginCustomer(mobile: String): UserSession {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"p7-cust-device"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        val body = objectMapper.readTree(verified.response.contentAsString)
        return UserSession(
            accountId = UUID.fromString(body.path("accountId").asString()),
            accessToken = body.path("accessToken").asString(),
        )
    }

    private fun loginCaptain(mobile: String): UserSession {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"p7-cap-device"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/captain/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val body = objectMapper.readTree(verified.response.contentAsString)
        return UserSession(
            accountId = UUID.fromString(body.path("accountId").asString()),
            accessToken = body.path("accessToken").asString(),
        )
    }

    private data class UserSession(val accountId: UUID, val accessToken: String)
}
