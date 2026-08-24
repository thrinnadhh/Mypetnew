package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.BarcodeResolutionLookup
import `in`.mypetnew.catalog.domain.BarcodeResolutionService
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.infrastructure.InMemoryBarcodeResolutionLookup
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.util.UUID

class M4BarcodeResolutionContractTest {
    private val organizationId = UUID.randomUUID()
    private val outletId = UUID.randomUUID()
    private val catalog = CatalogService()

    @Test
    fun `resolution preserves leading zeroes and returns only the scoped listing`() {
        val listing = createGtin13Listing("m4-create")
        val lookup = FakeLookup(listing.id, organizationId, outletId, BarcodeType.GTIN_13, "0123456789012")
        val result = BarcodeResolutionService(catalog, lookup).resolve(
            organizationId,
            outletId,
            BarcodeType.GTIN_13,
            "0 123456 789012",
        )

        assertEquals("0123456789012", result.normalizedBarcode)
        assertEquals(listing.id, result.listing?.id)
    }

    @Test
    fun `unknown barcode is represented without fabricating a listing`() {
        val result = BarcodeResolutionService(catalog, EmptyLookup).resolve(
            organizationId,
            outletId,
            BarcodeType.GTIN_8,
            "01234565",
        )
        assertEquals("01234565", result.normalizedBarcode)
        assertNull(result.listing)
    }

    @Test
    fun `invalid check digit fails before lookup`() {
        var lookedUp = false
        val lookup = BarcodeResolutionLookup { _, _, _, _ ->
            lookedUp = true
            null
        }
        val error = assertThrows(DomainException::class.java) {
            BarcodeResolutionService(catalog, lookup).resolve(
                organizationId,
                outletId,
                BarcodeType.GTIN_13,
                "0123456789013",
            )
        }
        assertEquals("BARCODE_INVALID", error.code)
        assertEquals(false, lookedUp)
    }

    @Test
    fun `development lookup still finds an inactive listing to prevent false unused state`() {
        val listing = createGtin13Listing("m4-inactive-create")
        catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = organizationId,
                outletId = outletId,
                listingId = listing.id,
                expectedVersion = listing.version,
                targetStatus = ListingStatus.INACTIVE,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            actionKey = "m4-inactive-disable",
        )

        val resolved = InMemoryBarcodeResolutionLookup(catalog).findListingId(
            organizationId,
            outletId,
            BarcodeType.GTIN_13,
            "0123456789012",
        )
        assertNotNull(resolved)
        assertEquals(listing.id, resolved)
    }

    private fun createGtin13Listing(actionKey: String) = catalog.createListing(
        CreateListingCommand(
            organizationId = organizationId,
            outletId = outletId,
            barcodeType = BarcodeType.GTIN_13,
            barcode = "0 123456 789012",
            name = "Dog Food",
            kind = ListingKind.PRODUCT,
            mrpPaise = 20_000,
            sellingPricePaise = 19_000,
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            category = "food",
        ),
        actionKey = actionKey,
    )

    private class FakeLookup(
        private val listingId: UUID,
        private val organizationId: UUID,
        private val outletId: UUID,
        private val type: BarcodeType,
        private val normalizedBarcode: String,
    ) : BarcodeResolutionLookup {
        override fun findListingId(
            organizationId: UUID,
            outletId: UUID,
            barcodeType: BarcodeType,
            normalizedBarcode: String,
        ): UUID? = listingId.takeIf {
            organizationId == this.organizationId &&
                outletId == this.outletId &&
                barcodeType == type &&
                normalizedBarcode == this.normalizedBarcode
        }
    }

    private object EmptyLookup : BarcodeResolutionLookup {
        override fun findListingId(
            organizationId: UUID,
            outletId: UUID,
            barcodeType: BarcodeType,
            normalizedBarcode: String,
        ): UUID? = null
    }
}
