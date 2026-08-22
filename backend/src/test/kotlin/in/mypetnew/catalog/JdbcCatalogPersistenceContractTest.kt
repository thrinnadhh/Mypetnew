package `in`.mypetnew.catalog

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

class JdbcCatalogPersistenceContractTest {
    private lateinit var jdbc: JdbcTemplate
    private lateinit var persistence: JdbcCatalogPersistence
    private lateinit var catalogService: CatalogService

    @BeforeEach
    fun setUp() {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        jdbc = JdbcTemplate(dataSource)
        val transactionManager = DataSourceTransactionManager(dataSource)
        val transactionTemplate = TransactionTemplate(transactionManager)
        persistence = JdbcCatalogPersistence(jdbc, transactionTemplate)
        catalogService = CatalogService(persistence)
    }

    @Test
    fun `JDBC persistence round-trips complete listing metadata and ordered images`() {
        val orgId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        seedOrganizationAndOutlet(orgId, outletId)

        val images = listOf(
            "https://cdn.example.com/pet/front.jpg",
            "https://cdn.example.com/pet/back.jpg",
            "https://cdn.example.com/pet/ingredients.jpg",
        )

        val command = CreateListingCommand(
            organizationId = orgId,
            outletId = outletId,
            barcodeType = BarcodeType.GTIN_13,
            barcode = "4006381333931",
            name = "Royal Canin Maxi Adult",
            kind = ListingKind.PRODUCT,
            mrpPaise = 249900,
            sellingPricePaise = 219900,
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            category = "food",
            brand = "Royal Canin",
            description = "Complete feed for adult large breed dogs",
            petType = "DOG",
            lifeStage = "ADULT",
            packLabel = "15 kg",
            sku = "RC-MAXI-15KG",
            imageUrls = images,
        )

        val created = catalogService.createListing(command, "key-1")

        assertEquals("food", created.category)
        assertEquals("Royal Canin", created.brand)
        assertEquals("Complete feed for adult large breed dogs", created.description)
        assertEquals("DOG", created.petType)
        assertEquals("ADULT", created.lifeStage)
        assertEquals("15 kg", created.packLabel)
        assertEquals("RC-MAXI-15KG", created.sku)
        assertEquals(images, created.imageUrls)
        assertNotNull(created.createdAt)

        val retrieved = catalogService.getListing(created.id)
        assertEquals(created.id, retrieved.id)
        assertEquals("food", retrieved.category)
        assertEquals("Royal Canin", retrieved.brand)
        assertEquals("Complete feed for adult large breed dogs", retrieved.description)
        assertEquals("DOG", retrieved.petType)
        assertEquals("ADULT", retrieved.lifeStage)
        assertEquals("15 kg", retrieved.packLabel)
        assertEquals("RC-MAXI-15KG", retrieved.sku)
        assertEquals(images, retrieved.imageUrls)
        assertEquals(created.createdAt, retrieved.createdAt)

        val all = catalogService.allListings()
        assertEquals(1, all.size)
        assertEquals(images, all[0].imageUrls)
    }

    @Test
    fun `idempotency replay round-trips original listing and fingerprint mismatch throws exception`() {
        val orgId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        seedOrganizationAndOutlet(orgId, outletId)

        val command1 = CreateListingCommand(
            organizationId = orgId,
            outletId = outletId,
            barcodeType = BarcodeType.GTIN_13,
            barcode = "4006381333931",
            name = "Royal Canin Maxi Adult",
            kind = ListingKind.PRODUCT,
            mrpPaise = 249900,
            sellingPricePaise = 219900,
            capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            category = "food",
            brand = "Royal Canin",
        )

        val first = catalogService.createListing(command1, "key-idempotent")
        val replayed = catalogService.createListing(command1, "key-idempotent")
        assertEquals(first.id, replayed.id)
        assertEquals(first.brand, replayed.brand)

        val command2 = command1.copy(brand = "Different Brand")
        assertThrows(DomainException::class.java) {
            catalogService.createListing(command2, "key-idempotent")
        }
    }

    private fun seedOrganizationAndOutlet(organizationId: UUID, outletId: UUID) {
        jdbc.update(
            "INSERT INTO mypet.merchant_organization (id, name, status) VALUES (?, 'Org 1', 'ACTIVE')",
            organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.provider_outlet (id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'Outlet 1', 'ACTIVE', TRUE)",
            outletId,
            organizationId,
        )
    }
}
