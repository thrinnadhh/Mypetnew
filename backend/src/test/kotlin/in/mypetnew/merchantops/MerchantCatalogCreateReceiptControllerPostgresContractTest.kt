package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.MerchantCatalogCreateReceiptController
import `in`.mypetnew.application.web.ResolveReceiptRequest
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class MerchantCatalogCreateReceiptControllerPostgresContractTest {

    private data class Context(
        val jdbc: JdbcTemplate,
        val catalog: CatalogService,
        val providers: ProviderService,
        val controller: MerchantCatalogCreateReceiptController,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val controller = MerchantCatalogCreateReceiptController(providers, jdbc)
        return Context(jdbc, catalog, providers, controller)
    }

    private fun seedMerchant(jdbc: JdbcTemplate, mobile: String): Triple<UUID, UUID, UUID> {
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

    private fun auth(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
    ) = UsernamePasswordAuthenticationToken(
        Principal(
            actorId = actorId,
            role = Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
            merchantPermissionsByOutlet = mapOf(outletId to setOf(MerchantPermission.CATALOG_WRITE)),
        ),
        null,
        emptyList(),
    )

    @Test
    fun `resolves valid create receipt with matching payload and permissions`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchant(ctx.jdbc, "+919420000001")
        val authentication = auth(actorId, organizationId, outletId)

        val listing = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "4006381333931",
                name = "Pedigree Adult 3kg",
                kind = ListingKind.PRODUCT,
                mrpPaise = 50000,
                sellingPricePaise = 45000,
                category = "dog-food",
                brand = "Pedigree",
                description = "Dry dog food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-cmd-123",
            actorId,
        )

        val response = ctx.controller.resolveCreateReceipt(
            authentication,
            ResolveReceiptRequest(
                idempotencyKey = "create-cmd-123",
                commandType = "CATALOG_CREATE",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "barcodeType" to "GTIN_13",
                    "barcode" to "4006381333931",
                    "name" to "Pedigree Adult 3kg",
                    "kind" to "PRODUCT",
                    "mrpPaise" to 50000,
                    "sellingPricePaise" to 45000,
                    "category" to "dog-food",
                    "brand" to "Pedigree",
                    "description" to "Dry dog food",
                ),
            ),
        )

        assertEquals("ACCEPTED", response.status)
        assertEquals(listing.id, response.entityId)
        assertEquals(0L, response.resultingVersion)
    }

    @Test
    fun `rejects create receipt when payload is altered`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchant(ctx.jdbc, "+919420000002")
        val authentication = auth(actorId, organizationId, outletId)

        ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.GTIN_13,
                barcode = "4006381333931",
                name = "Pedigree Adult 3kg",
                kind = ListingKind.PRODUCT,
                mrpPaise = 50000,
                sellingPricePaise = 45000,
                category = "dog-food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "create-cmd-456",
            actorId,
        )

        val ex = assertThrows(DomainException::class.java) {
            ctx.controller.resolveCreateReceipt(
                authentication,
                ResolveReceiptRequest(
                    idempotencyKey = "create-cmd-456",
                    commandType = "CATALOG_CREATE",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to outletId.toString(),
                        "barcodeType" to "GTIN_13",
                        "barcode" to "4006381333931",
                        "name" to "TAMPERED NAME",
                        "kind" to "PRODUCT",
                        "mrpPaise" to 50000,
                        "sellingPricePaise" to 45000,
                        "category" to "dog-food",
                    ),
                ),
            )
        }
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", ex.code)
    }

    @Test
    fun `rejects create receipt resolution when idempotency key does not exist`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchant(ctx.jdbc, "+919420000003")
        val authentication = auth(actorId, organizationId, outletId)

        val ex = assertThrows(DomainException::class.java) {
            ctx.controller.resolveCreateReceipt(
                authentication,
                ResolveReceiptRequest(
                    idempotencyKey = "non-existent-key",
                    commandType = "CATALOG_CREATE",
                    payloadSchemaVersion = 1,
                    payload = mapOf(
                        "outletId" to outletId.toString(),
                        "barcodeType" to "GTIN_13",
                        "barcode" to "4006381333931",
                        "name" to "Pedigree Adult 3kg",
                        "kind" to "PRODUCT",
                        "mrpPaise" to 50000,
                        "sellingPricePaise" to 45000,
                        "category" to "dog-food",
                    ),
                ),
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", ex.code)
    }

    @Test
    fun `rejects create receipt when commandType or schema is unsupported`() {
        val ctx = context()
        val (actorId, organizationId, outletId) = seedMerchant(ctx.jdbc, "+919420000004")
        val authentication = auth(actorId, organizationId, outletId)

        val ex = assertThrows(DomainException::class.java) {
            ctx.controller.resolveCreateReceipt(
                authentication,
                ResolveReceiptRequest(
                    idempotencyKey = "some-key",
                    commandType = "UNSUPPORTED_TYPE",
                    payloadSchemaVersion = 1,
                    payload = mapOf("outletId" to outletId.toString()),
                ),
            )
        }
        assertEquals("COMMAND_SCHEMA_UNSUPPORTED", ex.code)
    }
}
