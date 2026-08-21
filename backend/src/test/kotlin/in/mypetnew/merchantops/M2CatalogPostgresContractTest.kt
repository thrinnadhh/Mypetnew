package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogMutationType
import `in`.mypetnew.catalog.domain.CatalogSearchQuery
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.ListingStatus
import `in`.mypetnew.catalog.domain.UpdateListingCommand
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.testsupport.MerchantOpsConcurrency
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

@MerchantOpsContract
@MerchantOpsPostgres
class M2CatalogPostgresContractTest {
    @Test
    fun `M2-CAT-001 versions price lifecycle medicine and durable history without hard delete`() {
        val context = context()
        val actorId = createMerchant(context.jdbc, "+919300000001")
        val scope = seedScope(context.jdbc, actorId, "OWNER")

        val created = context.catalog.createListing(
            productCommand(scope.organizationId, scope.outletId, "8901234567894", "Premium Dog Food"),
            "m2-create-1",
            actorId,
        )
        assertEquals(0, created.version)
        assertEquals(ListingStatus.ACTIVE, created.status)
        assertEquals(CommerceMode.COMMERCE, created.commerceMode)

        val updated = context.catalog.updateListing(
            updateCommand(created, expectedVersion = 0, sellingPricePaise = 18_900, name = "Premium Dog Food Plus"),
            "m2-update-1",
            actorId,
        )
        assertEquals(1, updated.version)
        assertEquals(18_900, updated.sellingPricePaise)
        assertEquals("Premium Dog Food Plus", updated.name)

        val deactivated = context.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = scope.organizationId,
                outletId = scope.outletId,
                listingId = created.id,
                expectedVersion = 1,
                targetStatus = ListingStatus.INACTIVE,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "m2-deactivate-1",
            actorId,
        )
        assertEquals(2, deactivated.version)
        assertEquals(ListingStatus.INACTIVE, deactivated.status)
        assertThrows(DomainException::class.java) { context.catalog.getListing(created.id) }
        assertEquals(created.id, context.catalog.getManagedListing(scope.organizationId, scope.outletId, created.id).id)

