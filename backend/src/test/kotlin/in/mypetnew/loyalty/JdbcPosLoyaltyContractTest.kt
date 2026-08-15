package `in`.mypetnew.loyalty

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.loyalty.infrastructure.JdbcLoyaltyPersistence
import `in`.mypetnew.pos.domain.PaymentDeclaration
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.pos.infrastructure.JdbcPosPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class JdbcPosLoyaltyContractTest {
    @Test
    fun `POS replay survives restart with one sale movement and loyalty source`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        fixture.inventory.adjust(
            listingId,
            2,
            StockReason.RECEIPT,
            "receive-pos-restart",
            UUID.randomUUID(),
            "trace-receive",
        )
        val customerId = fixture.createCustomer()
        val cashierId = UUID.randomUUID()

        val first = fixture.pos.complete(
            merchantId = fixture.organizationId,
            outletId = fixture.outletId,
            customerId = customerId,
            lines = mapOf(listingId to Pair(1, 10_000L)),
            payment = PaymentDeclaration.CASH,
            idempotencyKey = "pos-restart",
            listingNames = mapOf(listingId to "Dog Food"),
            cashierId = cashierId,
            traceId = "trace-pos-1",
        )
        val restarted = PosService(
            fixture.inventory,
            LoyaltyService(JdbcLoyaltyPersistence(fixture.jdbc, fixture.transactions)),
            JdbcPosPersistence(fixture.jdbc, fixture.transactions),
        )
        val replay = restarted.complete(
            merchantId = fixture.organizationId,
            outletId = fixture.outletId,
            customerId = customerId,
            lines = mapOf(listingId to Pair(1, 10_000L)),
            payment = PaymentDeclaration.CASH,
            idempotencyKey = "pos-restart",
            listingNames = mapOf(listingId to "Dog Food"),
            cashierId = cashierId,
            traceId = "trace-pos-2",
        )

        assertEquals(first.id, replay.id)
        assertEquals(1, fixture.count("mypet.pos_sale"))
        assertEquals(1, fixture.count("mypet.pos_sale_line"))
        assertEquals(1, fixture.count("mypet.loyalty_source"))
        assertEquals(1, fixture.loyalty.balance(customerId, fixture.organizationId))
        assertEquals(1, fixture.inventory.available(listingId))
    }

    @Test
    fun `two POS completions racing for final unit produce one receipt and one stock movement`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        fixture.inventory.adjust(
            listingId,
            1,
            StockReason.RECEIPT,
            "receive-pos-race",
            UUID.randomUUID(),
            "trace-receive",
        )
        val executor = Executors.newFixedThreadPool(2)

        try {
            val results = executor.invokeAll(
                listOf(
                    Callable {
                        runCatching {
                            fixture.pos.complete(
                                merchantId = fixture.organizationId,
                                outletId = fixture.outletId,
                                customerId = null,
                                lines = mapOf(listingId to Pair(1, 10_000L)),
                                payment = PaymentDeclaration.CASH,
                                idempotencyKey = "pos-race-a",
                                listingNames = mapOf(listingId to "Dog Food"),
                                cashierId = UUID.randomUUID(),
                                traceId = "trace-pos-a",
                            )
                        }.isSuccess
                    },
                    Callable {
                        runCatching {
                            fixture.pos.complete(
                                merchantId = fixture.organizationId,
                                outletId = fixture.outletId,
                                customerId = null,
                                lines = mapOf(listingId to Pair(1, 10_000L)),
                                payment = PaymentDeclaration.EXTERNAL_UPI,
                                idempotencyKey = "pos-race-b",
                                listingNames = mapOf(listingId to "Dog Food"),
                                cashierId = UUID.randomUUID(),
                                traceId = "trace-pos-b",
                            )
                        }.isSuccess
                    },
                ),
            ).map { it.get() }

            assertEquals(1, results.count { it })
            assertEquals(1, fixture.count("mypet.pos_sale"))
            assertEquals(0, fixture.inventory.available(listingId))
            assertEquals(2, fixture.inventory.history(listingId).size)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `concurrent tenth and eleventh persistent awards issue one reward and retain one star`() {
        val fixture = fixture()
        val customerId = fixture.createCustomer()
        repeat(9) { index ->
            fixture.loyalty.award(customerId, fixture.organizationId, "SEED:$index", 10_000)
        }
        val executor = Executors.newFixedThreadPool(2)

        try {
            executor.invokeAll(
                listOf(
                    Callable { fixture.loyalty.award(customerId, fixture.organizationId, "POS:A", 10_000) },
                    Callable { fixture.loyalty.award(customerId, fixture.organizationId, "POS:B", 10_000) },
                ),
            ).forEach { it.get() }

            assertEquals(1, fixture.loyalty.balance(customerId, fixture.organizationId))
            assertEquals(1, fixture.loyalty.rewards(customerId, fixture.organizationId).size)
            assertEquals(11, fixture.count("mypet.loyalty_source"))
            assertEquals(12, fixture.count("mypet.loyalty_ledger"))
        } finally {
            executor.shutdownNow()
        }
    }

    private fun fixture(): Fixture {
        val databaseName = "pos_${UUID.randomUUID().toString().replace("-", "")}"
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:$databaseName;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
            "sa",
            "",
        )
        val jdbc = JdbcTemplate(dataSource)
        jdbc.execute("CREATE SCHEMA mypet")
        createSchema(jdbc)
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO mypet.merchant_organization (
                id, minimum_loyalty_spend_paise, reward_amount_paise, loyalty_rule_version
            ) VALUES (?, 10000, 5000, 's1-v1')
            """.trimIndent(),
            organizationId,
        )
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
        val loyalty = LoyaltyService(JdbcLoyaltyPersistence(jdbc, transactions))
        val pos = PosService(inventory, loyalty, JdbcPosPersistence(jdbc, transactions))
        return Fixture(jdbc, transactions, inventory, loyalty, pos, organizationId, outletId)
    }

    private fun createSchema(jdbc: JdbcTemplate) {
        jdbc.execute(
            """
            CREATE TABLE mypet.identity_account (
                id UUID PRIMARY KEY
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.merchant_organization (
                id UUID PRIMARY KEY,
                minimum_loyalty_spend_paise BIGINT NOT NULL,
                reward_amount_paise BIGINT NOT NULL,
                loyalty_rule_version VARCHAR(48) NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.catalog_listing (
                id UUID PRIMARY KEY,
                outlet_id UUID NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_balance (
                listing_id UUID PRIMARY KEY,
                on_hand INTEGER NOT NULL DEFAULT 0,
                reserved INTEGER NOT NULL DEFAULT 0,
                version BIGINT NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (on_hand >= 0),
                CHECK (reserved >= 0),
                CHECK (on_hand >= reserved)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_movement (
                id UUID PRIMARY KEY,
                listing_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                reason VARCHAR(40) NOT NULL,
                quantity_delta INTEGER NOT NULL,
                resulting_on_hand INTEGER NOT NULL,
                resulting_reserved INTEGER NOT NULL,
                source_type VARCHAR(40) NOT NULL,
                source_reference VARCHAR(160) NOT NULL,
                actor_id UUID NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                operation_scope VARCHAR(40) NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_inventory_movement_idempotency UNIQUE (outlet_id, idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.loyalty_relationship (
                customer_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                available_stars INTEGER NOT NULL DEFAULT 0,
                star_debt INTEGER NOT NULL DEFAULT 0,
                version BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (customer_id, organization_id)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.loyalty_source (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                outlet_id UUID,
                source_type VARCHAR(40) NOT NULL,
                source_reference VARCHAR(160) NOT NULL,
                eligible_spend_paise BIGINT NOT NULL,
                rule_version VARCHAR(48) NOT NULL,
                awarded BOOLEAN NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_loyalty_source UNIQUE (customer_id, organization_id, source_type, source_reference)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.loyalty_ledger (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                source_id UUID,
                entry_type VARCHAR(32) NOT NULL,
                star_delta INTEGER NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.loyalty_reward (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                amount_paise BIGINT NOT NULL,
                status VARCHAR(24) NOT NULL,
                rule_version VARCHAR(48) NOT NULL,
                issued_at TIMESTAMP WITH TIME ZONE NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.pos_sale (
                id UUID PRIMARY KEY,
                sale_number VARCHAR(32) NOT NULL UNIQUE,
                organization_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                customer_id UUID,
                cashier_id UUID NOT NULL,
                total_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL DEFAULT 'INR',
                payment_declaration VARCHAR(32) NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                request_fingerprint VARCHAR(64),
                loyalty_awarded BOOLEAN NOT NULL DEFAULT FALSE,
                trace_id VARCHAR(64) NOT NULL,
                completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_pos_outlet_idempotency UNIQUE (outlet_id, idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.pos_sale_line (
                sale_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                listing_name VARCHAR(160) NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price_paise BIGINT NOT NULL,
                PRIMARY KEY (sale_id, listing_id)
            )
            """.trimIndent(),
        )
    }

    private data class Fixture(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val inventory: InventoryService,
        val loyalty: LoyaltyService,
        val pos: PosService,
        val organizationId: UUID,
        val outletId: UUID,
    ) {
        fun createListing(): UUID {
            val id = UUID.randomUUID()
            jdbc.update("INSERT INTO mypet.catalog_listing (id, outlet_id) VALUES (?, ?)", id, outletId)
            return id
        }

        fun createCustomer(): UUID {
            val id = UUID.randomUUID()
            jdbc.update("INSERT INTO mypet.identity_account (id) VALUES (?)", id)
            return id
        }

        fun count(table: String): Int = jdbc.queryForObject("SELECT COUNT(*) FROM $table", Int::class.java) ?: 0
    }
}
