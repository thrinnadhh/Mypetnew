package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockMovement
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.infrastructure.JdbcMerchantPrincipalResolver
import `in`.mypetnew.merchantops.testsupport.MerchantOpsConcurrency
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenario
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
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
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

@MerchantOpsContract
@MerchantOpsPostgres
class M3InventoryPostgresContractTest {
    @Test
    fun `M3-INV-001 V24 upgrades legacy stock with an opening movement and makes the ledger immutable`() {
        val dataSource = PostgresTestDatabase.dataSource()
        val toV23 = flyway(dataSource, MigrationVersion.fromVersion("23"))
        toV23.clean()
        toV23.migrate()
        val jdbc = JdbcTemplate(dataSource)

        val actorId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        val listingId = UUID.randomUUID()
        val medicineId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, '+919311111111', 'MERCHANT', 'ACTIVE')",
            actorId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_organization(id, name, status) VALUES (?, 'M3 legacy org', 'ACTIVE')",
            organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M3 legacy outlet', 'ACTIVE', TRUE)",
            outletId,
            organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)",
            actorId,
            organizationId,
            outletId,
        )
        insertListing(jdbc, listingId, organizationId, outletId, "M3-LEGACY-PRODUCT", "PRODUCT", "COMMERCE", true)
        insertListing(jdbc, medicineId, organizationId, outletId, "M3-LEGACY-MED", "MEDICINE", "VIEW_ONLY", false)
        jdbc.update(
            "INSERT INTO mypet.inventory_balance(listing_id, on_hand, reserved, version) VALUES (?, 7, 2, 3)",
            listingId,
        )
        jdbc.update(
            "INSERT INTO mypet.inventory_balance(listing_id, on_hand, reserved, version) VALUES (?, 0, 0, 0)",
            medicineId,
        )
        val legacyMovementId = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.inventory_movement(
                id, listing_id, outlet_id, reason, quantity_delta, resulting_on_hand,
                resulting_reserved, source_type, source_reference, actor_id, idempotency_key,
                trace_id, operation_scope, request_fingerprint
            ) VALUES (?, ?, ?, 'RECEIPT', 2, 2, 0, 'RECEIPT', 'legacy-receipt', ?, 'legacy-receipt',
                      'legacy-trace', 'stock-adjust', ?)
            """.trimIndent(),
            legacyMovementId,
            listingId,
            outletId,
            actorId,
            "a".repeat(64),
        )

        flyway(dataSource).migrate()

        assertEquals(7, jdbc.queryForObject("SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?", Int::class.java, listingId))
        assertEquals(2, jdbc.queryForObject("SELECT reserved FROM mypet.inventory_balance WHERE listing_id = ?", Int::class.java, listingId))
        assertEquals(7L, ledgerSum(jdbc, listingId))
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM mypet.inventory_movement WHERE listing_id = ?", Int::class.java, listingId))
        assertEquals(
            5,
            jdbc.queryForObject(
                "SELECT quantity_delta FROM mypet.inventory_movement WHERE listing_id = ? AND reason = 'OPENING_BALANCE'",
                Int::class.java,
                listingId,
            ),
        )
        assertEquals(
            "MIGRATION",
            jdbc.queryForObject(
                "SELECT source_type FROM mypet.inventory_movement WHERE listing_id = ? AND reason = 'OPENING_BALANCE'",
                String::class.java,
                listingId,
            ),
        )
        assertEquals(
            UUID(0L, 0L),
            jdbc.queryForObject(
                "SELECT actor_id FROM mypet.inventory_movement WHERE listing_id = ? AND reason = 'OPENING_BALANCE'",
                UUID::class.java,
                listingId,
            ),
        )
        assertEquals("VIEW_ONLY", jdbc.queryForObject("SELECT commerce_mode FROM mypet.catalog_listing WHERE id = ?", String::class.java, medicineId))
        assertFalse(jdbc.queryForObject("SELECT active FROM mypet.catalog_listing WHERE id = ?", Boolean::class.java, medicineId)!!)
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM mypet.merchant_staff WHERE account_id = ? AND active = TRUE", Int::class.java, actorId))

        assertThrows(Exception::class.java) {
            jdbc.update("UPDATE mypet.inventory_movement SET quantity_delta = 99 WHERE id = ?", legacyMovementId)
        }
        assertThrows(Exception::class.java) {
            jdbc.update("DELETE FROM mypet.inventory_movement WHERE id = ?", legacyMovementId)
        }
        assertEquals(7L, ledgerSum(jdbc, listingId))
    }

    @Test
    fun `M3-INV-001 and M3-INV-002 movement balance receipt publication replay rollback and reconciliation are atomic`() {
        val context = context()
        val scenario = context.fixture.create()
        val scope = scenario.scope()
        val actor = scenario.accountId

        val first = context.inventory.adjustMerchant(
            scope,
            5,
            StockReason.MANUAL_INCREASE,
            "m3-adjust-1",
            actor,
            "m3-trace-1",
            "MERCHANT_NOTE",
            "initial-fill",
        )
        assertEquals(5, first.resultingOnHand)
        assertEquals(5, context.inventory.requireReconciled(scope).onHand)
        assertEquals(1, movementCount(context.jdbc, scope))
        assertEquals(1, receiptCount(context.jdbc, scenario.organizationId, actor, "m3-adjust-1"))
        assertEquals(1, publicationCount(context.jdbc, first.id))

        val replay = context.inventory.adjustMerchant(
            scope,
            5,
            StockReason.MANUAL_INCREASE,
            "m3-adjust-1",
            actor,
            "m3-trace-lost-response-retry",
            "MERCHANT_NOTE",
            "initial-fill",
        )
        assertEquals(first.id, replay.id)
        assertEquals(1, movementCount(context.jdbc, scope))
        assertEquals(1, receiptCount(context.jdbc, scenario.organizationId, actor, "m3-adjust-1"))
        assertEquals(1, publicationCount(context.jdbc, first.id))

        mismatch {
            context.inventory.adjustMerchant(scope, 6, StockReason.MANUAL_INCREASE, "m3-adjust-1", actor, "trace", "MERCHANT_NOTE", "initial-fill")
        }
        mismatch {
            context.inventory.adjustMerchant(scope, 5, StockReason.MANUAL_INCREASE, "m3-adjust-1", actor, "trace", "MERCHANT_NOTE", "changed-reference")
        }
        mismatch {
            context.persistence.adjustScoped(scope, 5, StockReason.MANUAL_DECREASE, "m3-adjust-1", actor, "trace", "MERCHANT_NOTE", "initial-fill")
        }

        val secondListing = createListing(context.jdbc, scenario.organizationId, scenario.outletId, "M3-SECOND-LISTING")
        mismatch {
            context.inventory.adjustMerchant(
                InventoryScope(scenario.organizationId, scenario.outletId, secondListing),
                5,
                StockReason.MANUAL_INCREASE,
                "m3-adjust-1",
                actor,
                "trace",
                "MERCHANT_NOTE",
                "initial-fill",
            )
        }
        val secondOutletScope = createSecondOutletListing(context.jdbc, scenario, "M3-SECOND-OUTLET")
        mismatch {
            context.inventory.adjustMerchant(
                secondOutletScope,
                5,
                StockReason.MANUAL_INCREASE,
                "m3-adjust-1",
                actor,
                "trace",
                "MERCHANT_NOTE",
                "initial-fill",
            )
        }
        assertEquals(1, movementCount(context.jdbc, scope))
        assertEquals(5, context.inventory.requireReconciled(scope).onHand)

        val zero = assertThrows(DomainException::class.java) {
            context.inventory.adjustMerchant(scope, 0, StockReason.MANUAL_INCREASE, "zero", actor, "trace")
        }
        assertEquals("INVENTORY_QUANTITY_INVALID", zero.code)
        val extreme = assertThrows(DomainException::class.java) {
            context.inventory.adjustMerchant(scope, Int.MAX_VALUE, StockReason.MANUAL_INCREASE, "extreme", actor, "trace")
        }
        assertEquals("INVENTORY_QUANTITY_INVALID", extreme.code)
        val wrongReason = assertThrows(DomainException::class.java) {
            context.inventory.adjustMerchant(scope, 1, StockReason.RECEIPT, "reason", actor, "trace")
        }
        assertEquals("INVENTORY_REASON_INVALID", wrongReason.code)

        val insufficient = assertThrows(DomainException::class.java) {
            context.inventory.adjustMerchant(scope, -6, StockReason.MANUAL_DECREASE, "too-low", actor, "trace")
        }
        assertEquals("INSUFFICIENT_STOCK", insufficient.code)
        assertEquals(1, movementCount(context.jdbc, scope))
        assertEquals(0, receiptCount(context.jdbc, scenario.organizationId, actor, "too-low"))

        val compensation = context.inventory.adjustMerchant(
            scope,
            -2,
            StockReason.MANUAL_DECREASE,
            "m3-compensate",
            actor,
            "trace",
            "MERCHANT_NOTE",
            "correction-1",
        )
        assertEquals(3, compensation.resultingOnHand)
        assertEquals(3L, ledgerSum(context.jdbc, scenario.listingId))
        assertEquals(3, context.inventory.requireReconciled(scope).onHand)

        forceInsertFailure(context.jdbc, "inventory_command_receipt", "m3_fail_receipt") {
            assertThrows(Exception::class.java) {
                context.inventory.adjustMerchant(scope, 1, StockReason.MANUAL_INCREASE, "receipt-fail", actor, "trace")
            }
        }
        assertEquals(3, context.inventory.requireReconciled(scope).onHand)
        assertEquals(2, movementCount(context.jdbc, scope))
        assertEquals(0, receiptCount(context.jdbc, scenario.organizationId, actor, "receipt-fail"))

        forceInsertFailure(context.jdbc, "outbox_event", "m3_fail_outbox") {
            assertThrows(Exception::class.java) {
                context.inventory.adjustMerchant(scope, 1, StockReason.MANUAL_INCREASE, "outbox-fail", actor, "trace")
            }
        }
        assertEquals(3, context.inventory.requireReconciled(scope).onHand)
        assertEquals(2, movementCount(context.jdbc, scope))
        assertEquals(0, receiptCount(context.jdbc, scenario.organizationId, actor, "outbox-fail"))

        val page = context.inventory.history(scope, page = 0, pageSize = 1)
        assertEquals(1, page.items.size)
        assertTrue(page.hasNext)
        assertEquals(1, page.pageSize)
        val foreign = context.fixture.create()
        val foreignRead = assertThrows(DomainException::class.java) {
            context.inventory.history(
                InventoryScope(foreign.organizationId, foreign.outletId, scenario.listingId),
                0,
                25,
            )
        }
        assertEquals("RESOURCE_NOT_FOUND", foreignRead.code)
    }

    @Test
    fun `M3-INV-001 current M1 authority permits OWNER and INVENTORY_WRITE and fails closed after revocation suspension or foreign targeting`() {
        val context = context()

        val owner = context.fixture.create()
        val ownerPrincipal = context.resolver.resolve(owner.accountId, UUID.randomUUID())
        context.providers.requireActiveOutlet(ownerPrincipal, owner.outletId, MerchantPermission.INVENTORY_WRITE)

        val inventoryWriter = context.fixture.create()
        replacePermission(context.jdbc, inventoryWriter, "INVENTORY_WRITE")
        val writerPrincipal = context.resolver.resolve(inventoryWriter.accountId, UUID.randomUUID())
        context.providers.requireActiveOutlet(writerPrincipal, inventoryWriter.outletId, MerchantPermission.INVENTORY_WRITE)

        val catalogOnly = context.fixture.create()
        replacePermission(context.jdbc, catalogOnly, "CATALOG_WRITE")
        val catalogPrincipal = context.resolver.resolve(catalogOnly.accountId, UUID.randomUUID())
        val denied = assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(catalogPrincipal, catalogOnly.outletId, MerchantPermission.INVENTORY_WRITE)
        }
        assertEquals("MERCHANT_PERMISSION_REQUIRED", denied.code)

        val foreign = assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(ownerPrincipal, inventoryWriter.outletId, MerchantPermission.INVENTORY_WRITE)
        }
        assertEquals("RESOURCE_NOT_FOUND", foreign.code)

        context.jdbc.update(
            "UPDATE mypet.merchant_staff SET active = FALSE WHERE account_id = ? AND outlet_id = ?",
            inventoryWriter.accountId,
            inventoryWriter.outletId,
        )
        val revoked = context.resolver.reauthorize(writerPrincipal)
        val revokedDenied = assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(revoked, inventoryWriter.outletId, MerchantPermission.INVENTORY_WRITE)
        }
        assertEquals("RESOURCE_NOT_FOUND", revokedDenied.code)

        val suspendedIdentity = context.fixture.create()
        val suspendedPrincipal = context.resolver.resolve(suspendedIdentity.accountId, UUID.randomUUID())
        context.jdbc.update("UPDATE mypet.identity_account SET status = 'SUSPENDED' WHERE id = ?", suspendedIdentity.accountId)
        val invalidSession = assertThrows(DomainException::class.java) {
            context.resolver.reauthorize(suspendedPrincipal)
        }
        assertEquals("SESSION_INVALID", invalidSession.code)

        val suspendedOutlet = context.fixture.create()
        val outletPrincipal = context.resolver.resolve(suspendedOutlet.accountId, UUID.randomUUID())
        context.jdbc.update("UPDATE mypet.provider_outlet SET status = 'SUSPENDED' WHERE id = ?", suspendedOutlet.outletId)
        val outletDenied = assertThrows(DomainException::class.java) {
            context.providers.requireActiveOutlet(outletPrincipal, suspendedOutlet.outletId, MerchantPermission.INVENTORY_WRITE)
        }
        assertEquals("RESOURCE_NOT_FOUND", outletDenied.code)

        val sharedActor = owner.accountId
        val ownerScope = owner.scope()
        val first = context.inventory.adjustMerchant(ownerScope, 1, StockReason.MANUAL_INCREASE, "actor-isolation", sharedActor, "trace")
        val anotherActor = UUID.randomUUID()
        context.jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, '+919322222222', 'MERCHANT', 'ACTIVE')",
            anotherActor,
        )
        context.jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'INVENTORY_WRITE', TRUE)",
            anotherActor,
            owner.organizationId,
            owner.outletId,
        )
        val second = context.inventory.adjustMerchant(ownerScope, 1, StockReason.MANUAL_INCREASE, "actor-isolation", anotherActor, "trace")
        assertNotEquals(first.id, second.id)
        assertEquals(sharedActor, first.actorId)
        assertEquals(anotherActor, second.actorId)
        assertEquals(2, context.inventory.requireReconciled(ownerScope).onHand)
    }

    @Test
    @MerchantOpsConcurrency
    fun `M3-INV-001 and M3-INV-002 PostgreSQL orders last-unit many-writer and idempotency races without lost updates`() {
        val context = context()
        val scenario = context.fixture.create()
        val actor = scenario.accountId

        val lastUnitListing = createListing(context.jdbc, scenario.organizationId, scenario.outletId, "M3-LAST-UNIT")
        val lastUnitScope = InventoryScope(scenario.organizationId, scenario.outletId, lastUnitListing)
        context.inventory.adjustMerchant(lastUnitScope, 1, StockReason.MANUAL_INCREASE, "last-seed", actor, "trace")
        val lastUnit = concurrent(
            {
                context.inventory.adjustMerchant(lastUnitScope, -1, StockReason.MANUAL_DECREASE, "last-a", actor, "trace")
            },
            {
                context.inventory.adjustMerchant(lastUnitScope, -1, StockReason.MANUAL_DECREASE, "last-b", actor, "trace")
            },
        )
        assertEquals(1, lastUnit.count { it.isSuccess })
        assertEquals(1, lastUnit.count { it.exceptionOrNull() is DomainException })
        assertEquals(0, context.inventory.requireReconciled(lastUnitScope).onHand)
        assertEquals(2, movementCount(context.jdbc, lastUnitScope))

        val manyListing = createListing(context.jdbc, scenario.organizationId, scenario.outletId, "M3-MANY")
        val manyScope = InventoryScope(scenario.organizationId, scenario.outletId, manyListing)
        context.inventory.adjustMerchant(manyScope, 50, StockReason.MANUAL_INCREASE, "many-seed", actor, "trace")
        val many = concurrent(
            *(1..40).map { index ->
                {
                    context.inventory.adjustMerchant(
                        manyScope,
                        1,
                        StockReason.MANUAL_INCREASE,
                        "many-$index",
                        actor,
                        "trace-$index",
                    )
                }
            }.toTypedArray(),
        )
        assertTrue(many.all { it.isSuccess })
        assertEquals(90, context.inventory.requireReconciled(manyScope).onHand)
        assertEquals(90L, ledgerSum(context.jdbc, manyListing))
        assertEquals(41, movementCount(context.jdbc, manyScope))

        val replayListing = createListing(context.jdbc, scenario.organizationId, scenario.outletId, "M3-SAME-KEY")
        val replayScope = InventoryScope(scenario.organizationId, scenario.outletId, replayListing)
        context.inventory.adjustMerchant(replayScope, 10, StockReason.MANUAL_INCREASE, "replay-seed", actor, "trace")
        val replays = concurrent(
            *(1..16).map {
                {
                    context.inventory.adjustMerchant(replayScope, -1, StockReason.MANUAL_DECREASE, "same-key", actor, "trace-$it")
                }
            }.toTypedArray(),
        )
        assertTrue(replays.all { it.isSuccess })
        val movementIds = replays.map { it.getOrThrow().id }.toSet()
        assertEquals(1, movementIds.size)
        assertEquals(9, context.inventory.requireReconciled(replayScope).onHand)
        assertEquals(2, movementCount(context.jdbc, replayScope))
        assertEquals(1, receiptCount(context.jdbc, scenario.organizationId, actor, "same-key"))
        assertEquals(1, publicationCount(context.jdbc, movementIds.single()))

        val collisionListing = createListing(context.jdbc, scenario.organizationId, scenario.outletId, "M3-COLLISION")
        val collisionScope = InventoryScope(scenario.organizationId, scenario.outletId, collisionListing)
        val collision = concurrent(
            {
                context.inventory.adjustMerchant(collisionScope, 2, StockReason.MANUAL_INCREASE, "collision", actor, "trace-a")
            },
            {
                context.inventory.adjustMerchant(collisionScope, 3, StockReason.MANUAL_INCREASE, "collision", actor, "trace-b")
            },
        )
        assertEquals(1, collision.count { it.isSuccess })
        val collisionFailure = collision.single { it.isFailure }.exceptionOrNull()
        assertTrue(collisionFailure is DomainException)
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", (collisionFailure as DomainException).code)
        val collisionBalance = context.inventory.requireReconciled(collisionScope).onHand
        assertTrue(collisionBalance == 2 || collisionBalance == 3)
        assertEquals(1, movementCount(context.jdbc, collisionScope))
        assertEquals(1, receiptCount(context.jdbc, scenario.organizationId, actor, "collision"))
    }

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val persistence = JdbcInventoryPersistence(jdbc, transactions)
        return Context(
            dataSource = dataSource,
            jdbc = jdbc,
            persistence = persistence,
            inventory = InventoryService(persistence),
            fixture = MerchantScenarioFixture(dataSource),
            resolver = JdbcMerchantPrincipalResolver(JdbcClient.create(dataSource)),
            providers = ProviderService(JdbcProviderPersistence(jdbc, transactions)),
        )
    }

    private fun flyway(dataSource: DataSource, target: MigrationVersion? = null): Flyway {
        val configuration = Flyway.configure()
            .dataSource(dataSource)
            .schemas("mypet")
            .defaultSchema("mypet")
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
        if (target != null) configuration.target(target)
        return configuration.load()
    }

    private fun insertListing(
        jdbc: JdbcTemplate,
        listingId: UUID,
        organizationId: UUID,
        outletId: UUID,
        barcode: String,
        kind: String,
        commerceMode: String,
        active: Boolean,
    ) {
        jdbc.update(
            """
            INSERT INTO mypet.catalog_listing(
                id, organization_id, outlet_id, barcode_type, normalized_barcode, name,
                listing_kind, commerce_mode, mrp_paise, selling_price_paise, active, category
            ) VALUES (?, ?, ?, 'INTERNAL', ?, ?, ?, ?, 10000, 9000, ?, 'm3')
            """.trimIndent(),
            listingId,
            organizationId,
            outletId,
            barcode,
            "M3 $barcode",
            kind,
            commerceMode,
            active,
        )
    }

    private fun createListing(jdbc: JdbcTemplate, organizationId: UUID, outletId: UUID, barcode: String): UUID {
        val listingId = UUID.randomUUID()
        insertListing(jdbc, listingId, organizationId, outletId, barcode, "PRODUCT", "COMMERCE", true)
        return listingId
    }

    private fun createSecondOutletListing(jdbc: JdbcTemplate, scenario: MerchantScenario, barcode: String): InventoryScope {
        val outletId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M3 second outlet', 'ACTIVE', TRUE)",
            outletId,
            scenario.organizationId,
        )
        jdbc.update(
            "INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'INVENTORY_WRITE', TRUE)",
            scenario.accountId,
            scenario.organizationId,
            outletId,
        )
        val listingId = createListing(jdbc, scenario.organizationId, outletId, barcode)
        return InventoryScope(scenario.organizationId, outletId, listingId)
    }

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

    private fun movementCount(jdbc: JdbcTemplate, scope: InventoryScope): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.inventory_movement WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?",
        Int::class.java,
        scope.organizationId,
        scope.outletId,
        scope.listingId,
    ) ?: 0

    private fun receiptCount(jdbc: JdbcTemplate, organizationId: UUID, actorId: UUID, key: String): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.inventory_command_receipt WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?",
        Int::class.java,
        organizationId,
        actorId,
        key,
    ) ?: 0

    private fun publicationCount(jdbc: JdbcTemplate, movementId: UUID): Int = jdbc.queryForObject(
        """
        SELECT COUNT(*) FROM mypet.outbox_event
        WHERE aggregate_type = 'INVENTORY_MOVEMENT' AND aggregate_id = ? AND event_type = 'INVENTORY_BALANCE_CHANGED'
        """.trimIndent(),
        Int::class.java,
        movementId,
    ) ?: 0

    private fun ledgerSum(jdbc: JdbcTemplate, listingId: UUID): Long = jdbc.queryForObject(
        "SELECT COALESCE(SUM(quantity_delta), 0) FROM mypet.inventory_movement WHERE listing_id = ?",
        Long::class.java,
        listingId,
    ) ?: 0L

    private fun mismatch(block: () -> Unit) {
        val failure = assertThrows(DomainException::class.java, block)
        assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", failure.code)
    }

    private fun forceInsertFailure(jdbc: JdbcTemplate, table: String, functionName: String, block: () -> Unit) {
        val triggerName = "${functionName}_trigger"
        jdbc.execute(
            "CREATE OR REPLACE FUNCTION mypet.$functionName() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''forced M3 persistence failure''; END;'",
        )
        jdbc.execute("CREATE TRIGGER $triggerName BEFORE INSERT ON mypet.$table FOR EACH ROW EXECUTE FUNCTION mypet.$functionName()")
        try {
            block()
        } finally {
            jdbc.execute("DROP TRIGGER IF EXISTS $triggerName ON mypet.$table")
            jdbc.execute("DROP FUNCTION IF EXISTS mypet.$functionName()")
        }
    }

    private fun concurrent(vararg commands: () -> StockMovement): List<Result<StockMovement>> {
        val executor = Executors.newFixedThreadPool(commands.size)
        val ready = CountDownLatch(commands.size)
        val go = CountDownLatch(1)
        return try {
            val futures = commands.map { command ->
                executor.submit(Callable {
                    ready.countDown()
                    check(go.await(10, TimeUnit.SECONDS))
                    runCatching(command)
                })
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS))
            go.countDown()
            futures.map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            go.countDown()
            executor.shutdownNow()
        }
    }

    private fun MerchantScenario.scope(): InventoryScope = InventoryScope(organizationId, outletId, listingId)

    private data class Context(
        val dataSource: DataSource,
        val jdbc: JdbcTemplate,
        val persistence: JdbcInventoryPersistence,
        val inventory: InventoryService,
        val fixture: MerchantScenarioFixture,
        val resolver: JdbcMerchantPrincipalResolver,
        val providers: ProviderService,
    )
}
