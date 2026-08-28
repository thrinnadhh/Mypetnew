package `in`.mypetnew.merchantops

import `in`.mypetnew.application.web.InventoryAdjustmentRequest
import `in`.mypetnew.application.web.MerchantInventoryController
import `in`.mypetnew.application.web.MerchantSyncController
import `in`.mypetnew.application.web.ResolveReceiptRequest
import `in`.mypetnew.catalog.domain.BarcodeType
import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CreateListingCommand
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcMerchantSyncFeed
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.infrastructure.JdbcProviderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.support.TransactionTemplate
import java.io.File
import java.sql.DriverManager
import java.util.UUID

@MerchantOpsContract
@MerchantOpsPostgres
class M6ConnectedUnknownOutcomePostgresContractTest {

    private data class Context(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val catalog: CatalogService,
        val inventory: InventoryService,
        val providers: ProviderService,
        val syncFeed: JdbcMerchantSyncFeed,
        val inventoryController: MerchantInventoryController,
        val syncController: MerchantSyncController,
    )

    private fun context(): Context {
        PostgresTestDatabase.resetAndMigrate()
        val dataSource = PostgresTestDatabase.dataSource()
        val jdbc = JdbcTemplate(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val syncFeed = JdbcMerchantSyncFeed(jdbc, cursorSecret = "test-sync-cursor-secret-at-least-32-chars-long")
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions, syncFeed))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions, syncFeed))
        val providers = ProviderService(JdbcProviderPersistence(jdbc, transactions))
        val inventoryController = MerchantInventoryController(providers, catalog, inventory)
        val syncController = MerchantSyncController(providers, syncFeed, jdbc)

        return Context(
            jdbc = jdbc,
            transactions = transactions,
            catalog = catalog,
            inventory = inventory,
            providers = providers,
            syncFeed = syncFeed,
            inventoryController = inventoryController,
            syncController = syncController,
        )
    }

    private fun createMerchant(jdbc: JdbcTemplate, mobile: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, ?, 'MERCHANT', 'ACTIVE')", id, mobile)
        return id
    }

    private fun seedScope(jdbc: JdbcTemplate, actorId: UUID): Pair<UUID, UUID> {
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update("INSERT INTO mypet.merchant_organization(id, name, status, owner_actor_id) VALUES (?, 'M6 Org', 'ACTIVE', ?)", organizationId, actorId)
        jdbc.update("INSERT INTO mypet.provider_outlet(id, organization_id, name, status, pickup_enabled) VALUES (?, ?, 'M6 Outlet', 'ACTIVE', TRUE)", outletId, organizationId)
        jdbc.update("INSERT INTO mypet.outlet_capability(outlet_id, capability, verified) VALUES (?, 'PRODUCT_STORE', TRUE)", outletId)
        jdbc.update("INSERT INTO mypet.merchant_staff(account_id, organization_id, outlet_id, permission, active) VALUES (?, ?, ?, 'OWNER', TRUE)", actorId, organizationId, outletId)
        return organizationId to outletId
    }

    private fun auth(
        actorId: UUID,
        organizationId: UUID,
        outletId: UUID,
        permissions: Set<MerchantPermission> = setOf(MerchantPermission.OWNER),
    ) = UsernamePasswordAuthenticationToken(
        Principal(
            actorId = actorId,
            role = Role.MERCHANT,
            organizationId = organizationId,
            outletIds = setOf(outletId),
            merchantPermissionsByOutlet = mapOf(outletId to permissions),
        ),
        null,
        emptyList(),
    )

    private fun initSqliteSchema(sqliteConn: java.sql.Connection) {
        sqliteConn.createStatement().use { stmt ->
            stmt.execute("PRAGMA journal_mode = WAL;")
            stmt.execute(
                """
                CREATE TABLE IF NOT EXISTS offline_commands (
                    account_id TEXT NOT NULL,
                    organization_id TEXT NOT NULL,
                    outlet_id TEXT NOT NULL,
                    command_id TEXT NOT NULL,
                    installation_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    command_type TEXT NOT NULL,
                    payload_schema_version INTEGER NOT NULL DEFAULT 1,
                    payload_json TEXT NOT NULL,
                    request_fingerprint TEXT NOT NULL,
                    state TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_attempt_at TEXT,
                    next_attempt_at TEXT,
                    lease_owner TEXT,
                    lease_expires_at TEXT,
                    last_error_code TEXT,
                    last_error_details TEXT,
                    durable_server_receipt TEXT,
                    resulting_version INTEGER,
                    PRIMARY KEY (account_id, organization_id, outlet_id, command_id)
                );
                """.trimIndent()
            )
        }
    }

    @Test
    fun `M6-SYNC-001 connected unknown outcome recovery with SQLite file, network loss, restart, and receipt resolution`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000001")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val authentication = auth(actorId, organizationId, outletId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-CONN-1",
                name = "Connected Unknown Outcome Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 1000,
                sellingPricePaise = 900,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "conn_item_1",
            actorId,
        )

        // 1. Create a real SQLite database file on disk
        val tempFile = File.createTempFile("mypet-test-outbox-", ".db")
        tempFile.deleteOnExit()
        val sqliteUrl = "jdbc:sqlite:${tempFile.absolutePath}"

        val commandId = UUID.randomUUID().toString()
        val idempotencyKey = "idemp_unknown_outcome_101"

        // Initialize SQLite schema and enqueue PENDING offline command
        DriverManager.getConnection(sqliteUrl).use { conn ->
            initSqliteSchema(conn)
            conn.prepareStatement(
                """
                INSERT INTO offline_commands (
                    account_id, organization_id, outlet_id, command_id, installation_id,
                    idempotency_key, command_type, payload_schema_version, payload_json,
                    request_fingerprint, state, attempt_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'inst_1', ?, 'INVENTORY_ADJUSTMENT', 1, ?, 'fp_conn_1', 'PENDING', 0, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');
                """.trimIndent()
            ).use { stmt ->
                stmt.setString(1, actorId.toString())
                stmt.setString(2, organizationId.toString())
                stmt.setString(3, outletId.toString())
                stmt.setString(4, commandId)
                stmt.setString(5, idempotencyKey)
                stmt.setString(6, """{"outletId":"$outletId","listingId":"${item.id}","quantityDelta":15,"reason":"MANUAL_INCREASE"}""")
                stmt.executeUpdate()
            }
        }

        // 2. Dispatch command: client sends request to real controller, PostgreSQL commits
        val adjustResponse = ctx.inventoryController.adjust(
            authentication = authentication,
            idempotencyKey = idempotencyKey,
            commandTypeHeader = "INVENTORY_ADJUSTMENT",
            schemaVersionHeader = "1",
            request = InventoryAdjustmentRequest(
                outletId = outletId,
                listingId = item.id,
                quantityDelta = 15,
                reason = StockReason.MANUAL_INCREASE,
            ),
        )
        assertEquals(15, adjustResponse.resultingOnHand)

        // 3. FAILURE INJECTION: Simulate client network drop / process crash before client can ACK local SQLite outbox.
        // Simulate lease expiration / RETRYABLE state on the SQLite file
        DriverManager.getConnection(sqliteUrl).use { conn ->
            conn.prepareStatement(
                """
                UPDATE offline_commands
                SET state = 'RETRYABLE', attempt_count = 1, last_attempt_at = '2026-08-28T00:00:01Z'
                WHERE command_id = ?;
                """.trimIndent()
            ).use { stmt ->
                stmt.setString(1, commandId)
                stmt.executeUpdate()
            }
        }

        // 4. RECOVERY AFTER RESTART: Reopen SQLite file, recover unresolved command
        var recoveredCommandId: String? = null
        var recoveredKey: String? = null
        DriverManager.getConnection(sqliteUrl).use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery("SELECT command_id, idempotency_key, state FROM offline_commands WHERE state = 'RETRYABLE';")
                if (rs.next()) {
                    recoveredCommandId = rs.getString("command_id")
                    recoveredKey = rs.getString("idempotency_key")
                }
            }
        }
        assertEquals(commandId, recoveredCommandId)
        assertEquals(idempotencyKey, recoveredKey)

        // 5. Recover via POST /api/v1/merchant/sync/receipts/resolve
        val receiptResponse = ctx.syncController.resolveReceipt(
            authentication = authentication,
            request = ResolveReceiptRequest(
                idempotencyKey = idempotencyKey,
                commandType = "INVENTORY_ADJUSTMENT",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "listingId" to item.id.toString(),
                    "quantityDelta" to 15,
                    "reason" to "MANUAL_INCREASE",
                ),
            ),
        )
        assertEquals("ACCEPTED", receiptResponse.status)
        assertEquals(15, receiptResponse.resultingOnHand)
        assertNotNull(receiptResponse.receiptId)

        // 6. Write durable local receipt + ACK into SQLite
        DriverManager.getConnection(sqliteUrl).use { conn ->
            conn.prepareStatement(
                """
                UPDATE offline_commands
                SET state = 'ACKNOWLEDGED', durable_server_receipt = ?, updated_at = '2026-08-28T00:00:02Z'
                WHERE command_id = ?;
                """.trimIndent()
            ).use { stmt ->
                stmt.setString(1, receiptResponse.receiptId)
                stmt.setString(2, commandId)
                stmt.executeUpdate()
            }
        }

        // Verify SQLite state is now ACKNOWLEDGED
        var finalState: String? = null
        DriverManager.getConnection(sqliteUrl).use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery("SELECT state, durable_server_receipt FROM offline_commands WHERE command_id = '$commandId';")
                if (rs.next()) {
                    finalState = rs.getString("state")
                }
            }
        }
        assertEquals("ACKNOWLEDGED", finalState)

        // 7. Strictly verify PostgreSQL state:
        // Exactly 1 movement in inventory_movement
        val movementCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key = ?",
            Long::class.java,
            idempotencyKey,
        )
        assertEquals(1L, movementCount)

        // Exactly 1 receipt in inventory_command_receipt
        val receiptCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_command_receipt WHERE idempotency_key = ?",
            Long::class.java,
            idempotencyKey,
        )
        assertEquals(1L, receiptCount)

        // Balance on_hand is exactly 15
        val balanceOnHand = ctx.jdbc.queryForObject(
            "SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?",
            Int::class.java,
            item.id,
        )
        assertEquals(15, balanceOnHand)
    }

    @Test
    fun `M6-SYNC-001 ACK write loss recovery - server commits, failure injected before SQLite ACK, recovers on reopen`() {
        val ctx = context()
        val actorId = createMerchant(ctx.jdbc, "+919330000002")
        val (organizationId, outletId) = seedScope(ctx.jdbc, actorId)
        val authentication = auth(actorId, organizationId, outletId)

        val item = ctx.catalog.createListing(
            CreateListingCommand(
                organizationId = organizationId,
                outletId = outletId,
                barcodeType = BarcodeType.INTERNAL,
                barcode = "SKU-ACK-LOSS-1",
                name = "Ack Write Loss Item",
                kind = ListingKind.PRODUCT,
                mrpPaise = 1000,
                sellingPricePaise = 900,
                category = "food",
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            "ack_loss_item_1",
            actorId,
        )

        val tempFile = File.createTempFile("mypet-test-ackloss-", ".db")
        tempFile.deleteOnExit()
        val sqliteUrl = "jdbc:sqlite:${tempFile.absolutePath}"

        val commandId = UUID.randomUUID().toString()
        val idempotencyKey = "idemp_ack_loss_202"

        DriverManager.getConnection(sqliteUrl).use { conn ->
            initSqliteSchema(conn)
            conn.prepareStatement(
                """
                INSERT INTO offline_commands (
                    account_id, organization_id, outlet_id, command_id, installation_id,
                    idempotency_key, command_type, payload_schema_version, payload_json,
                    request_fingerprint, state, attempt_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'inst_1', ?, 'INVENTORY_ADJUSTMENT', 1, ?, 'fp_ack_1', 'SENDING', 1, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');
                """.trimIndent()
            ).use { stmt ->
                stmt.setString(1, actorId.toString())
                stmt.setString(2, organizationId.toString())
                stmt.setString(3, outletId.toString())
                stmt.setString(4, commandId)
                stmt.setString(5, idempotencyKey)
                stmt.setString(6, """{"outletId":"$outletId","listingId":"${item.id}","quantityDelta":20,"reason":"MANUAL_INCREASE"}""")
                stmt.executeUpdate()
            }
        }

        // Server commits mutation to Postgres
        val response = ctx.inventoryController.adjust(
            authentication = authentication,
            idempotencyKey = idempotencyKey,
            commandTypeHeader = "INVENTORY_ADJUSTMENT",
            schemaVersionHeader = "1",
            request = InventoryAdjustmentRequest(
                outletId = outletId,
                listingId = item.id,
                quantityDelta = 20,
                reason = StockReason.MANUAL_INCREASE,
            ),
        )
        assertEquals(20, response.resultingOnHand)

        // INJECT FAILURE: Client receives success from server, but DB write fails/crashes before ACK commits!
        // (Simulate by closing connection without updating state to ACKNOWLEDGED).
        // Later restart occurs:
        DriverManager.getConnection(sqliteUrl).use { conn ->
            conn.prepareStatement(
                "UPDATE offline_commands SET state = 'RETRYABLE' WHERE command_id = ?;"
            ).use { stmt ->
                stmt.setString(1, commandId)
                stmt.executeUpdate()
            }
        }

        // Client recovers via resolveReceipt
        val receipt = ctx.syncController.resolveReceipt(
            authentication = authentication,
            request = ResolveReceiptRequest(
                idempotencyKey = idempotencyKey,
                commandType = "INVENTORY_ADJUSTMENT",
                payloadSchemaVersion = 1,
                payload = mapOf(
                    "outletId" to outletId.toString(),
                    "listingId" to item.id.toString(),
                    "quantityDelta" to 20,
                    "reason" to "MANUAL_INCREASE",
                ),
            ),
        )
        assertEquals("ACCEPTED", receipt.status)
        assertEquals(20, receipt.resultingOnHand)

        // Local ACK succeeds
        DriverManager.getConnection(sqliteUrl).use { conn ->
            conn.prepareStatement(
                "UPDATE offline_commands SET state = 'ACKNOWLEDGED', durable_server_receipt = ? WHERE command_id = ?;"
            ).use { stmt ->
                stmt.setString(1, receipt.receiptId)
                stmt.setString(2, commandId)
                stmt.executeUpdate()
            }
        }

        // Assert strictly singular effect on PostgreSQL
        val movementCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_movement WHERE idempotency_key = ?",
            Long::class.java,
            idempotencyKey,
        )
        assertEquals(1L, movementCount)

        val receiptCount = ctx.jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_command_receipt WHERE idempotency_key = ?",
            Long::class.java,
            idempotencyKey,
        )
        assertEquals(1L, receiptCount)

        val balanceOnHand = ctx.jdbc.queryForObject(
            "SELECT on_hand FROM mypet.inventory_balance WHERE listing_id = ?",
            Int::class.java,
            item.id,
        )
        assertEquals(20, balanceOnHand)
    }
}
