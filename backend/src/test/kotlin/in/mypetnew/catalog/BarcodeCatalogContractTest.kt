package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.BarcodeNormalizer
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.api.Test
import java.util.UUID

class BarcodeCatalogContractTest {
    @ParameterizedTest
    @CsvSource(
        "GTIN_8,96385074,96385074",
        "GTIN_12,036000291452,036000291452",
        "GTIN_13,4006381333931,4006381333931",
        "GTIN_14,10012345000017,10012345000017",
        "GTIN_13,'400-6381 333931',4006381333931",
    )
    fun `valid GTIN values normalize with leading digits preserved`(type: BarcodeType, raw: String, expected: String) {
        assertEquals(expected, BarcodeNormalizer.normalize(type, raw))
    }

    @Test
    fun `invalid, scientific, control, and wrong-length barcodes fail closed`() {
        listOf("4006381333932", "4.006381333931E12", "4006381\u0000333931", "123").forEach { raw ->
            assertThrows(DomainException::class.java) { BarcodeNormalizer.normalize(BarcodeType.GTIN_13, raw) }
        }
    }

    @Test
    fun `same barcode is unique per outlet but independent across outlets`() {
        val service = CatalogService()
        val orgA = UUID.randomUUID()
        val outletA = UUID.randomUUID()
        val orgB = UUID.randomUUID()
        val outletB = UUID.randomUUID()
        val commandA = productCommand(orgA, outletA)

        val first = service.createListing(commandA, "action-a")
        val duplicate = service.createListing(commandA, "action-b")
        val otherMerchant = service.createListing(productCommand(orgB, outletB), "action-c")

        assertEquals(first.id, duplicate.id)
        assertNotEquals(first.id, otherMerchant.id)
    }

    @Test
    fun `medicine requires capability and is always view only`() {
        val service = CatalogService()
        val base = productCommand(UUID.randomUUID(), UUID.randomUUID()).copy(kind = ListingKind.MEDICINE)

        assertThrows(DomainException::class.java) { service.createListing(base, "medicine-a") }
        val listing = service.createListing(
            base.copy(capabilities = setOf(ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY)),
            "medicine-b",
        )

        assertEquals(CommerceMode.VIEW_ONLY, listing.commerceMode)
    }

    private fun productCommand(organizationId: UUID, outletId: UUID) = CreateListingCommand(
        organizationId = organizationId,
        outletId = outletId,
        barcodeType = BarcodeType.GTIN_13,
        barcode = "4006381333931",
        name = "Dog Food",
        kind = ListingKind.PRODUCT,
        mrpPaise = 15_000,
        sellingPricePaise = 12_500,
        capabilities = setOf(ProviderCapability.PRODUCT_STORE),
    )
}

