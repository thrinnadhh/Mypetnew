package `in`.mypetnew.api

import `in`.mypetnew.application.MyPetNewApplication
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@SpringBootTest(
    classes = [MyPetNewApplication::class],
    properties = [
        "mypet.security.token-secret=test-only-secret-that-is-longer-than-32-bytes",
        "mypet.security.token-issuer=mypetnew-test-favourites",
        "mypet.security.token-audience=mypetnew-test-clients",
        "spring.datasource.url=jdbc:h2:mem:favourites-api;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerFavouriteApiTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var otpProvider: OtpProvider
    @Autowired private lateinit var providers: ProviderService
    @Autowired private lateinit var catalog: CatalogService

    @Test
    fun `customer favourites are authenticated paginated idempotent and owner scoped`() {
        val listingId = createActiveListing()
        val tokenA = login("+919811111111")
        val tokenB = login("+919822222222")

        mockMvc.get("/api/v1/customer/favourites")
            .andExpect { status { isUnauthorized() } }

        mockMvc.put("/api/v1/customer/favourites/$listingId") {
            header("Authorization", "Bearer $tokenA")
        }.andExpect {
            status { isOk() }
            jsonPath("$.listingId") { value(listingId.toString()) }
            jsonPath("$.createdAt") { isNotEmpty() }
        }

        mockMvc.put("/api/v1/customer/favourites/$listingId") {
            header("Authorization", "Bearer $tokenA")
        }.andExpect {
            status { isOk() }
            jsonPath("$.listingId") { value(listingId.toString()) }
        }

        mockMvc.get("/api/v1/customer/favourites?page=0&pageSize=20") {
            header("Authorization", "Bearer $tokenA")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].listingId") { value(listingId.toString()) }
            jsonPath("$.hasNext") { value(false) }
        }

        mockMvc.get("/api/v1/customer/favourites") {
            header("Authorization", "Bearer $tokenB")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(0) }
        }

        mockMvc.delete("/api/v1/customer/favourites/$listingId") {
            header("Authorization", "Bearer $tokenB")
        }.andExpect { status { isNoContent() } }

        mockMvc.get("/api/v1/customer/favourites") {
            header("Authorization", "Bearer $tokenA")
        }.andExpect { jsonPath("$.items.length()") { value(1) } }

        mockMvc.delete("/api/v1/customer/favourites/$listingId") {
            header("Authorization", "Bearer $tokenA")
        }.andExpect { status { isNoContent() } }
        mockMvc.delete("/api/v1/customer/favourites/$listingId") {
            header("Authorization", "Bearer $tokenA")
        }.andExpect { status { isNoContent() } }
    }

    @Test
    fun `favourites reject invalid paging and unknown listing`() {
        val token = login("+919833333333")
        mockMvc.get("/api/v1/customer/favourites?page=0&pageSize=101") {
            header("Authorization", "Bearer $token")
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PAGE_SIZE_INVALID") }
        }

        mockMvc.put("/api/v1/customer/favourites/${UUID.randomUUID()}") {
            header("Authorization", "Bearer $token")
        }.andExpect {
            status { isNotFound() }
            jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }
        }
    }

    private fun login(mobile: String): String {
        val request = mockMvc.post("/api/v1/auth/otp/request") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"mobile":"$mobile","purpose":"LOGIN","deviceId":"p3-favourite-test"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val challengeId = objectMapper.readTree(request.response.contentAsString).path("challengeId").asString()
        val code = (otpProvider as InMemoryOtpProvider).codeFor(UUID.fromString(challengeId))
        val verified = mockMvc.post("/api/v1/auth/otp/verify") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"challengeId":"$challengeId","mobile":"$mobile","purpose":"LOGIN","code":"$code","adultEligibilityAttested":true}"""
        }.andExpect { status { isOk() } }.andReturn()
        return objectMapper.readTree(verified.response.contentAsString).path("accessToken").asString()
    }

    private fun createActiveListing(): UUID {
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            merchant,
            "P3 Favourite Store ${UUID.randomUUID()}",
            setOf(ProviderCapability.PRODUCT_STORE),
            setOf("517501"),
            "p3-submit-${UUID.randomUUID()}",
        )
        val outlet = providers.approveOutlet(
            Principal(
                actorId = UUID.randomUUID(),
                role = Role.ADMIN,
                permissions = setOf(AdminPermission.PROVIDER_REVIEW),
            ),
            submitted.id,
            "p3-approve-${UUID.randomUUID()}",
        )
        return catalog.createListing(
            CreateListingCommand(
                organizationId = outlet.organizationId,
                outletId = outlet.id,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "FAV-${UUID.randomUUID().toString().take(8).uppercase()}",
                name = "Favourite Test Product",
                kind = ListingKind.PRODUCT,
                mrpPaise = 12000,
                sellingPricePaise = 10000,
                capabilities = outlet.capabilities,
                category = "food",
            ),
            "p3-listing-${UUID.randomUUID()}",
        ).id
    }
}
