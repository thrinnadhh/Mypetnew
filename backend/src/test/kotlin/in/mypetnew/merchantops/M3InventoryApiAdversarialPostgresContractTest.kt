package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.GlobalExceptionHandler
import `in`.mypetnew.application.web.MerchantInventoryController
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenario
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@MerchantOpsContract
@MerchantOpsPostgres
class M3InventoryApiAdversarialPostgresContractTest {
    @Test
    fun `M3-INV-002 authenticated adjustment boundary rejects spoofing invalid inputs and fingerprint changes`() {
        val context = context()
        val scenario = context.fixture.create()
        val principal = context.resolver.resolve(scenario.accountId, UUID.randomUUID())
        val authentication = auth(principal)
        val attackerActor = UUID.randomUUID()
        val attackerOrganization = UUID.randomUUID()

        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", "api-canonical")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """{"outletId":"${scenario.outletId}","listingId":"${scenario.listingId}","quantityDelta":4,"reason":"MANUAL_INCREASE","referenceType":"MERCHANT_NOTE","referenceId":"api-seed","actorId":"$attackerActor","organizationId":"$attackerOrganization"}""",
                ),
        ).andExpect(status().isOk)
            .andExpect(jsonPath("$.actorId").value(scenario.accountId.toString()))
            .andExpect(jsonPath("$.organizationId").value(scenario.organizationId.toString()))
            .andExpect(jsonPath("$.outletId").value(scenario.outletId.toString()))
            .andExpect(jsonPath("$.resultingOnHand").value(4))

        assertEquals(1, movementCount(context.jdbc, scenario))
        assertEquals(1, receiptCount(context.jdbc, scenario, "api-canonical"))
        assertEquals(1, publicationCount(context.jdbc, scenario))

        expectConflict(context, authentication, scenario, "api-canonical", 5, "MANUAL_INCREASE", "MERCHANT_NOTE", "api-seed")
        expectConflict(context, authentication, scenario, "api-canonical", -1, "MANUAL_DECREASE", "MERCHANT_NOTE", "api-seed")
        expectConflict(context, authentication, scenario, "api-canonical", 4, "MANUAL_INCREASE", "MERCHANT_NOTE", "changed-reference")

        val secondListing = createListing(context.jdbc, scenario.organizationId, scenario.outletId, "API-SECOND")
        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", "api-canonical")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, secondListing, 4, "MANUAL_INCREASE", "MERCHANT_NOTE", "api-seed")),
        ).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("IDEMPOTENCY_FINGERPRINT_MISMATCH"))

        val secondOutlet = createSecondOutlet(context.jdbc, scenario)
        val secondOutletListing = createListing(context.jdbc, scenario.organizationId, secondOutlet, "API-SECOND-OUTLET")
        val multiOutletPrincipal = context.resolver.reauthorize(principal)
        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(auth(multiOutletPrincipal))
                .header("Idempotency-Key", "api-canonical")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(secondOutlet, secondOutletListing, 4, "MANUAL_INCREASE", "MERCHANT_NOTE", "api-seed")),
        ).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("IDEMPOTENCY_FINGERPRINT_MISMATCH"))

        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", "api-zero")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, 0, "MANUAL_INCREASE")),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("INVENTORY_QUANTITY_INVALID"))

        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", "api-sign")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, -1, "MANUAL_INCREASE")),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("INVENTORY_REASON_INVALID"))

        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", "api-extreme")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, Int.MAX_VALUE, "MANUAL_INCREASE")),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("INVENTORY_QUANTITY_INVALID"))

        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", "api-unknown-reason")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, 1, "NOT_A_REASON")),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"))

        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, 1, "MANUAL_INCREASE")),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))

        assertEquals(1, movementCount(context.jdbc, scenario))
        assertEquals(4, balance(context.jdbc, scenario.listingId))
    }

    @Test
    fun `M3-INV-001 authenticated reads and writes fail closed for wrong permission revocation suspension and foreign UUIDs`() {
        val context = context()
        val scenario = context.fixture.create()
        replacePermission(context.jdbc, scenario, "INVENTORY_WRITE")
        val stalePrincipal = context.resolver.resolve(scenario.accountId, UUID.randomUUID())

        context.mockMvc.perform(
            get("/api/v1/merchant/inventory/balance")
                .principal(auth(stalePrincipal))
                .param("outletId", scenario.outletId.toString())
                .param("listingId", scenario.listingId.toString()),
        ).andExpect(status().isOk)
            .andExpect(jsonPath("$.organizationId").value(scenario.organizationId.toString()))

        val foreign = context.fixture.create()
        context.mockMvc.perform(
            get("/api/v1/merchant/inventory/balance")
                .principal(auth(stalePrincipal))
                .param("outletId", foreign.outletId.toString())
                .param("listingId", foreign.listingId.toString()),
        ).andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"))

        replacePermission(context.jdbc, scenario, "CATALOG_WRITE")
        val permissionRevoked = context.resolver.reauthorize(stalePrincipal)
        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(auth(permissionRevoked))
                .header("Idempotency-Key", "api-revoked-permission")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, 1, "MANUAL_INCREASE")),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("MERCHANT_PERMISSION_REQUIRED"))

        context.jdbc.update("DELETE FROM mypet.merchant_staff WHERE account_id = ?", scenario.accountId)
        val membershipRevoked = context.resolver.reauthorize(stalePrincipal)
        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(auth(membershipRevoked))
                .header("Idempotency-Key", "api-revoked-membership")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, 1, "MANUAL_INCREASE")),
        ).andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"))

        val suspendedIdentity = context.fixture.create()
        val suspendedPrincipal = context.resolver.resolve(suspendedIdentity.accountId, UUID.randomUUID())
        context.jdbc.update("UPDATE mypet.identity_account SET status = 'SUSPENDED' WHERE id = ?", suspendedIdentity.accountId)
        assertEquals(
            "SESSION_INVALID",
            assertThrows(`in`.mypetnew.common.error.DomainException::class.java) {
                context.resolver.reauthorize(suspendedPrincipal)
            }.code,
        )

        val suspendedOutlet = context.fixture.create()
        val outletPrincipal = context.resolver.resolve(suspendedOutlet.accountId, UUID.randomUUID())
        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", suspendedOutlet.outletId)
        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(auth(outletPrincipal))
                .header("Idempotency-Key", "api-suspended-outlet")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(suspendedOutlet.outletId, suspendedOutlet.listingId, 1, "MANUAL_INCREASE")),
        ).andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"))
    }

    @Test
    fun `M3-INV-002 authenticated last-unit race has one winner and exposes no movement mutation API`() {
        val context = context()
        val scenario = context.fixture.create()
        val principal = context.resolver.resolve(scenario.accountId, UUID.randomUUID())
        val authentication = auth(principal)

        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", "api-last-seed")
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, 1, "MANUAL_INCREASE")),
        ).andExpect(status().isOk)

        val executor = Executors.newFixedThreadPool(2)
        val ready = CountDownLatch(2)
        val go = CountDownLatch(1)
        try {
            val responses = listOf("api-last-a", "api-last-b").map { key ->
                executor.submit(Callable {
                    ready.countDown()
                    check(go.await(10, TimeUnit.SECONDS))
                    context.mockMvc.perform(
                        post("/api/v1/merchant/inventory/adjustments")
                            .principal(authentication)
                            .header("Idempotency-Key", key)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(adjustmentJson(scenario.outletId, scenario.listingId, -1, "MANUAL_DECREASE")),
                    ).andReturn().response.status
                })
            }
            check(ready.await(10, TimeUnit.SECONDS))
            go.countDown()
            assertEquals(listOf(200, 409), responses.map { it.get(30, TimeUnit.SECONDS) }.sorted())
        } finally {
            go.countDown()
            executor.shutdownNow()
        }

        assertEquals(0, balance(context.jdbc, scenario.listingId))
        assertEquals(2, movementCount(context.jdbc, scenario))
        assertEquals(0, context.jdbc.queryForObject("SELECT COUNT(*) FROM mypet.inventory_movement WHERE resulting_on_hand < 0", Int::class.java))

        val movementId = context.jdbc.queryForObject(
            "SELECT id FROM mypet.inventory_movement WHERE listing_id = ? ORDER BY occurred_at DESC LIMIT 1",
            UUID::class.java,
            scenario.listingId,
        )!!
        context.mockMvc.perform(
            patch("/api/v1/merchant/inventory/movements/$movementId")
                .principal(authentication)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"quantityDelta\":99}"),
        ).andExpect(status().isNotFound)
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val controller = MerchantInventoryController(providers, catalog, inventory)
        val mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(GlobalExceptionHandler())
            .build()
        return Context(
            jdbc = jdbc,
            inventory = inventory,
            fixture = MerchantScenarioFixture(dataSource),
            resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource)),
            mockMvc = mockMvc,
        )
    }

    private fun expectConflict(
        context: Context,
        authentication: UsernamePasswordAuthenticationToken,
        scenario: MerchantScenario,
        key: String,
        delta: Int,
        reason: String,
        referenceType: String?,
        referenceId: String?,
    ) {
        context.mockMvc.perform(
            post("/api/v1/merchant/inventory/adjustments")
                .principal(authentication)
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(adjustmentJson(scenario.outletId, scenario.listingId, delta, reason, referenceType, referenceId)),
        ).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("IDEMPOTENCY_FINGERPRINT_MISMATCH"))
    }

    private fun adjustmentJson(
        outletId: UUID,
        listingId: UUID,
        delta: Int,
        reason: String,
        referenceType: String? = null,
        referenceId: String? = null,
    ): String = buildString {
        append("{\"outletId\":\"").append(outletId)
        append("\",\"listingId\":\"").append(listingId)
        append("\",\"quantityDelta\":").append(delta)
        append(",\"reason\":\"").append(reason).append('"')
        if (referenceType != null) append(",\"referenceType\":\"").append(referenceType).append('"')
        if (referenceId != null) append(",\"referenceId\":\"").append(referenceId).append('"')
        append('}')
    }

    private fun auth(principal: Principal): UsernamePasswordAuthenticationToken =
        UsernamePasswordAuthenticationToken(principal, null, emptyList())

    private fun replacePermission(jdbc: JdbcTemplate, scenario: MerchantScenario, permission: String) {
        jdbc.update("DELETE FROM mypet.merchant_staff WHERE account_id = ? AND outlet_id = ?", scenario.accountId, scenario.outletId)
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, ?, TRUE)",
            scenario.accountId,
            scenario.organizationId,
            scenario.outletId,
            permission,
        )
    }

    private fun createListing(jdbc: JdbcTemplate, organizationId: UUID, outletId: UUID, barcode: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active, category
            ) VALUES (?, ?, ?, 'INTERNAL', ?, ?, 'PRODUCT', 'COMMERCE', 10000, 9000, TRUE, 'm3')
            """.trimIndent(),
            id,
            organizationId,
            outletId,
            barcode,
            "M3 $barcode",
        )
        return id
    }

    private fun createSecondOutlet(jdbc: JdbcTemplate, scenario: MerchantScenario): UUID {
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M3 API second outlet', 'ACTIVE', TRUE)",
            outletId,
            scenario.organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'INVENTORY_WRITE', TRUE)",
            scenario.accountId,
            scenario.organizationId,
            outletId,
        )
        return outletId
    }

    private fun movementCount(jdbc: JdbcTemplate, scenario: MerchantScenario): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.inventory_movement WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?",
        Int::class.java,
        scenario.organizationId,
        scenario.outletId,
        scenario.listingId,
    ) ?: 0

    private fun receiptCount(jdbc: JdbcTemplate, scenario: MerchantScenario, key: String): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.inventory_command_receipt WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?",
        Int::class.java,
        scenario.organizationId,
        scenario.accountId,
        key,
    ) ?: 0

    private fun publicationCount(jdbc: JdbcTemplate, scenario: MerchantScenario): Int = jdbc.queryForObject(
        """
        SELECT COUNT(*) FROM mypet.outbox_event o
        JOIN mypet.inventory_movement m ON m.id = o.aggregate_id
        WHERE o.aggregate_type = 'INVENTORY_MOVEMENT'
          AND o.event_type = 'INVENTORY_BALANCE_CHANGED'
          AND m.organization_id = ? AND m.outlet_id = ? AND m.listing_id = ?
        """.trimIndent(),
        Int::class.java,
        scenario.organizationId,
        scenario.outletId,
        scenario.listingId,
    ) ?: 0

    private fun balance(jdbc: JdbcTemplate, listingId: UUID): Int = jdbc.queryForObject(
        "SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?",
        Int::class.java,
        listingId,
    ) ?: 0

    private data class Context(
        val jdbc: JdbcTemplate,
        val inventory: InventoryService,
        val fixture: MerchantScenarioFixture,
        val resolver: JdbcMerchantPrincipalResolver,
        val mockMvc: MockMvc,
    )
}
