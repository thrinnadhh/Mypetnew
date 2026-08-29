package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M7OfflineBarcodeDraftPostgresContractTest {
    private data class Context(val jdbc: JdbcTemplate, val catalog: CatalogService)

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        return Context(jdbc, CatalogService(JdbcCatalogPersistence(jdbc, transactions)))
    }

    private fun seedScope(jdbc: JdbcTemplate, mobile: String): Triple<UUID, UUID, UUID> {
        val actorId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')", actorId, mobile)
        jdbc.update("INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M7 Org', 'ACTIVE', ?)", organizationId, actorId)
        jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M7 Outlet', 'ACTIVE', TRUE)", outletId, organizationId)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'MEDICINE_CATALOG_VIEW_ONLY', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", actorId, organizationId, outletId)
        return Triple(actorId, organizationId, outletId)
    }

    private fun command(
        organizationId: UUID,
        outletId: UUID,
        name: String = "M7 Product",
        kind: ListingKind = ListingKind.PRODUCT,
    ) = CreateListingCommand(
        organizationId = organizationId,
        outletId = outletId,
        barcodeType = BarcodeType.GTIN_13,
        barcode = "4006381333931",
        name = name,
        kind = kind,
        mrpPaise = 12000,
        sellingPricePaise = 11000,
        category = if (kind == ListingKind.MEDICINE) "medicine" else "food",
        capabilities = if (kind == ListingKind.MEDICINE) {
            setOf(ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY)
        } else {
            setOf(ProviderCapability.PRODUCT_STORE)
        },
    )

    @Test
    fun `M7 duplicate race converges identical draft to canonical listing and rejects divergent duplicate`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedScope(ctx.jdbc, "+919410000001")

        val canonical = ctx.catalog.createListing(command(organizationId, outletId), "device-b-create", actorId)
        val converged = ctx.catalog.createListing(command(organizationId, outletId), "device-a-offline-draft", actorId)
        assertEquals(canonical.id, converged.id)
        assertEquals(1, ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.catalog_listing WHERE organization_id = ? AND outlet_id = ? AND normalized_barcode = ?",
            Int::class.java,
            organizationId,
            outletId,
            "4006381333931",
        ))

        val conflict = assertThrows(DomainException::class.java) {
            ctx.catalog.createListing(command(organizationId, outletId, name = "Different merchant work"), "device-a-divergent", actorId)
        }
        assertEquals("CATALOG_DUPLICATE", conflict.code)
    }

    @Test
    fun `M7 create idempotency remains partition scoped and preserves canonical identity for receipt recovery`() {
        val ctx = context()
        val (actorA, orgA, outletA) = seedScope(ctx.jdbc, "+919410000002")
        val (actorB, orgB, outletB) = seedScope(ctx.jdbc, "+919410000003")

        val listingA = ctx.catalog.createListing(command(orgA, outletA), "m7-stable-create", actorA)
        val listingB = ctx.catalog.createListing(command(orgB, outletB), "m7-stable-create", actorB)
        assertNotEquals(listingA.id, listingB.id)

        val rowA = ctx.jdbc.queryForMap(
            "SELECT id, organization_id, outlet_id, create_idempotency_key, create_request_fingerprint FROM mypet.catalog_listing WHERE id = ?",
            listingA.id,
        )
        assertEquals(orgA, rowA["organization_id"])
        assertEquals(outletA, rowA["outlet_id"])
        assertEquals("m7-stable-create", rowA["create_idempotency_key"])
        assertTrue((rowA["create_request_fingerprint"] as String).matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun `M7 medicine drafts canonicalize as view only and barcode leading zero semantics stay server authoritative`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedScope(ctx.jdbc, "+919410000004")

        val medicine = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_12,
                barcode = "012345678905",
                name = "M7 Medicine",
                kind = ListingKind.MEDICINE,
                mrpPaise = 5000,
                sellingPricePaise = 4500,
                category = "medicine",
                capabilities = setOf(ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY),
            ),
            "m7-medicine-create",
            actorId,
        )

        assertEquals("012345678905", medicine.normalizedBarcode)
        assertEquals(CommerceMode.VIEW_ONLY, medicine.commerceMode)
    }

    @Test
    fun `M7 invalid GTIN is rejected before persistence`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedScope(ctx.jdbc, "+919410000005")
        val invalid = command(organizationId, outletId).copy(barcode = "4006381333932")
        val error = assertThrows(DomainException::class.java) {
            ctx.catalog.createListing(invalid, "m7-invalid-gtin", actorId)
        }
        assertEquals("BARCODE_INVALID", error.code)
        assertEquals(0, ctx.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_listing WHERE outlet_id = ?", Int::class.java, outletId))
    }
}
