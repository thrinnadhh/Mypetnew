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
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
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

    @Test
    fun `category slug validation enforces lowercase alphanumeric slug and rejects blank`() {
        val service = CatalogService()
        val base = productCommand(UUID.randomUUID(), UUID.randomUUID())

        val valid = service.createListing(base.copy(category = "  DOG-FOOD-1  "), "cat-1")
        assertEquals("dog-food-1", valid.category)

        listOf("", "   ", "Invalid Category", "food!", "-dog", "cat$").forEach { badCat ->
            assertThrows(DomainException::class.java) {
                service.createListing(base.copy(category = badCat), "cat-bad")
            }
        }
    }

    @Test
    fun `string metadata fields are trimmed and enforce length limits`() {
        val service = CatalogService()
        val base = productCommand(UUID.randomUUID(), UUID.randomUUID())

        val created = service.createListing(
            base.copy(
                brand = "  Royal Canin  ",
                description = "  Premium dry food  ",
                petType = "  DOG  ",
                lifeStage = "  ADULT  ",
                packLabel = "  3 kg  ",
                sku = "  RC-MAXI-3KG  ",
            ),
            "meta-1",
        )
        assertEquals("Royal Canin", created.brand)
        assertEquals("Premium dry food", created.description)
        assertEquals("DOG", created.petType)
        assertEquals("ADULT", created.lifeStage)
        assertEquals("3 kg", created.packLabel)
        assertEquals("RC-MAXI-3KG", created.sku)

        assertThrows(DomainException::class.java) { service.createListing(base.copy(brand = "a".repeat(101)), "m-b") }
        assertThrows(DomainException::class.java) { service.createListing(base.copy(description = "a".repeat(2001)), "m-d") }
        assertThrows(DomainException::class.java) { service.createListing(base.copy(petType = "a".repeat(41)), "m-p") }
        assertThrows(DomainException::class.java) { service.createListing(base.copy(lifeStage = "a".repeat(41)), "m-l") }
        assertThrows(DomainException::class.java) { service.createListing(base.copy(packLabel = "a".repeat(81)), "m-pk") }
        assertThrows(DomainException::class.java) { service.createListing(base.copy(sku = "a".repeat(81)), "m-s") }
    }

    @Test
    fun `image URLs enforce structural HTTPS validation, limit of 5, uniqueness and length`() {
        val service = CatalogService()
        val base = productCommand(UUID.randomUUID(), UUID.randomUUID())

        val validImages = listOf("https://example.com/img1.jpg", "https://example.com/img2.jpg")
        val created = service.createListing(base.copy(imageUrls = validImages), "img-1")
        assertEquals(validImages, created.imageUrls)

        // Non-HTTPS, malformed, or user-info URLs fail closed
        listOf(
            "http://example.com/img.jpg",
            "file:///tmp/img.png",
            "data:image/png;base64,12345",
            "javascript:alert(1)",
            "https://",
            "https:///image.jpg",
            "https://?x=1",
            "https://user:password@example.com/image.jpg",
        ).forEach { badUrl ->
            val ex = assertThrows(DomainException::class.java) {
                service.createListing(base.copy(imageUrls = listOf(badUrl)), "img-bad-scheme")
            }
            assertEquals("LISTING_IMAGE_INVALID", ex.code)
        }

        // More than 5 images fails
        assertThrows(DomainException::class.java) {
            service.createListing(base.copy(imageUrls = (1..6).map { "https://example.com/$it.jpg" }), "img-6")
        }

        // Duplicate image URLs fails
        assertThrows(DomainException::class.java) {
            service.createListing(
                base.copy(imageUrls = listOf("https://example.com/a.jpg", "https://example.com/a.jpg")),
                "img-dup",
            )
        }
    }

    @Test
    fun `changed metadata under same idempotency key produces fingerprint mismatch`() {
        val service = CatalogService()
        val orgId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        val cmd1 = productCommand(orgId, outletId).copy(brand = "Brand A")
        val cmd2 = productCommand(orgId, outletId).copy(brand = "Brand B")

        service.createListing(cmd1, "same-idempotency-key")
        val ex = assertThrows(DomainException::class.java) {
            service.createListing(cmd2, "same-idempotency-key")
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", ex.code)
    }

    @Test
    fun `delimiter collision payloads produce fingerprint mismatch`() {
        val service = CatalogService()
        val orgId = UUID.randomUUID()
        val outletId = UUID.randomUUID()

        val cmdA = productCommand(orgId, outletId).copy(brand = "A:B", description = "C")
        val cmdB = productCommand(orgId, outletId).copy(brand = "A", description = "B:C")

        service.createListing(cmdA, "delim-key-1")
        val ex = assertThrows(DomainException::class.java) {
            service.createListing(cmdB, "delim-key-1")
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", ex.code)
    }

    @Test
    fun `changed image order under same idempotency key produces fingerprint mismatch`() {
        val service = CatalogService()
        val orgId = UUID.randomUUID()
        val outletId = UUID.randomUUID()

        val cmdA = productCommand(orgId, outletId).copy(
            imageUrls = listOf("https://example.com/1.jpg", "https://example.com/2.jpg"),
        )
        val cmdB = productCommand(orgId, outletId).copy(
            imageUrls = listOf("https://example.com/2.jpg", "https://example.com/1.jpg"),
        )

        service.createListing(cmdA, "order-key-1")
        val ex = assertThrows(DomainException::class.java) {
            service.createListing(cmdB, "order-key-1")
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", ex.code)
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
        category = "food",
    )
}
