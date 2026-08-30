package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.PaginationHelper
import `in`.mypetnew.catalog.domain.PublicCatalogReadQuery
import `in`.mypetnew.catalog.domain.PublicOutletReadQuery
import `in`.mypetnew.catalog.infrastructure.JdbcPublicCatalogReadRepository
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

@MerchantOpsPostgres
class M10PublicCatalogQueryPostgresContractTest {
    private val dataSource = PostgresTestDatabase.dataSource()
    private val jdbc = JdbcTemplate(dataSource)
    private val fixture = MerchantScenarioFixture(dataSource)
    private val reads = JdbcPublicCatalogReadRepository(jdbc)

    @BeforeEach
    fun resetDatabase() {
        PostgresTestDatabase.resetAndMigrate()
    }

    @Test
    fun `M10 public catalog is bounded deterministic and server paginated on representative data`() {
        val scenario = fixture.create()
        enableProductStore(scenario.outletId, "517501")
        seedCatalog(scenario.organizationId, scenario.outletId, 1_200)

        val first = reads.search(PublicCatalogReadQuery(page = 0, pageSize = 50, sort = "NAME", pincode = "517501"))
        val second = reads.search(PublicCatalogReadQuery(page = 1, pageSize = 50, sort = "NAME", pincode = "517501"))

        assertEquals(50, first.items.size)
        assertTrue(first.hasNext)
        assertEquals(50, second.items.size)
        assertTrue(first.items.zipWithNext().all { (left, right) ->
            compareValuesBy(left, right, { it.name.lowercase() }, { it.id.toString() }) <= 0
        })
        assertTrue(first.items.map { it.id }.toSet().intersect(second.items.map { it.id }.toSet()).isEmpty())
        assertTrue(first.items.last().name.lowercase() <= second.items.first().name.lowercase())

        val outletPage = reads.searchOutlets(PublicOutletReadQuery(0, 20, ProviderCapability.PRODUCT_STORE, "517501", "m0"))
        assertEquals(listOf(scenario.outletId), outletPage.items.map { it.id })
        assertFalse(outletPage.hasNext)
    }

    @Test
    fun `M10 public pagination rejects abusive page sizes and deep offsets`() {
        assertThrows(DomainException::class.java) { PaginationHelper.validate(-1, 20) }
        assertThrows(DomainException::class.java) { PaginationHelper.validate(0, 51) }
        assertThrows(DomainException::class.java) { PaginationHelper.validate(2_001, 50) }
        PaginationHelper.validate(2_000, 50)
    }

    @Test
    fun `M10 canonical detail reflects metadata price stock media deactivation and serviceability changes`() {
        val scenario = fixture.create()
        enableProductStore(scenario.outletId, "517501")
        jdbc.update(
            "UPDATE mypet.inventory_balance SET on_hand = 4, reserved = 1, version = version + 1 WHERE listing_id = ?",
            scenario.listingId,
        )
        jdbc.update(
            "INSERT INTO mypet.catalog_listing_image(listing_id, position, image_url) VALUES (?, 0, 'https://cdn.example.test/old.jpg')",
            scenario.listingId,
        )

        val before = requireNotNull(reads.detail(scenario.listingId, "517501"))
        assertEquals(9_000, before.sellingPricePaise)
        assertEquals(3, before.availableQuantity)
        assertTrue(before.serviceable)

        jdbc.update(
            """
            UPDATE mypet.catalog_listing
            SET name = 'Canonical M10 Name', description = 'Committed metadata', brand = 'M10 Brand',
                selling_price_paise = 8500, version = version + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """.trimIndent(),
            scenario.listingId,
        )
        jdbc.update(
            "UPDATE mypet.catalog_listing_image SET image_url = 'https://cdn.example.test/new.jpg' WHERE listing_id = ? AND position = 0",
            scenario.listingId,
        )
        jdbc.update(
            "UPDATE mypet.inventory_balance SET on_hand = 2, reserved = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE listing_id = ?",
            scenario.listingId,
        )

        val after = requireNotNull(reads.detail(scenario.listingId, "517501"))
        assertEquals("Canonical M10 Name", after.name)
        assertEquals("Committed metadata", after.description)
        assertEquals("M10 Brand", after.brand)
        assertEquals(8_500, after.sellingPricePaise)
        assertEquals(1, after.availableQuantity)
        assertEquals(listOf("https://cdn.example.test/new.jpg"), after.imageUrls)

        jdbc.update("UPDATE mypet.outlet_service_pincode SET active = FALSE WHERE outlet_id = ? AND pincode = '517501'", scenario.outletId)
        assertFalse(requireNotNull(reads.detail(scenario.listingId, "517501")).serviceable)
        jdbc.update("UPDATE mypet.outlet_service_pincode SET active = TRUE WHERE outlet_id = ? AND pincode = '517501'", scenario.outletId)
        jdbc.update("UPDATE mypet.catalog_listing SET active = FALSE, version = version + 1 WHERE id = ?", scenario.listingId)
        assertFalse(requireNotNull(reads.detail(scenario.listingId, "517501")).listingActive)
        assertTrue(reads.search(PublicCatalogReadQuery(0, 20, outletId = scenario.outletId, sort = "NAME", pincode = "517501")).items.none { it.id == scenario.listingId })
        jdbc.update("UPDATE mypet.catalog_listing SET active = TRUE WHERE id = ?", scenario.listingId)
        jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", scenario.outletId)
        assertFalse(requireNotNull(reads.detail(scenario.listingId, "517501")).outletActive)
        assertTrue(reads.search(PublicCatalogReadQuery(0, 20, outletId = scenario.outletId, sort = "NAME", pincode = "517501")).items.isEmpty())
    }