        val reactivated = context.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                organizationId = scope.organizationId,
                outletId = scope.outletId,
                listingId = created.id,
                expectedVersion = 2,
                targetStatus = ListingStatus.ACTIVE,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "m2-activate-1",
            actorId,
        )
        assertEquals(3, reactivated.version)
        assertEquals(ListingStatus.ACTIVE, reactivated.status)

        val history = context.catalog.listHistory(scope.organizationId, scope.outletId, created.id)
        assertEquals(listOf(0L, 1L, 2L, 3L), history.map { it.listingVersion })
        assertEquals(
            listOf(CatalogMutationType.CREATE, CatalogMutationType.UPDATE, CatalogMutationType.DEACTIVATE, CatalogMutationType.ACTIVATE),
            history.map { it.mutationType },
        )
        assertEquals(actorId, history.single { it.listingVersion == 1L }.actorId)
        assertEquals(19_900, history.single { it.listingVersion == 1L }.oldSellingPricePaise)
        assertEquals(18_900, history.single { it.listingVersion == 1L }.newSellingPricePaise)
        assertEquals(ListingStatus.ACTIVE, history.single { it.listingVersion == 2L }.oldStatus)
        assertEquals(ListingStatus.INACTIVE, history.single { it.listingVersion == 2L }.newStatus)

        assertEquals(
            1,
            context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.catalog_listing WHERE id = ?", Int::class.java, created.id),
        )

        val medicine = context.catalog.createListing(
            CreateListingCommand(
                organizationId = scope.organizationId,
                outletId = scope.outletId,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "4006381333931",
                name = "View only medicine",
                kind = ListingKind.MEDICINE,
                mrpPaise = 12_000,
                sellingPricePaise = 11_000,
                capabilities = setOf(ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY),
                category = "medicine",
            ),
            "m2-medicine-create",
            actorId,
        )
        assertEquals(CommerceMode.VIEW_ONLY, medicine.commerceMode)
        val medicineUpdated = context.catalog.updateListing(
            updateCommand(medicine, 0, 10_500, "View only medicine updated").copy(
                capabilities = setOf(ProviderCapability.MEDICINE_CATALOG_VIEW_ONLY),
            ),
            "m2-medicine-update",
            actorId,
        )
        assertEquals(CommerceMode.VIEW_ONLY, medicineUpdated.commerceMode)
    }

    @Test
    fun `M2-CAT-001 stale write loses atomically and creates no history`() {
        val context = context()
        val actorId = createMerchant(context.jdbc, "+919300000002")
        val scope = seedScope(context.jdbc, actorId, "CATALOG_WRITE")
        val created = context.catalog.createListing(
            productCommand(scope.organizationId, scope.outletId, "8901234567801", "Stale Safe"),
            "m2-stale-create",
            actorId,
        )
        val winner = context.catalog.updateListing(
            updateCommand(created, 0, 18_500, "Winner"),
            "m2-stale-winner",
            actorId,
        )
        val failure = assertThrows(DomainException::class.java) {
            context.catalog.updateListing(
                updateCommand(created, 0, 17_500, "Loser"),
                "m2-stale-loser",
                actorId,
            )
        }
        assertEquals("CATALOG_VERSION_CONFLICT", failure.code)
        assertEquals(winner, context.catalog.getManagedListing(scope.organizationId, scope.outletId, created.id))
        assertEquals(2, context.catalog.listHistory(scope.organizationId, scope.outletId, created.id).size)
    }

    @Test
    fun `M2-CAT-002 idempotency duplicate policy search and pagination are deterministic`() {
        val context = context()
        val actorId = createMerchant(context.jdbc, "+919300000003")
        val scope = seedScope(context.jdbc, actorId, "CATALOG_WRITE")
        val first = context.catalog.createListing(
            productCommand(scope.organizationId, scope.outletId, "8901234567818", "Alpha Food").copy(sku = "SHARED-SKU"),
            "m2-idem-create",
            actorId,
        )
        val replay = context.catalog.createListing(
            productCommand(scope.organizationId, scope.outletId, "8901234567818", "Alpha Food").copy(sku = "SHARED-SKU"),
            "m2-idem-create",
            actorId,
        )
        assertEquals(first, replay)
        assertEquals(1, context.catalog.listHistory(scope.organizationId, scope.outletId, first.id).size)

        val mismatch = assertThrows(DomainException::class.java) {
            context.catalog.createListing(
                productCommand(scope.organizationId, scope.outletId, "8901234567818", "Mutated replay"),
                "m2-idem-create",
                actorId,
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", mismatch.code)

        val duplicate = assertThrows(DomainException::class.java) {
            context.catalog.createListing(
                productCommand(scope.organizationId, scope.outletId, "8901234567818", "Different duplicate"),
                "m2-duplicate-key",
                actorId,
            )
        }
        assertEquals("CATALOG_DUPLICATE", duplicate.code)

        val second = context.catalog.createListing(
            productCommand(scope.organizationId, scope.outletId, "8901234567825", "Beta Food").copy(sku = "SHARED-SKU"),
            "m2-create-beta",
            actorId,
        )
        context.catalog.createListing(
            productCommand(scope.organizationId, scope.outletId, "8901234567832", "Gamma Treat"),
            "m2-create-gamma",
            actorId,
        )
        assertEquals("SHARED-SKU", second.sku)

        val update = context.catalog.updateListing(
            updateCommand(first, 0, 18_250, "Alpha Food Updated"),
            "m2-idem-update",
            actorId,
        )
        val updateReplay = context.catalog.updateListing(
            updateCommand(first, 0, 18_250, "Alpha Food Updated"),
            "m2-idem-update",
            actorId,
        )
        assertEquals(update, updateReplay)
        assertEquals(2, context.catalog.listHistory(scope.organizationId, scope.outletId, first.id).size)
        val updateMismatch = assertThrows(DomainException::class.java) {
            context.catalog.updateListing(
                updateCommand(first, 0, 17_000, "Alpha Food Updated"),
                "m2-idem-update",
                actorId,
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", updateMismatch.code)

        val page0 = context.catalog.searchManagedListings(
            CatalogSearchQuery(scope.organizationId, scope.outletId, query = "food", page = 0, pageSize = 1),
        )
        assertEquals(1, page0.items.size)
        assertTrue(page0.hasNext)
        val page1 = context.catalog.searchManagedListings(
            CatalogSearchQuery(scope.organizationId, scope.outletId, query = "FOOD", page = 1, pageSize = 1),
        )
        assertEquals(1, page1.items.size)
        assertFalse(page0.items.single().id == page1.items.single().id)
        assertEquals(100, context.catalog.searchManagedListings(
            CatalogSearchQuery(scope.organizationId, scope.outletId, page = 0, pageSize = 10_000),
        ).pageSize)
    }

    @Test
    fun `M2-CAT-002 private catalog scope and revoked authority fail closed`() {
        val context = context()
        val merchantA = createMerchant(context.jdbc, "+919300000004")
        val scopeA = seedScope(context.jdbc, merchantA, "CATALOG_WRITE")
        val merchantB = createMerchant(context.jdbc, "+919300000005")
        val scopeB = seedScope(context.jdbc, merchantB, "CATALOG_WRITE")
        val listingB = context.catalog.createListing(
            productCommand(scopeB.organizationId, scopeB.outletId, "8901234567849", "Merchant B Private"),
            "m2-private-b",
            merchantB,
        )

        val resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(context.dataSource))
        val principalA = resolver.resolve(merchantA, UUID.randomUUID())
        assertEquals(scopeA.outletId, principalA.outletIds.single())
        assertThrows(DomainException::class.java) {
            context.catalog.getManagedListing(scopeA.organizationId, scopeA.outletId, listingB.id)
        }.also { assertEquals("RESOURCE_NOT_FOUND", it.code) }
        assertTrue(
            context.catalog.searchManagedListings(CatalogSearchQuery(scopeA.organizationId, scopeA.outletId, query = "Merchant B")).items.isEmpty(),
        )

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ? AND permission = 'CATALOG_WRITE'",
            merchantA,
            scopeA.outletId,
        )
        val revoked = resolver.reauthorize(principalA)
        assertThrows(DomainException::class.java) {
            `in`.mypetnew.common.auth.Authorizer.requireMerchantPermission(revoked, scopeA.outletId, MerchantPermission.CATALOG_WRITE)
        }

        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", scopeB.outletId)
        val principalB = resolver.resolve(merchantB, UUID.randomUUID())
        assertThrows(DomainException::class.java) {
            `in`.mypetnew.provider.domain.ProviderService().requireActiveOutlet(
                principalB,
                scopeB.outletId,
                MerchantPermission.CATALOG_WRITE,
            )
        }
    }

    @Test
    fun `V23 upgrades V22 catalog data without changing prices medicine mode or historical references`() {
        val dataSource = PostgresTestDatabase.dataSource()
        val toV22 = flyway(dataSource, MigrationVersion.fromVersion("22"))
        toV22.clean()
        toV22.migrate()
        val jdbc = JdbcTemplate(dataSource)
        val actor = createMerchant(jdbc, "+919300000006")
        val scope = seedScope(jdbc, actor, "OWNER")
        val listingId = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, raw_barcode_audit,
                name, listing_kind, commerce_mode, mrp_paise, selling_price_paise, active, version,
                category, created_at, updated_at
            ) VALUES (?, ?, ?, 'GTIN_13', '4006381333931', '4006381333931', 'Legacy medicine',
                      'MEDICINE', 'VIEW_ONLY', 12000, 11000, FALSE, 7, 'medicine', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """.trimIndent(),
            listingId,
            scope.organizationId,
            scope.outletId,
        )
        flyway(dataSource).migrate()

        assertEquals(11_000L, jdbc.queryForObject("SELECT selling_price_paise FROM mypet.catalog_listing WHERE id = ?", Long::class.java, listingId))
        assertEquals("VIEW_ONLY", jdbc.queryForObject("SELECT commerce_mode FROM mypet.catalog_listing WHERE id = ?", String::class.java, listingId))
        assertFalse(jdbc.queryForObject("SELECT active FROM mypet.catalog_listing WHERE id = ?", Boolean::class.java, listingId)!!)
        assertEquals(7L, jdbc.queryForObject("SELECT version FROM mypet.catalog_listing WHERE id = ?", Long::class.java, listingId))
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mypet' AND table_name = 'catalog_listing_history'", Int::class.java))
    }

    @Test
    @MerchantOpsConcurrency
    fun `M2 catalog races have one canonical database winner`() {
        val context = context()
        val actorId = createMerchant(context.jdbc, "+919300000007")
        val scope = seedScope(context.jdbc, actorId, "OWNER")
        val listing = context.catalog.createListing(
            productCommand(scope.organizationId, scope.outletId, "8901234567856", "Race Listing"),
            "m2-race-create",
            actorId,
        )

        val sameVersion = race(
            { context.catalog.updateListing(updateCommand(listing, 0, 18_100, "Race A"), "m2-race-a", actorId) },
            { context.catalog.updateListing(updateCommand(listing, 0, 18_200, "Race B"), "m2-race-b", actorId) },
        )
        assertEquals(1, sameVersion.count { it.isSuccess })
        assertEquals(1, sameVersion.count { it.exceptionOrNull() is DomainException && (it.exceptionOrNull() as DomainException).code == "CATALOG_VERSION_CONFLICT" })
        assertEquals(2, context.catalog.listHistory(scope.organizationId, scope.outletId, listing.id).size)

        val versionOne = context.catalog.getManagedListing(scope.organizationId, scope.outletId, listing.id)
        val updateVsDeactivate = race(
            { context.catalog.updateListing(updateCommand(versionOne, 1, 18_300, "Race update"), "m2-race-update", actorId) },
            {
                context.catalog.changeLifecycle(
                    CatalogLifecycleCommand(
                        scope.organizationId,
                        scope.outletId,
                        listing.id,
                        1,
                        ListingStatus.INACTIVE,
                        setOf(ProviderCapability.PRODUCT_STORE),
                    ),
                    "m2-race-deactivate",
                    actorId,
                )
            },
        )
        assertEquals(1, updateVsDeactivate.count { it.isSuccess })
        assertEquals(1, updateVsDeactivate.count { it.exceptionOrNull() is DomainException && (it.exceptionOrNull() as DomainException).code == "CATALOG_VERSION_CONFLICT" })

        val duplicateResults = race(
            { context.catalog.createListing(productCommand(scope.organizationId, scope.outletId, "8901234567863", "Duplicate Race"), "m2-dup-a", actorId) },
            { context.catalog.createListing(productCommand(scope.organizationId, scope.outletId, "8901234567863", "Duplicate Race"), "m2-dup-b", actorId) },
        )
        assertTrue(duplicateResults.all { it.isSuccess })
        assertEquals(duplicateResults[0].getOrThrow().id, duplicateResults[1].getOrThrow().id)
        assertEquals(
            1,
            context.jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.catalog_listing WHERE outlet_id = ? AND normalized_barcode = '8901234567863'",
                Int::class.java,
                scope.outletId,
            ),
        )
        assertEquals(
            1,
            context.jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.catalog_listing_history WHERE listing_id = ?",
                Int::class.java,
                duplicateResults[0].getOrThrow().id,
            ),
        )
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        return Context(
            dataSource = dataSource,
            jdbc = jdbc,
            catalog = CatalogService(
                JdbcCatalogPersistence(jdbc, TransactionTemplate(DataSourceTransactionManager(dataSource))),
            ),
        )
    }

    private fun productCommand(organizationId: UUID, outletId: UUID, barcode: String, name: String) = CreateListingCommand(
        organizationId = organizationId,
        outletId = outletId,
        barcodeType = BarcodeType.GTIN_13,
        barcode = barcode,
        name = name,
        kind = ListingKind.PRODUCT,
        mrpPaise = 20_000,
        sellingPricePaise = 19_900,
        capabilities = setOf(ProviderCapability.PRODUCT_STORE),
        category = "food",
    )

    private fun updateCommand(listing: `in`.mypetnew.catalog.domain.Listing, expectedVersion: Long, sellingPricePaise: Long, name: String) = UpdateListingCommand(
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
        capabilities = setOf(ProviderCapability.PRODUCT_STORE),
    )

    private fun createMerchant(jdbc: JdbcTemplate, mobile: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')", id, mobile)
        return id
    }

    private fun seedScope(jdbc: JdbcTemplate, actorId: UUID, permission: String): Scope {
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M2 Org', 'ACTIVE', ?)", organizationId, actorId)
        jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M2 Outlet', 'ACTIVE', TRUE)", outletId, organizationId)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, ?, TRUE)", actorId, organizationId, outletId, permission)
        return Scope(organizationId, outletId)
    }

    private fun flyway(dataSource: javax.sql.DataSource, target: MigrationVersion? = null): Flyway {
        val config = Flyway.configure()
            .dataSource(dataSource)
            .schemas("mypet")
            .defaultSchema("mypet")
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
        if (target != null) config.target(target)
        return config.load()
    }

    private fun <T> race(first: () -> T, second: () -> T): List<Result<T>> {
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        return try {
            val tasks = listOf(first, second).map { operation ->
                executor.submit(Callable {
                    ready.countDown()
                    start.await()
                    runCatching(operation)
                })
            }
            ready.await()
            start.countDown()
            tasks.map { it.get() }
        } finally {
            executor.shutdownNow()
        }
    }

    private data class Scope(val organizationId: UUID, val outletId: UUID)
    private data class Context(val dataSource: javax.sql.DataSource, val jdbc: JdbcTemplate, val catalog: CatalogService)
}
