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
import `in`.mypetnew.delivery.domain.OnboardingStatus
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
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
        "mypet.security.token-issuer=mypetnew-test-captain-proofs",
        "mypet.security.token-audience=mypetnew-test-clients",
        "mypet.delivery.base-fee-paise=2500",
        "mypet.delivery.eta-minutes=35",
        "spring.datasource.url=jdbc:h2:mem:captain-proofs-api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CaptainProofAndContractsTest {
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
    fun `captain profile endpoint enforces authorization and returns sanitized state`() {
        val captainMobile = "+91987" + (1000000..9999999).random()
        val customerMobile = "+91987" + (1000000..9999999).random()
        val captain = loginCaptain(captainMobile)
        val customer = loginCustomer(customerMobile)

        // 401 when unauthenticated
        mockMvc.get("/api/v1/captain/me").andExpect {
            status { isUnauthorized() }
        }

        // 403 when authenticated as Customer
        mockMvc.get("/api/v1/captain/me") {
            header("Authorization", "Bearer ${customer.accessToken}")
        }.andExpect {
            status { isForbidden() }
        }

        // 200 when authenticated as Captain
        mockMvc.get("/api/v1/captain/me") {
            header("Authorization", "Bearer ${captain.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.captainId") { value(captain.accountId.toString()) }
            jsonPath("$.mobile") { value(captainMobile) }
            jsonPath("$.status") { isNotEmpty() }
            jsonPath("$.approved") { value(false) }
            jsonPath("$.online") { value(false) }
            jsonPath("$.busy") { value(false) }
        }
    }

    @Test
    fun `onboarding draft, save, validation, submit, and immutability contracts`() {
        val captain = loginCaptain("+91987" + (1000000..9999999).random())

        // Initial draft fetch
        mockMvc.get("/api/v1/captain/onboarding/draft") {
            header("Authorization", "Bearer ${captain.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("DRAFT") }
            jsonPath("$.stepCompleted") { value(1) }
        }

        // Save partial draft
        mockMvc.put("/api/v1/captain/onboarding/draft") {
            header("Authorization", "Bearer ${captain.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """
            {
                "personal": {
                    "fullName": "Vikram Singh",
                    "dob": "1994-05-12",
                    "city": "Tirupati",
                    "pincode": "517501"
                },
                "stepCompleted": 2
            }
            """.trimIndent()
        }.andExpect {
            status { isOk() }
            jsonPath("$.personal.fullName") { value("Vikram Singh") }
            jsonPath("$.personal.city") { value("Tirupati") }
            jsonPath("$.stepCompleted") { value(2) }
        }

        // Incomplete submit fails
        mockMvc.post("/api/v1/captain/onboarding/submit") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "submit-attempt-1")
        }.andExpect {
            status { isBadRequest() }
        }

        // Complete all sections
        mockMvc.put("/api/v1/captain/onboarding/draft") {
            header("Authorization", "Bearer ${captain.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """
            {
                "personal": {
                    "fullName": "Vikram Singh",
                    "dob": "1994-05-12",
                    "emergencyContact": "+919800000000",
                    "address": "42 Market Street",
                    "city": "Tirupati",
                    "pincode": "517501"
                },
                "identity": {
                    "identityType": "AADHAAR",
                    "identityNumber": "999988887777",
                    "drivingLicenseNumber": "AP0320210001234",
                    "licenseExpiry": "2032-12-31",
                    "licenseUploaded": true
                },
                "vehicle": {
                    "vehicleType": "BIKE",
                    "registrationNumber": "AP03BW1234",
                    "model": "Hero Splendor",
                    "colour": "Black",
                    "rcUploaded": true
                },
                "bank": {
                    "accountHolder": "Vikram Singh",
                    "accountNumber": "123456789012",
                    "ifsc": "SBIN0001234",
                    "bankName": "State Bank of India"
                },
                "consent": {
                    "captainAgreementAccepted": true,
                    "privacyPolicyAccepted": true,
                    "locationUsageAccepted": true,
                    "safetyPolicyAccepted": true,
                    "settlementTermsAccepted": true
                },
                "stepCompleted": 5
            }
            """.trimIndent()
        }.andExpect {
            status { isOk() }
        }

        // Submit application
        mockMvc.post("/api/v1/captain/onboarding/submit") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "submit-attempt-2")
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("SUBMITTED") }
            jsonPath("$.success") { value(true) }
        }

        // Re-submitting is idempotent
        mockMvc.post("/api/v1/captain/onboarding/submit") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "submit-attempt-2")
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("SUBMITTED") }
        }

        // Modifying submitted application fails
        mockMvc.put("/api/v1/captain/onboarding/draft") {
            header("Authorization", "Bearer ${captain.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"personal":{"fullName":"New Name"}}"""
        }.andExpect {
            status { isConflict() }
        }
    }

    @Test
    fun `support ticket creation verifies foreign job authorization and inputs`() {
        val captainA = loginCaptain("+91987" + (1000000..9999999).random())
        val captainB = loginCaptain("+91987" + (1000000..9999999).random())

        // Valid ticket without job
        mockMvc.post("/api/v1/captain/support/tickets") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """
            {
                "category": "PAYMENT",
                "subject": "Payout delayed",
                "description": "I did not receive my daily payout for yesterday."
            }
            """.trimIndent()
        }.andExpect {
            status { isOk() }
            jsonPath("$.ticketId") { isNotEmpty() }
            jsonPath("$.status") { value("OPEN") }
        }

        // Invalid subject fails
        mockMvc.post("/api/v1/captain/support/tickets") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"category":"PAYMENT","subject":"Hi","description":"Too short subject"}"""
        }.andExpect {
            status { isBadRequest() }
        }

        // Attaching foreign job fails
        val randomJobId = UUID.randomUUID()
        mockMvc.post("/api/v1/captain/support/tickets") {
            header("Authorization", "Bearer ${captainA.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """
            {
                "category": "DELIVERY",
                "subject": "Customer address wrong",
                "description": "Customer address does not exist on map.",
                "jobId": "$randomJobId"
            }
            """.trimIndent()
        }.andExpect {
            status { isNotFound() }
        }
    }

    @Test
    fun `pickup and delivery proof authority, wrong PIN rejection, and idempotency fingerprint mismatch`() {
        val customer = loginCustomer("+91987" + (1000000..9999999).random())
        val outlet = createDeliveryOutlet()
        val productId = createListing(outlet, ListingKind.PRODUCT)
        inventory.adjust(productId, 10, StockReason.RECEIPT, "seed-${UUID.randomUUID()}")

        val customerAddress = customerData.createAddress(
            customer.accountId,
            CustomerAddressInput(
                label = "Home",
                recipientName = "Test Recipient",
                phoneNumber = "+919876543210",
                line1 = "123 Main Rd",
                line2 = null,
                city = "Tirupati",
                state = "Andhra Pradesh",
                pincode = "517501",
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
            header("Idempotency-Key", "checkout-$quoteId")
            contentType = MediaType.APPLICATION_JSON
            content = """{"quoteId":"$quoteId","cartSignature":"$cartSignature"}"""
        }.andExpect { status { isOk() } }.andReturn()

        val orderId = UUID.fromString(objectMapper.readTree(ordered.response.contentAsString).path("id").asString())

        orders.transition(orderId, OrderStatus.ACCEPTED, "accept")
        orders.transition(orderId, OrderStatus.PREPARING, "prepare")
        val readyOrder = orders.transition(orderId, OrderStatus.READY_FOR_PICKUP, "ready")

        val captain = loginCaptain("+91987" + (1000000..9999999).random())
        dispatch.approveCaptain(captain.accountId)
        mockMvc.put("/api/v1/captain/availability") {
            header("Authorization", "Bearer ${captain.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"online":true,"latitude":13.6288,"longitude":79.4192}"""
        }.andExpect { status { isOk() } }

        val job = dispatch.start(readyOrder, 13.6287, 79.4191)
        val offer = dispatch.pendingOffers(captain.accountId).single()

        mockMvc.post("/api/v1/captain/dispatch/offers/${offer.id}/respond") {
            header("Authorization", "Bearer ${captain.accessToken}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"action":"ACCEPT"}"""
        }.andExpect { status { isOk() } }

        // Active delivery endpoint returns assigned job
        mockMvc.get("/api/v1/captain/dispatch/active") {
            header("Authorization", "Bearer ${captain.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.jobId") { value(job.id.toString()) }
            jsonPath("$.status") { value("ASSIGNED") }
        }

        // 1. Pickup with WRONG pin code fails closed
        mockMvc.post("/api/v1/captain/dispatch/${job.id}/picked-up") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "pickup-key-wrong")
            contentType = MediaType.APPLICATION_JSON
            content = """{"proof":{"type":"PIN","pinCode":"0000"}}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PROOF_INVALID") }
        }

        // 2. Pickup with CORRECT pin succeeds
        mockMvc.post("/api/v1/captain/dispatch/${job.id}/picked-up") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "pickup-key-valid")
            contentType = MediaType.APPLICATION_JSON
            content = """{"proof":{"type":"PIN","pinCode":"${job.pickupPin}"}}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("PICKED_UP") }
        }

        // 3. Idempotent replay with SAME key and SAME payload succeeds
        mockMvc.post("/api/v1/captain/dispatch/${job.id}/picked-up") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "pickup-key-valid")
            contentType = MediaType.APPLICATION_JSON
            content = """{"proof":{"type":"PIN","pinCode":"${job.pickupPin}"}}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("PICKED_UP") }
        }

        // 4. Same key with DIFFERENT payload fails with IDEMPOTENCY_FINGERPRINT_MISMATCH
        mockMvc.post("/api/v1/captain/dispatch/${job.id}/picked-up") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "pickup-key-valid")
            contentType = MediaType.APPLICATION_JSON
            content = """{"proof":{"type":"PIN","pinCode":"9999"}}"""
        }.andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("IDEMPOTENCY_FINGERPRINT_MISMATCH") }
        }

        // 5. Delivery with WRONG pin fails
        mockMvc.post("/api/v1/captain/dispatch/${job.id}/delivered") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "deliv-key-wrong")
            contentType = MediaType.APPLICATION_JSON
            content = """{"proof":{"type":"PIN","pinCode":"1111"}}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PROOF_INVALID") }
        }

        // 6. Delivery with CORRECT pin succeeds
        mockMvc.post("/api/v1/captain/dispatch/${job.id}/delivered") {
            header("Authorization", "Bearer ${captain.accessToken}")
            header("Idempotency-Key", "deliv-key-valid")
            contentType = MediaType.APPLICATION_JSON
            content = """{"proof":{"type":"PIN","pinCode":"${job.deliveryPin}"}}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("DELIVERED") }
        }

        // 7. Active delivery endpoint now returns 204 No Content
        mockMvc.get("/api/v1/captain/dispatch/active") {
            header("Authorization", "Bearer ${captain.accessToken}")
        }.andExpect {
            status { isNoContent() }
        }
    }

    @Test
    fun `captain earnings and delivery history endpoints return integer paise amounts`() {
        val captain = loginCaptain("+91987" + (1000000..9999999).random())

        mockMvc.get("/api/v1/captain/earnings") {
            header("Authorization", "Bearer ${captain.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.todayPaise") { isNumber() }
            jsonPath("$.todayDeliveryCount") { isNumber() }
            jsonPath("$.thisWeekPaise") { isNumber() }
            jsonPath("$.thisMonthPaise") { isNumber() }
            jsonPath("$.recentEarnings") { isArray() }
            jsonPath("$.settlements") { isArray() }
        }

        mockMvc.get("/api/v1/captain/deliveries/history") {
            header("Authorization", "Bearer ${captain.accessToken}")
        }.andExpect {
            status { isOk() }
        }
    }

    @Test
    fun `admin captain approval endpoint approves onboarding and dispatch`() {
        val captain = loginCaptain("+91987" + (1000000..9999999).random())
        val admin = loginAdmin()

        mockMvc.post("/api/v1/admin/captains/${captain.accountId}/approve") {
            header("Authorization", "Bearer ${admin.accessToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.approved") { value(true) }
        }
    }

    @Autowired private lateinit var tokens: `in`.mypetnew.application.security.BearerTokenService

    private fun loginAdmin(): UserSession {
        val adminId = UUID.randomUUID()
        val token = tokens.issue(
            Principal(
                actorId = adminId,
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.CAPTAIN_REVIEW),
            ),
        )
        return UserSession(
            accountId = adminId,
            accessToken = token,
        )
    }

    private fun createDeliveryOutlet(): ProviderOutlet {
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            merchant = merchant,
            name = "P8 Store ${UUID.randomUUID()}",
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            servicePinCodes = setOf("517501"),
            idempotencyKey = "p8-submit-${UUID.randomUUID()}",
            latitude = 13.6287,
            longitude = 79.4191,
        )
        return providers.approveOutlet(
            Principal(actorId = UUID.randomUUID(), role = Role.ADMIN, permissions = setOf(AdminPermission.PROVIDER_REVIEW)),
            submitted.id,
            "p8-approve-${UUID.randomUUID()}",
        )
    }

    private fun createListing(outlet: ProviderOutlet, kind: ListingKind): UUID = catalog.createListing(
        CreateListingCommand(
            organizationId = outlet.organizationId,
            outletId = outlet.id,
            barcodeType = BarcodeType.INTERNAL,
            barcode = "P8-${kind.name}-${UUID.randomUUID().toString().take(8).uppercase()}",
            name = "P8 Listing ${kind.name}",
            kind = kind,
            mrpPaise = 10_000,
            sellingPricePaise = 8_500,
            capabilities = outlet.capabilities,
            category = "food",
        ),
        "p8-listing-${UUID.randomUUID()}",
    ).id

    private fun loginCustomer(mobile: String): UserSession {
        val deviceId = "cust-device-${UUID.randomUUID()}"
        val ip = "10.0.${(1..250).random()}.${(1..250).random()}"
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            with { it.remoteAddr = ip; it }
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"$deviceId"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            with { it.remoteAddr = ip; it }
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
        val deviceId = "cap-device-${UUID.randomUUID()}"
        val ip = "10.0.${(1..250).random()}.${(1..250).random()}"
        val requested = mockMvc.post("/api/v1/auth/otp/request") {
            with { it.remoteAddr = ip; it }
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"$deviceId"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(requested.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/captain/otp/verify") {
            with { it.remoteAddr = ip; it }
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
