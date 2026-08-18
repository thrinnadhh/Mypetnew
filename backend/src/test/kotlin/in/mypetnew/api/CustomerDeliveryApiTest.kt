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
import `in`.mypetnew.customer.domain.CustomerAddressInput
import `in`.mypetnew.customer.domain.CustomerDataService
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
        "mypet.security.token-issuer=mypetnew-test-delivery",
        "mypet.security.token-audience=mypetnew-test-clients",
        "mypet.delivery.base-fee-paise=2500",
        "mypet.delivery.eta-minutes=35",
        "spring.datasource.url=jdbc:h2:mem:delivery-api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerDeliveryApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var providers: ProviderService
    @Autowired private lateinit var catalog: CatalogService
    @Autowired private lateinit var inventory: InventoryService
    @Autowired private lateinit var customerData: CustomerDataService

    @Test
    fun `delivery quote and tracking are customer owned and server authoritative`() {
        val customerA = login("+919844444441")
        val customerB = login("+919844444442")
        val outlet = createDeliveryOutlet()
        val productId = createListing(outlet, ListingKind.PRODUCT)
        inventory.adjust(productId, 5, StockReason.RECEIPT, "p4-api-stock-${UUID.randomUUID()}")

        val addressA = customerData.createAddress(
            customerA.accountId,
            address("517501", "Customer A"),
        )
        val addressB = customerData.createAddress(
            customerB.accountId,
            address("517501", "Customer B"),
        )

        val quoted = mockMvc.post("/api/v1/customer/quotes/delivery") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","addressId":"${addressA.id}","lines":[{"listingId":"$productId","quantity":2}]}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.customerId") { value(customerA.accountId.toString()) }
            jsonPath("$.fulfilmentMode") { value("MYPET_CAPTAIN_DELIVERY") }
            jsonPath("$.paymentMethod") { value("PAY_ON_FULFILMENT") }
            jsonPath("$.pricing.deliveryFeePaise") { value(2500) }
            jsonPath("$.pricing.platformFeePaise") { value(1000) }
            jsonPath("$.etaMinutes") { value(35) }
            jsonPath("$.deliveryAddress.addressId") { value(addressA.id.toString()) }
            jsonPath("$.deliveryAddress.pincode") { value("517501") }
        }.andReturn()

        val quoteJson = objectMapper.readTree(quoted.response.contentAsString)
        val quoteId = quoteJson.path("id").asString()
        val cartSignature = quoteJson.path("cartSignature").asString()
        val ordered = mockMvc.post("/api/v1/customer/orders") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            header("Idempotency-Key", "p4-api-checkout-$quoteId")
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteId","cartSignature":"$cartSignature"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.fulfilmentMode") { value("MYPET_CAPTAIN_DELIVERY") }
            jsonPath("$.status") { value("PLACED") }
        }.andReturn()
        val orderId = objectMapper.readTree(ordered.response.contentAsString).path("id").asString()

        mockMvc.get("/api/v1/customer/orders/$orderId/tracking") {
            header("Authorization", "Bearer ${customerA.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.orderId") { value(orderId) }
            jsonPath("$.fulfilmentMode") { value("MYPET_CAPTAIN_DELIVERY") }
            jsonPath("$.flowStep") { value("placed") }
            jsonPath("$.captain") { doesNotExist() }
            jsonPath("$.lastLocation") { doesNotExist() }
        }

        mockMvc.get("/api/v1/customer/orders/$orderId/tracking") {
            header("Authorization", "Bearer ${customerB.accessToken}")
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }

        mockMvc.post("/api/v1/customer/quotes/delivery") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","addressId":"${addressB.id}","lines":[{"listingId":"$productId","quantity":1}]}"""
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("ADDRESS_NOT_FOUND") }
        }

        customerData.deleteAddress(customerA.accountId, addressA.id)
        mockMvc.post("/api/v1/customer/quotes/delivery") {
            header("Authorization", "Bearer ${customerA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","addressId":"${addressA.id}","lines":[{"listingId":"$productId","quantity":1}]}"""
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("ADDRESS_NOT_FOUND") }
        }
    }

    @Test
    fun `delivery quote rejects nonserviceable addresses and view only medicine`() {
        val customer = login("+919844444443")
        val outlet = createDeliveryOutlet()
        val productId = createListing(outlet, ListingKind.PRODUCT)
        val medicineId = createListing(outlet, ListingKind.MEDICINE)
        inventory.adjust(productId, 2, StockReason.RECEIPT, "p4-api-stock-${UUID.randomUUID()}")
        val unsupportedAddress = customerData.createAddress(
            customer.accountId,
            address("517502", "Unsupported PIN"),
        )
        val supportedAddress = customerData.createAddress(
            customer.accountId,
            address("517501", "Supported PIN"),
        )

        mockMvc.post("/api/v1/customer/quotes/delivery") {
            header("Authorization", "Bearer ${customer.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","addressId":"${unsupportedAddress.id}","lines":[{"listingId":"$productId","quantity":1}]}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("OUTLET_NOT_SERVICEABLE") }
        }

        mockMvc.post("/api/v1/customer/quotes/delivery") {
            header("Authorization", "Bearer ${customer.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"outletId":"${outlet.id}","addressId":"${supportedAddress.id}","lines":[{"listingId":"$medicineId","quantity":1}]}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("LISTING_UNAVAILABLE") }
        }
    }

    private fun createDeliveryOutlet(): ProviderOutlet {
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            merchant = merchant,
            name = "P4 Delivery Store ${UUID.randomUUID()}",
            capabilities = setOf(
                ProviderCapability.PRODUCT_STORE,
                ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY,
            ),
            servicePinCodes = setOf("517501"),
            idempotencyKey = "p4-submit-${UUID.randomUUID()}",
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
            "p4-approve-${UUID.randomUUID()}",
        )
    }

    private fun createListing(outlet: ProviderOutlet, kind: ListingKind): UUID = catalog.createListing(
        CreateListingCommand(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            barcodeType = BarcodeType.INTERNAL,
            barcode = "P4-${kind.name}-${UUID.randomUUID().toString().take(8).uppercase()}",
            name = "P4 ${kind.name}",
            kind = kind,
            mrpPaise = 12_000,
            sellingPricePaise = 10_000,
            capabilities = outlet.capabilities,
            category = if (kind == ListingKind.MEDICINE) "medicine" else "food",
        ),
        "p4-listing-${UUID.randomUUID()}",
    ).id

    private fun address(pincode: String, recipient: String) = CustomerAddressInput(
        label = "Home",
        recipientName = recipient,
        phoneNumber = "+919876543210",
        line1 = "12 Main Road",
        line2 = null,
        city = "Tirupati",
        state = "Andhra Pradesh",
        pincode = pincode,
        isDefault = false,
    )

    private fun login(mobile: String): CustomerLogin {
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"p4-delivery-test"}"""
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
