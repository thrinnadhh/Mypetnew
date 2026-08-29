package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.M7OfflineCatalogDraftController
import `in`.mypetnew.application.web.OfflineCatalogDraftRequest
import `in`.mypetnew.application.web.ResolveReceiptRequest
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.testsupport.ConcurrentScenarioRunner
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M7OfflineCatalogDraftPostgresContractTest {
    private data class Context(
        val jdbc: JdbcTemplate,
        val controller: M7OfflineCatalogDraftController,
        val resolver: JdbcMerchantPrincipalResolver,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val feed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "m7-test-cursor-secret-at-least-32-characters")
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions, feed))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        return Context(
            jdbc = jdbc,
            controller = M7OfflineCatalogDraftController(providers, catalog, jdbc),
            resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource)),
        )
    }

    private fun createMerchant(jdbc: JdbcTemplate, mobile: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')",
            id,
            mobile,
        )
        return id
    }

    private fun seedScope(jdbc: JdbcTemplate, ownerId: UUID): Pair<UUID, UUID> {
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M7 Org', 'ACTIVE', ?)",
            organizationId,
            ownerId,
        )
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M7 Outlet', 'ACTIVE', TRUE)",
            outletId,
            organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)",
            outletId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)",
            ownerId,
            organizationId,
            outletId,
        )
        return organizationId to outletId
    }

    private fun stalePrincipal(actorId: UUID, organizationId: UUID, outletId: UUID) = Principal(
        actorId = actorId,
        role = Role.MERCHANT,
        organizationId = organizationId,
        outletIds = setOf(outletId),
        sessionId = UUID.randomUUID(),
        merchantPermissionsByOutlet = mapOf(outletId to setOf(MerchantPermission.OWNER)),
    )

    private fun auth(principal: Principal) = UsernamePasswordAuthenticationToken(principal, null, emptyList())

    private fun request(outletId: UUID, tempSuffix: Int, name: String = "Offline Dog Food") = OfflineCatalogDraftRequest(
        tempListingId = "local_00000000-0000-4000-8000-${tempSuffix.toString().padStart(12, '0')}",
        outletId = outletId,
        barcodeType = BarcodeType.INTERNAL,
        barcode = "M7-SAME-BARCODE",
        name = name,
        kind = ListingKind.PRODUCT,
        mrpPaise = 15000,
        sellingPricePaise = 14000,
        category = "food",
        brand = "MyPet",
        description = "offline capture",
        petType = "DOG",
        packLabel = "1 kg",
        sku = "M7-SKU",
    )

    @Test
    fun `M7-DRAFT-001 two concurrent devices with same exact barcode converge to one canonical listing`() {
        val ctx = context()
        val actorA = createMerchant(ctx.jdbc, "+919330000071")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorA)
        val actorB = createMerchant(ctx.jdbc, "+919330000072")
        ctx.jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'CATALOG_WRITE', TRUE)",
            actorB,
            organizationId,
            outletId,
        )

        val principalA = ctx.resolver.reauthorize(stalePrincipal(actorA, organizationId, outletId))
        val principalB = ctx.resolver.reauthorize(stalePrincipal(actorB, organizationId, outletId))
        val results = ConcurrentScenarioRunner.run(2) { index ->
            val actor = if (index == 0) principalA else principalB
            ctx.controller.reconcile(
                authentication = auth(actor),
                idempotencyKey = "m7-device-$index",
                commandType = "CATALOG_CREATE",
                schemaVersion = "1",
                request = request(outletId, 710 + index),
            ).body!!
        }

        assertEquals(2, results.size)
        assertEquals(1, results.count { it.outcome == "CREATED" })
        assertEquals(1, results.count { it.outcome == "EXISTING_LISTING" })
        assertEquals(1, results.map { it.canonicalListingId }.distinct().size)
        assertNotEquals(results[0].tempListingId, results[1].tempListingId)
        assertEquals(
            1L,
            ctx.jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.catalog_listing WHERE organization_id = ? AND outlet_id = ? AND normalized_barcode = ?",
                Long::class.java,
                organizationId,
                outletId,
                "M7-SAME-BARCODE",
            ),
        )
    }

    @Test
    fun `M7-DRAFT-001 material metadata mismatch returns explicit conflict and does not create a duplicate`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000073")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val current = ctx.resolver.reauthorize(stalePrincipal(actorId, organizationId, outletId))

        val first = ctx.controller.reconcile(
            auth(current),
            "m7-conflict-create",
            "CATALOG_CREATE",
            "1",
            request(outletId, 720),
        )
        assertEquals("CREATED", first.body!!.outcome)

        val conflict = ctx.controller.reconcile(
            auth(current),
            "m7-conflict-second",
            "CATALOG_CREATE",
            "1",
            request(outletId, 721, name = "Tampered Different Product"),
        )
        assertEquals(409, conflict.statusCode.value())
        assertEquals("CONFLICT", conflict.body!!.outcome)
        assertEquals(first.body!!.canonicalListingId, conflict.body!!.canonicalListingId)
        assertEquals(
            1L,
            ctx.jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.catalog_listing WHERE organization_id = ? AND outlet_id = ? AND normalized_barcode = ?",
                Long::class.java,
                organizationId,
                outletId,
                "M7-SAME-BARCODE",
            ),
        )
    }

    @Test
    fun `M7-DRAFT-001 lost response resolves historical create receipt and rejects changed payload`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000074")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val current = ctx.resolver.reauthorize(stalePrincipal(actorId, organizationId, outletId))
        val original = request(outletId, 730)
        val key = "m7-lost-create"
        val created = ctx.controller.reconcile(auth(current), key, "CATALOG_CREATE", "1", original).body!!

        val payload = mapOf<String, Any?>(
            "tempListingId" to original.tempListingId,
            "outletId" to outletId.toString(),
            "barcodeType" to original.barcodeType.name,
            "barcode" to original.barcode,
            "name" to original.name,
            "kind" to original.kind.name,
            "mrpPaise" to original.mrpPaise,
            "sellingPricePaise" to original.sellingPricePaise,
            "category" to original.category,
            "brand" to original.brand,
            "description" to original.description,
            "petType" to original.petType,
            "lifeStage" to original.lifeStage,
            "packLabel" to original.packLabel,
            "sku" to original.sku,
        )
        val resolved = ctx.controller.resolve(
            authentication = auth(current),
            commandType = "CATALOG_CREATE",
            schemaVersion = "1",
            request = ResolveReceiptRequest(key, "CATALOG_CREATE", 1, payload),
        )
        assertEquals(created.canonicalListingId, resolved.canonicalListingId)
        assertEquals("CREATED", resolved.outcome)

        val tampered = payload.toMutableMap().apply { put("sellingPricePaise", 1L) }
        val error = assertThrows(DomainException::class.java) {
            ctx.controller.resolve(
                authentication = auth(current),
                commandType = "CATALOG_CREATE",
                schemaVersion = "1",
                request = ResolveReceiptRequest(key, "CATALOG_CREATE", 1, tampered),
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", error.code)
    }

    @Test
    fun `M7-DRAFT-001 current permission revocation prevents replay and creates no catalog effects`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000075")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val stale = stalePrincipal(actorId, organizationId, outletId)
        ctx.jdbc.update(
            "UPDATE mypet.merchant_staff SET permission = 'INVENTORY_WRITE' WHERE account_id = ? AND outlet_id = ?",
            actorId,
            outletId,
        )
        val current = ctx.resolver.reauthorize(stale)
        assertTrue(MerchantPermission.CATALOG_WRITE !in current.merchantPermissionsByOutlet[outletId].orEmpty())

        assertThrows(DomainException::class.java) {
            ctx.controller.reconcile(
                auth(current),
                "m7-revoked-create",
                "CATALOG_CREATE",
                "1",
                request(outletId, 740),
            )
        }
        assertEquals(
            0L,
            ctx.jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.catalog_listing WHERE organization_id = ? AND outlet_id = ?",
                Long::class.java,
                organizationId,
                outletId,
            ),
        )
        assertEquals(
            0L,
            ctx.jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.catalog_listing_history WHERE organization_id = ? AND outlet_id = ?",
                Long::class.java,
                organizationId,
                outletId,
            ),
        )
    }
}