    @Test
    fun `M10 representative catalog plan remains limit bounded without speculative index migration`() {
        val scenario = fixture.create()
        enableProductStore(scenario.outletId, "517501")
        seedCatalog(scenario.organizationId, scenario.outletId, 1_200)

        val plan = jdbc.queryForList(
            """
            EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
            SELECT l.id, l.name, l.selling_price_paise,
                   GREATEST(COALESCE(b.on_hand, 0) - COALESCE(b.reserved, 0), 0)
            FROM mypet.catalog_listing l
            JOIN mypet.provider_outlet o ON o.id = l.outlet_id AND o.organization_id = l.organization_id
            LEFT JOIN mypet.inventory_balance b
              ON b.organization_id = l.organization_id AND b.outlet_id = l.outlet_id AND b.listing_id = l.id
            WHERE l.active = TRUE AND o.status = 'ACTIVE'
              AND EXISTS (
                SELECT 1 FROM mypet.outlet_service_pincode sp
                WHERE sp.outlet_id = o.id AND sp.pincode = '517501' AND sp.active = TRUE
              )
            ORDER BY LOWER(l.name) ASC, l.id ASC
            LIMIT 51 OFFSET 0
            """.trimIndent(),
            String::class.java,
        ).map { requireNotNull(it) { "PostgreSQL EXPLAIN returned a null plan line" } }
        assertTrue(plan.any { it.contains("Limit") }, plan.joinToString("\n"))
        assertTrue(plan.any { it.contains("catalog_listing") }, plan.joinToString("\n"))
        assertTrue(plan.none { it.contains("never executed") }, plan.joinToString("\n"))
    }

    private fun enableProductStore(outletId: UUID, pincode: String) {
        jdbc.update(
            "INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)",
            outletId,
        )
        jdbc.update(
            "INSERT INTO mypet.outlet_service_pincode(outlet_id, pincode, active) VALUES (?, ?, TRUE)",
            outletId,
            pincode,
        )
    }

    private fun seedCatalog(organizationId: UUID, outletId: UUID, count: Int) {
        repeat(count) { index ->
            val id = UUID.randomUUID()
            jdbc.update(
                """
                INSERT INTO mypet.catalog_listing(
                    id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                    listing_kind, commerce_mode, mrp_paise, selling_price_paise, category, active
                ) VALUES (?, ?, ?, 'INTERNAL', ?, ?, 'PRODUCT', 'COMMERCE', 10000, ?, 'food', TRUE)
                """.trimIndent(),
                id,
                organizationId,
                outletId,
                "M10-$index-$id",
                "M10 Product ${index.toString().padStart(4, '0')}",
                8_000L + (index % 100),
            )
        }
    }
}
