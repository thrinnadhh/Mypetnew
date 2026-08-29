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

    private fun key(request: OfflineCatalogDraftRequest): String =
        "catalog-create:${request.tempListingId.removePrefix("local_")}"

    private fun payload(request: OfflineCatalogDraftRequest): Map<String, Any?> = mapOf(
        "tempListingId" to request.tempListingId,
        "outletId" to request.outletId.toString(),
        "barcodeType" to request.barcodeType.name,
        "barcode" to request.barcode,
        "name" to request.name,
        "kind" to request.kind.name,
        "mrpPaise" to request.mrpPaise,
        "sellingPricePaise" to request.sellingPricePaise,
        "category" to request.category,
        "brand" to request.brand,
        "description" to request.description,
        "petType" to request.petType,
        "lifeStage" to request.lifeStage,
        "packLabel" to request.packLabel,
        "sku" to request.sku,
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
            val request = request(outletId, 710 + index)
            ctx.controller.reconcile(
                authentication = auth(actor),
                idempotencyKey = key(request),
                commandType = "CATALOG_CREATE",
                schemaVersion = "1",
                request = request,
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

        val original = request(outletId, 720)
        val first = ctx.controller.reconcile(auth(current), key(original), "CATALOG_CREATE", "1", original)
        assertEquals("CREATED", first.body!!.outcome)

        val changed = request(outletId, 721, name = "Tampered Different Product")
        val conflict = ctx.controller.reconcile(auth(current), key(changed), "CATALOG_CREATE", "1", changed)
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
    fun `M7-DRAFT-001 lost response resolves historical create receipt and rejects changed payload or temp identity`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000074")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val current = ctx.resolver.reauthorize(stalePrincipal(actorId, organizationId, outletId))
        val original = request(outletId, 730)
        val key = key(original)
        val created = ctx.controller.reconcile(auth(current), key, "CATALOG_CREATE", "1", original).body!!
        val originalPayload = payload(original)

        val resolved = ctx.controller.resolve(
            authentication = auth(current),
            commandType = "CATALOG_CREATE",
            schemaVersion = "1",
            request = ResolveReceiptRequest(key, "CATALOG_CREATE", 1, originalPayload),
        )
        assertEquals(created.canonicalListingId, resolved.canonicalListingId)
        assertEquals("CREATED", resolved.outcome)

        val tampered = originalPayload.toMutableMap().apply { put("sellingPricePaise", 1L) }
        val payloadError = assertThrows(DomainException::class.java) {
            ctx.controller.resolve(
                authentication = auth(current),
                commandType = "CATALOG_CREATE",
                schemaVersion = "1",
                request = ResolveReceiptRequest(key, "CATALOG_CREATE", 1, tampered),
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", payloadError.code)

        val otherTemp = originalPayload.toMutableMap().apply {
            put("tempListingId", "local_00000000-0000-4000-8000-000000000731")
        }
        val identityError = assertThrows(DomainException::class.java) {
            ctx.controller.resolve(
                authentication = auth(current),
                commandType = "CATALOG_CREATE",
                schemaVersion = "1",
                request = ResolveReceiptRequest(key, "CATALOG_CREATE", 1, otherTemp),
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", identityError.code)
    }

    @Test
    fun `M7-DRAFT-001 malformed receipt payload fails closed as validation error`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000076")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val current = ctx.resolver.reauthorize(stalePrincipal(actorId, organizationId, outletId))
        val original = request(outletId, 750)
        val malformed = payload(original).toMutableMap().apply { put("outletId", "not-a-uuid") }

        val error = assertThrows(DomainException::class.java) {
            ctx.controller.resolve(
                authentication = auth(current),
                commandType = "CATALOG_CREATE",
                schemaVersion = "1",
                request = ResolveReceiptRequest(key(original), "CATALOG_CREATE", 1, malformed),
            )
        }
        assertEquals("VALIDATION_ERROR", error.code)
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
        val replay = request(outletId, 740)

        assertThrows(DomainException::class.java) {
            ctx.controller.reconcile(auth(current), key(replay), "CATALOG_CREATE", "1", replay)
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
