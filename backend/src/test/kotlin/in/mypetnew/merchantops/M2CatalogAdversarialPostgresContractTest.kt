package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogLifecycleCommand
import `in`.mypetnew.catalog.domain.CatalogSearchQuery
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.Listing
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
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
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
class M2CatalogAdversarialPostgresContractTest {
    @Test
    fun `M2-CAT-002 owner permission membership identity and outlet revocation fail closed without history`() {
        val context = context()
        val ownerId = createMerchant(context.jdbc, "+919310000001")
        val ownerScope = seedScope(context.jdbc, ownerId, "OWNER")
        val ownerListing = context.catalog.createListing(
            product(ownerScope, "AUTH-OWNER", "Owner protected"),
            "m2-auth-owner-create",
            ownerId,
        )
        val resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(context.dataSource))
        val oldOwner = resolver.resolve(ownerId, UUID.randomUUID())

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ? AND permission = 'OWNER'",
            ownerId,
            ownerScope.outletId,
        )
        val revokedOwner = resolver.reauthorize(oldOwner)
        val ownerFailure = assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(revokedOwner, ownerScope.outletId, MerchantPermission.CATALOG_WRITE)
        }
        assertEquals("MERCHANT_PERMISSION_REQUIRED", ownerFailure.code)
        assertEquals(1, historyCount(context.jdbc, ownerListing.id))

        val memberId = createMerchant(context.jdbc, "+919310000002")
        val memberScope = seedScope(context.jdbc, memberId, "CATALOG_WRITE")
        val memberListing = context.catalog.createListing(
            product(memberScope, "AUTH-MEMBER", "Membership protected"),
            "m2-auth-member-create",
            memberId,
        )
        val oldMember = resolver.resolve(memberId, UUID.randomUUID())
        context.jdbc.update("DELETE FROM mypet.merchant_staff WHERE account_id = ?", memberId)
        val removedMember = resolver.reauthorize(oldMember)
        val memberFailure = assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(removedMember, memberScope.outletId, MerchantPermission.CATALOG_WRITE)
        }
        assertEquals("MERCHANT_PERMISSION_REQUIRED", memberFailure.code)
        assertEquals(1, historyCount(context.jdbc, memberListing.id))

        val suspendedId = createMerchant(context.jdbc, "+919310000003")
        val suspendedScope = seedScope(context.jdbc, suspendedId, "CATALOG_WRITE")
        val suspendedListing = context.catalog.createListing(
            product(suspendedScope, "AUTH-IDENTITY", "Identity protected"),
            "m2-auth-identity-create",
            suspendedId,
        )
        val oldIdentity = resolver.resolve(suspendedId, UUID.randomUUID())
        context.jdbc.update("UPDATE mypet.identity_account SET status = 'SUSPENDED' WHERE id = ?", suspendedId)
        val identityFailure = assertThrows(DomainException::class.java) { resolver.reauthorize(oldIdentity) }
        assertEquals("SESSION_INVALID", identityFailure.code)
        assertEquals(1, historyCount(context.jdbc, suspendedListing.id))

        val outletId = createMerchant(context.jdbc, "+919310000004")
        val outletScope = seedScope(context.jdbc, outletId, "CATALOG_WRITE")
        val outletListing = context.catalog.createListing(
            product(outletScope, "AUTH-OUTLET", "Outlet protected"),
            "m2-auth-outlet-create",
            outletId,
        )
        val outletPrincipal = resolver.resolve(outletId, UUID.randomUUID())
        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", outletScope.outletId)
        val outletFailure = assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(outletPrincipal, outletScope.outletId, MerchantPermission.CATALOG_WRITE)
        }
        assertEquals("RESOURCE_NOT_FOUND", outletFailure.code)
        assertEquals(1, historyCount(context.jdbc, outletListing.id))
    }

    @Test
    fun `M2-CAT-002 foreign organization and cross outlet UUID guessing cannot mutate or create history`() {
        val context = context()
        val merchantA = createMerchant(context.jdbc, "+919310000005")
        val scopeA = seedScope(context.jdbc, merchantA, "CATALOG_WRITE")
        val merchantB = createMerchant(context.jdbc, "+919310000006")
        val scopeB = seedScope(context.jdbc, merchantB, "CATALOG_WRITE")
        val privateB = context.catalog.createListing(
            product(scopeB, "FOREIGN-B", "Merchant B secret"),
            "m2-foreign-b-create",
            merchantB,
        )

        val foreignUpdate = assertThrows(DomainException::class.java) {
            context.catalog.updateListing(
                update(privateB, scopeA, expectedVersion = 0, name = "Guessed update"),
                "m2-foreign-update",
                merchantA,
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", foreignUpdate.code)
        val foreignLifecycle = assertThrows(DomainException::class.java) {
            context.catalog.changeLifecycle(
                CatalogLifecycleCommand(
                    organizationId = scopeA.organizationId,
                    outletId = scopeA.outletId,
                    listingId = privateB.id,
                    expectedVersion = 0,
                    targetStatus = ListingStatus.INACTIVE,
                    capabilities = setOf(ProviderCapability.PRODUCT_STORE),
                ),
                "m2-foreign-deactivate",
                merchantA,
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", foreignLifecycle.code)
        assertEquals(1, historyCount(context.jdbc, privateB.id))
        assertTrue(
            context.catalog.searchManagedListings(
                CatalogSearchQuery(scopeA.organizationId, scopeA.outletId, query = "Merchant B secret"),
            ).items.isEmpty(),
        )

        val secondOutlet = addOutlet(context.jdbc, scopeA.organizationId, merchantA, "CATALOG_WRITE")
        val secondListing = context.catalog.createListing(
            product(secondOutlet, "OUTLET-TWO", "Second outlet private"),
            "m2-outlet-two-create",
            merchantA,
        )
        val crossOutlet = assertThrows(DomainException::class.java) {
            context.catalog.updateListing(
                update(secondListing, scopeA, 0, "Wrong outlet write"),
                "m2-cross-outlet-update",
                merchantA,
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", crossOutlet.code)
        assertEquals(1, historyCount(context.jdbc, secondListing.id))
    }

    @Test
    fun `M2-CAT-001 validation failures and lifecycle replay never add successful history`() {
        val context = context()
        val actorId = createMerchant(context.jdbc, "+919310000007")
        val scope = seedScope(context.jdbc, actorId, "OWNER")
        val listing = context.catalog.createListing(product(scope, "VALIDATE-1", "Validated"), "m2-validation-create", actorId)

        val invalidPrice = assertThrows(DomainException::class.java) {
            context.catalog.updateListing(
                update(listing, scope, 0, "Validated").copy(sellingPricePaise = Long.MAX_VALUE),
                "m2-invalid-price",
                actorId,
            )
        }
        assertEquals("LISTING_PRICE_INVALID", invalidPrice.code)
        val invalidName = assertThrows(DomainException::class.java) {
            context.catalog.updateListing(update(listing, scope, 0, "   "), "m2-invalid-name", actorId)
        }
        assertEquals("LISTING_NAME_INVALID", invalidName.code)
        val invalidSku = assertThrows(DomainException::class.java) {
            context.catalog.updateListing(
                update(listing, scope, 0, "Validated").copy(sku = "S".repeat(81)),
                "m2-invalid-sku",
                actorId,
            )
        }
        assertEquals("LISTING_METADATA_INVALID", invalidSku.code)
        assertEquals(1, historyCount(context.jdbc, listing.id))

        val deactivated = context.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                scope.organizationId,
                scope.outletId,
                listing.id,
                0,
                ListingStatus.INACTIVE,
                setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "m2-lifecycle-replay",
            actorId,
        )
        val replay = context.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                scope.organizationId,
                scope.outletId,
                listing.id,
                0,
                ListingStatus.INACTIVE,
                setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "m2-lifecycle-replay",
            actorId,
        )
        assertEquals(deactivated, replay)
        assertEquals(2, historyCount(context.jdbc, listing.id))

        val fingerprintMismatch = assertThrows(DomainException::class.java) {
            context.catalog.changeLifecycle(
                CatalogLifecycleCommand(
                    scope.organizationId,
                    scope.outletId,
                    listing.id,
                    1,
                    ListingStatus.ACTIVE,
                    setOf(ProviderCapability.PRODUCT_STORE),
                ),
                "m2-lifecycle-replay",
                actorId,
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", fingerprintMismatch.code)
        assertEquals(2, historyCount(context.jdbc, listing.id))
    }

    @Test
    fun `M2-CAT-002 search treats wildcards literally filters lifecycle and bounds pagination abuse`() {
        val context = context()
        val actorId = createMerchant(context.jdbc, "+919310000008")
        val scope = seedScope(context.jdbc, actorId, "CATALOG_WRITE")
        val percent = context.catalog.createListing(product(scope, "SEARCH-PCT", "Percent % Treat"), "m2-search-percent", actorId)
        val underscore = context.catalog.createListing(product(scope, "SEARCH-US", "Under_score Treat"), "m2-search-underscore", actorId)
        context.catalog.createListing(product(scope, "SEARCH-NORMAL", "Ordinary Treat"), "m2-search-normal", actorId)
        context.catalog.changeLifecycle(
            CatalogLifecycleCommand(
                scope.organizationId,
                scope.outletId,
                underscore.id,
                0,
                ListingStatus.INACTIVE,
                setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "m2-search-deactivate",
            actorId,
        )

        assertEquals(
            listOf(percent.id),
            context.catalog.searchManagedListings(CatalogSearchQuery(scope.organizationId, scope.outletId, query = "%"))
                .items.map { it.id },
        )
        assertEquals(
            listOf(underscore.id),
            context.catalog.searchManagedListings(CatalogSearchQuery(scope.organizationId, scope.outletId, query = "_"))
                .items.map { it.id },
        )
        val inactive = context.catalog.searchManagedListings(
            CatalogSearchQuery(scope.organizationId, scope.outletId, status = ListingStatus.INACTIVE),
        )
        assertEquals(listOf(underscore.id), inactive.items.map { it.id })
        val terminal = context.catalog.searchManagedListings(
            CatalogSearchQuery(scope.organizationId, scope.outletId, page = 999, pageSize = 2),
        )
        assertTrue(terminal.items.isEmpty())
        assertFalse(terminal.hasNext)
        assertEquals(
            100,
            context.catalog.searchManagedListings(
                CatalogSearchQuery(scope.organizationId, scope.outletId, pageSize = 100_000),
            ).pageSize,
        )
        assertEquals(
            "CATALOG_PAGE_INVALID",
            assertThrows(DomainException::class.java) {
                context.catalog.searchManagedListings(CatalogSearchQuery(scope.organizationId, scope.outletId, page = -1))
            }.code,
        )
        assertEquals(
            "CATALOG_PAGE_INVALID",
            assertThrows(DomainException::class.java) {
                context.catalog.searchManagedListings(CatalogSearchQuery(scope.organizationId, scope.outletId, pageSize = 0))
            }.code,
        )
        assertEquals(
            "CATALOG_SEARCH_INVALID",
            assertThrows(DomainException::class.java) {
                context.catalog.searchManagedListings(
                    CatalogSearchQuery(scope.organizationId, scope.outletId, query = "x".repeat(121)),
                )
            }.code,
        )
    }

    @Test
    @MerchantOpsConcurrency
    fun `M2-CAT-002 concurrent identical mutation key converges on one canonical result`() {
        val context = context()
        val actorId = createMerchant(context.jdbc, "+919310000009")
        val scope = seedScope(context.jdbc, actorId, "OWNER")
        val listing = context.catalog.createListing(product(scope, "IDEM-RACE", "Idempotent Race"), "m2-idem-race-create", actorId)
        val command = update(listing, scope, 0, "Idempotent Race Winner").copy(sellingPricePaise = 18_500)

        val results = race(
            { context.catalog.updateListing(command, "m2-same-key-race", actorId) },
            { context.catalog.updateListing(command, "m2-same-key-race", actorId) },
        )
        assertTrue(results.all { it.isSuccess })
        val first = results[0].getOrThrow()
        val second = results[1].getOrThrow()
        assertEquals(first, second)
        assertEquals(1L, first.version)
        assertEquals(2, historyCount(context.jdbc, listing.id))
        assertEquals(
            1,
            context.jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.catalog_mutation_receipt WHERE outlet_id = ? AND idempotency_key = 'm2-same-key-race'",
                Int::class.java,
                scope.outletId,
            ),
        )
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        return Context(
            dataSource,
            jdbc,
            CatalogService(JdbcCatalogPersistence(jdbc, transactions)),
            ProviderService(JdbcProviderPersistence(jdbc, transactions)),
        )
    }

    private fun product(scope: Scope, barcode: String, name: String) = CreateListingCommand(
        organizationId = scope.organizationId,
        outletId = scope.outletId,
        barcodeType = BarcodeType.INTERNAL,
        barcode = barcode,
        name = name,
        kind = ListingKind.PRODUCT,
        mrpPaise = 20_000,
        sellingPricePaise = 19_000,
        capabilities = setOf(ProviderCapability.PRODUCT_STORE),
        category = "treats",
    )

    private fun update(listing: Listing, scope: Scope, expectedVersion: Long, name: String) = UpdateListingCommand(
        organizationId = scope.organizationId,
        outletId = scope.outletId,
        listingId = listing.id,
        expectedVersion = expectedVersion,
        name = name,
        mrpPaise = listing.mrpPaise,
        sellingPricePaise = listing.sellingPricePaise,
        category = listing.category,
        brand = listing.brand,
        description = listing.description,
        petType = listing.petType,
        lifeStage = listing.lifeStage,
        packLabel = listing.packLabel,
        sku = listing.sku,
        capabilities = setOf(ProviderCapability.PRODUCT_STORE),
    )

    private fun createMerchant(jdbc: JdbcTemplate, mobile: String): UUID = UUID.randomUUID().also { id ->
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')",
            id,
            mobile,
        )
    }

    private fun seedScope(jdbc: JdbcTemplate, actorId: UUID, permission: String): Scope {
        val organizationId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M2 Adv Org', 'ACTIVE', ?)",
            organizationId,
            actorId,
        )
        return addOutlet(jdbc, organizationId, actorId, permission)
    }

    private fun addOutlet(jdbc: JdbcTemplate, organizationId: UUID, actorId: UUID, permission: String): Scope {
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M2 Adv Outlet', 'ACTIVE', TRUE)",
            outletId,
            organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)",
            outletId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, ?, TRUE)",
            actorId,
            organizationId,
            outletId,
            permission,
        )
        return Scope(organizationId, outletId)
    }

    private fun historyCount(jdbc: JdbcTemplate, listingId: UUID): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.catalog_listing_history WHERE listing_id = ?",
        Int::class.java,
        listingId,
    ) ?: 0

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
    private data class Context(
        val dataSource: javax.sql.DataSource,
        val jdbc: JdbcTemplate,
        val catalog: CatalogService,
        val providers: ProviderService,
    )
}
