package `in`.mypetnew.customer

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerFavouriteService
import `in`.mypetnew.customer.domain.InMemoryCustomerFavouritePersistence
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID

class CustomerFavouriteServiceTest {
    @Test
    fun `add is idempotent and favourites remain customer isolated`() {
        val fixture = fixture()
        val customerA = UUID.randomUUID()
        val customerB = UUID.randomUUID()

        val first = fixture.service.add(customerA, fixture.listingId)
        val replay = fixture.service.add(customerA, fixture.listingId)

        assertEquals(first, replay)
        assertEquals(listOf(fixture.listingId), fixture.service.list(customerA, 0, 20).items.map { it.listingId })
        assertTrue(fixture.service.list(customerB, 0, 20).items.isEmpty())

        fixture.service.remove(customerB, fixture.listingId)
        assertEquals(1, fixture.service.list(customerA, 0, 20).items.size)

        fixture.service.remove(customerA, fixture.listingId)
        fixture.service.remove(customerA, fixture.listingId)
        assertTrue(fixture.service.list(customerA, 0, 20).items.isEmpty())
    }

    @Test
    fun `pagination is bounded and account erasure removes favourites`() {
        val fixture = fixture()
        val customer = UUID.randomUUID()
        fixture.service.add(customer, fixture.listingId)

        val page = fixture.service.list(customer, 0, 1)
        assertEquals(1, page.items.size)
        assertFalse(page.hasNext)

        assertThrows(DomainException::class.java) { fixture.service.list(customer, -1, 20) }
        assertThrows(DomainException::class.java) { fixture.service.list(customer, 0, 101) }

        fixture.service.eraseAll(customer)
        assertTrue(fixture.service.list(customer, 0, 20).items.isEmpty())
    }

    @Test
    fun `unknown listing cannot be favourited`() {
        val fixture = fixture()
        val error = assertThrows(DomainException::class.java) {
            fixture.service.add(UUID.randomUUID(), UUID.randomUUID())
        }
        assertEquals("RESOURCE_NOT_FOUND", error.code)
    }

    private fun fixture(): Fixture {
        val providers = ProviderService()
        val merchant = Principal(UUID.randomUUID(), Role.MERCHANT)
        val submitted = providers.submitOutlet(
            merchant = merchant,
            name = "Pet Store",
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            servicePinCodes = setOf("517501"),
            idempotencyKey = "submit-store",
        )
        val admin = Principal(
            actorId = UUID.randomUUID(),
            role = Role.ADMIN,
            permissions = setOf(AdminPermission.PROVIDER_REVIEW),
        )
        val outlet = providers.approveOutlet(admin, submitted.id, "approve-store")
        val catalog = CatalogService()
        val listing = catalog.createListing(
            CreateListingCommand(
                organizationId = outlet.organizationId,
                outletId = outlet.id,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "DOGFOOD-1",
                name = "Dog Food",
                kind = ListingKind.PRODUCT,
                mrpPaise = 10000,
                sellingPricePaise = 9000,
                capabilities = outlet.capabilities,
                category = "food",
            ),
            actionKey = "create-dog-food",
        )
        return Fixture(
            service = CustomerFavouriteService(InMemoryCustomerFavouritePersistence(), catalog, providers),
            listingId = listing.id,
        )
    }

    private data class Fixture(
        val service: CustomerFavouriteService,
        val listingId: UUID,
    )
}
