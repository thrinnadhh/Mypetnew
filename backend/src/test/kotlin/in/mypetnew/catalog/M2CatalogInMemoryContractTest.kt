package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogMutationType
import `in`.mypetnew.catalog.domain.CatalogSearchQuery
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.Listing
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.domain.UpdateListingCommand
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID

class M2CatalogInMemoryContractTest {
    @Test
    fun `versioned in-memory mutations replay history lifecycle and tenant reads stay canonical`() {
        val catalog = CatalogService()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        val actorId = UUID.randomUUID()
        val created = catalog.createListing(
            product(organizationId, outletId, "MEMORY-001", "Alpha Treat"),
            "memory-create",
            actorId,
        )

        val update = update(created, 0, "Beta Treat", 18_500)
        val updated = catalog.updateListing(update, "memory-update", actorId)
        assertEquals(1L, updated.version)
        assertEquals("Beta Treat", updated.name)
        assertEquals(18_500L, updated.sellingPricePaise)
        assertEquals(updated, catalog.updateListing(update, "memory-update", actorId))

        val stale = assertThrows(DomainException::class.java) {
            catalog.updateListing(update.copy(name = "Stale write"), "memory-stale", actorId)
        }
        assertEquals("CATALOG_VERSION_CONFLICT", stale.code)

        val historyAfterUpdate = catalog.listHistory(organizationId, outletId, created.id)
        assertEquals(listOf(0L, 1L), historyAfterUpdate.map { it.listingVersion })
        assertEquals(listOf(CatalogMutationType.CREATE, CatalogMutationType.UPDATE), historyAfterUpdate.map { it.mutationType })
        assertEquals(actorId, historyAfterUpdate.last().actorId)
        assertEquals(19_000L, historyAfterUpdate.last().oldSellingPricePaise)
        assertEquals(18_500L, historyAfterUpdate.last().newSellingPricePaise)

        val found = catalog.searchManagedListings(
            CatalogSearchQuery(organizationId, outletId, query = "BETA", page = 0, pageSize = 10),
        )
        assertEquals(listOf(created.id), found.items.map { it.id })
        assertFalse(found.hasNext)

        val deactivation = CatalogLifecycleCommand(
            organizationId = organizationId,
            outletId = outletId,
            listingId = created.id,
            expectedVersion = 1,
            targetStatus = ListingStatus.INACTIVE,
            capabilities = productCapabilities,
        )
        val inactive = catalog.changeLifecycle(deactivation, "memory-deactivate", actorId)
        assertEquals(2L, inactive.version)
        assertEquals(ListingStatus.INACTIVE, inactive.status)
        assertEquals(inactive, catalog.changeLifecycle(deactivation, "memory-deactivate", actorId))
        assertEquals("RESOURCE_NOT_FOUND", assertThrows(DomainException::class.java) { catalog.getListing(created.id) }.code)
        assertTrue(catalog.allListings().isEmpty())
        assertEquals(
            listOf(created.id),
            catalog.searchManagedListings(
                CatalogSearchQuery(organizationId, outletId, status = ListingStatus.INACTIVE),
            ).items.map { it.id },
        )

        val active = catalog.changeLifecycle(
            deactivation.copy(expectedVersion = 2, targetStatus = ListingStatus.ACTIVE),
            "memory-activate",
            actorId,
        )
        assertEquals(3L, active.version)
        assertEquals(ListingStatus.ACTIVE, active.status)
        assertEquals(active, catalog.getListing(created.id))
        assertEquals(listOf(created.id), catalog.allListings().map { it.id })
        assertEquals(
            listOf(
                CatalogMutationType.CREATE,
                CatalogMutationType.UPDATE,
                CatalogMutationType.DEACTIVATE,
                CatalogMutationType.ACTIVATE,
            ),
            catalog.listHistory(organizationId, outletId, created.id).map { it.mutationType },
        )

        val sameState = assertThrows(DomainException::class.java) {
            catalog.changeLifecycle(
                deactivation.copy(expectedVersion = 3, targetStatus = ListingStatus.ACTIVE),
                "memory-active-again",
                actorId,
            )
        }
        assertEquals("CATALOG_STATE_INVALID", sameState.code)
        assertEquals(
            "RESOURCE_NOT_FOUND",
            assertThrows(DomainException::class.java) {
                catalog.getManagedListing(UUID.randomUUID(), outletId, created.id)
            }.code,
        )
        assertTrue(catalog.listHistory(UUID.randomUUID(), outletId, created.id).isEmpty())
    }

    @Test
    fun `in-memory search pagination validation and duplicate semantics are bounded and deterministic`() {
        val catalog = CatalogService()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        val actorId = UUID.randomUUID()
        val first = catalog.createListing(product(organizationId, outletId, "MEMORY-101", "Alpha Food"), "memory-101", actorId)
        val second = catalog.createListing(product(organizationId, outletId, "MEMORY-102", "Beta Food"), "memory-102", actorId)
        catalog.createListing(product(organizationId, outletId, "MEMORY-103", "Gamma Toy").copy(brand = "FoodBrand"), "memory-103", actorId)

        val page0 = catalog.searchManagedListings(CatalogSearchQuery(organizationId, outletId, query = "food", page = 0, pageSize = 1))
        val page1 = catalog.searchManagedListings(CatalogSearchQuery(organizationId, outletId, query = "food", page = 1, pageSize = 1))
        assertEquals(1, page0.items.size)
        assertEquals(1, page1.items.size)
        assertTrue(page0.hasNext)
        assertTrue(page0.items.single().id != page1.items.single().id)
        assertTrue(setOf(first.id, second.id).contains(page0.items.single().id) || page0.items.single().name == "Gamma Toy")

        val terminal = catalog.searchManagedListings(
            CatalogSearchQuery(organizationId, outletId, page = Int.MAX_VALUE, pageSize = 100),
        )
        assertTrue(terminal.items.isEmpty())
        assertFalse(terminal.hasNext)
        assertEquals(100, terminal.pageSize)
        assertTrue(catalog.searchManagedListings(CatalogSearchQuery(UUID.randomUUID(), outletId)).items.isEmpty())

        val duplicate = assertThrows(DomainException::class.java) {
            catalog.createListing(
                product(organizationId, outletId, "MEMORY-101", "Changed identity payload"),
                "memory-duplicate",
                actorId,
            )
        }
        assertEquals("CATALOG_DUPLICATE", duplicate.code)
        assertEquals(
            "IDEMPOTENCY_FINGERPRINT_MISMATCH",
            assertThrows(DomainException::class.java) {
                catalog.createListing(
                    product(organizationId, outletId, "MEMORY-101", "Changed replay payload"),
                    "memory-101",
                    actorId,
                )
            }.code,
        )

        assertEquals(
            "CATALOG_VERSION_INVALID",
            assertThrows(DomainException::class.java) {
                catalog.updateListing(update(first, -1, "Nope", 18_000), "memory-negative-version", actorId)
            }.code,
        )
        assertEquals(
            "CATALOG_VERSION_INVALID",
            assertThrows(DomainException::class.java) {
                catalog.changeLifecycle(
                    CatalogLifecycleCommand(organizationId, outletId, first.id, -1, ListingStatus.INACTIVE, productCapabilities),
                    "memory-negative-lifecycle",
                    actorId,
                )
            }.code,
        )
        assertEquals(
            "CAPABILITY_REQUIRED",
            assertThrows(DomainException::class.java) {
                catalog.createListing(
                    product(organizationId, UUID.randomUUID(), "MEMORY-NOCAP", "No capability").copy(capabilities = emptySet()),
                    "memory-no-capability",
                    actorId,
                )
            }.code,
        )
        assertEquals(
            "IDEMPOTENCY_KEY_INVALID",
            assertThrows(DomainException::class.java) {
                catalog.createListing(product(organizationId, UUID.randomUUID(), "MEMORY-BADKEY", "Bad key"), "bad key", actorId)
            }.code,
        )
        assertEquals(
            "LISTING_IMAGE_INVALID",
            assertThrows(DomainException::class.java) {
                catalog.createListing(
                    product(organizationId, UUID.randomUUID(), "MEMORY-IMAGE", "Bad image").copy(
                        imageUrls = listOf("https://example.com/${"x".repeat(2050)}"),
                    ),
                    "memory-image",
                    actorId,
                )
            }.code,
        )
    }

    private fun product(organizationId: UUID, outletId: UUID, barcode: String, name: String) = CreateListingCommand(
        organizationId = organizationId,
        outletId = outletId,
        barcodeType = BarcodeType.INTERNAL,
        barcode = barcode,
        name = name,
        kind = ListingKind.PRODUCT,
        mrpPaise = 20_000,
        sellingPricePaise = 19_000,
        capabilities = productCapabilities,
        category = "food",
    )

    private fun update(listing: Listing, expectedVersion: Long, name: String, sellingPricePaise: Long) = UpdateListingCommand(
        organizationId = listing.organizationId,
        outletId = listing.outletId,
        listingId = listing.id,
        expectedVersion = expectedVersion,
        name = name,
        mrpPaise = listing.mrpPaise,
        sellingPricePaise = sellingPricePaise,
        category = listing.category,
        brand = listing.brand,
        description = listing.description,
        petType = listing.petType,
        lifeStage = listing.lifeStage,
        packLabel = listing.packLabel,
        sku = listing.sku,
        capabilities = productCapabilities,
    )

    companion object {
        private val productCapabilities = setOf(ProviderCapability.PRODUCT_STORE)
    }
}
