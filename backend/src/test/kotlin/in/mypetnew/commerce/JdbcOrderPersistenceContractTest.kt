package `in`.mypetnew.commerce

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.PricingSnapshot
import `in`.mypetnew.commerce.domain.Quote
import `in`.mypetnew.commerce.infrastructure.JdbcOrderPersistence
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class JdbcOrderPersistenceContractTest {
    @Test
    fun `checkout replay survives service restart and preserves one reservation`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        fixture.inventory.adjust(
            listingId,
            2,
            StockReason.RECEIPT,
            "receive-order-restart",
            UUID.randomUUID(),
            "trace-receive",
        )
        val quote = fixture.quote(listingId, quantity = 1, unitPricePaise = 12_500)
        val actor = UUID.randomUUID()

        val first = fixture.orders.checkout(
            quote,
            fixture.organizationId,
            mapOf(listingId to "Dog Food"),
            "checkout-restart",
            actor,
            "trace-checkout-1",
        )
        val restarted = OrderService(
            fixture.inventory,
            JdbcOrderPersistence(fixture.jdbc, fixture.transactions),
        )
        val replay = restarted.checkout(
            quote,
            fixture.organizationId,
            mapOf(listingId to "Dog Food"),
            "checkout-restart",
            actor,
            "trace-checkout-2",
        )

        assertEquals(first.id, replay.id)
        assertEquals(1, fixture.inventory.reserved(listingId))
        assertEquals(1, fixture.count("mypet.product_order"))
        assertEquals(1, fixture.count("mypet.inventory_reservation"))
        assertEquals(1, fixture.count("mypet.product_order_history"))
    }

    @Test
    fun `checkout key cannot be rebound to a different quote`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        fixture.inventory.adjust(
            listingId,
            3,
            StockReason.RECEIPT,
            "receive-fingerprint",
            UUID.randomUUID(),
            "trace-receive",
        )
        val actor = UUID.randomUUID()
        val firstQuote = fixture.quote(listingId, quantity = 1, unitPricePaise = 12_500)
        fixture.orders.checkout(
            firstQuote,
            fixture.organizationId,
            mapOf(listingId to "Dog Food"),
            "checkout-fingerprint",
            actor,
            "trace-checkout",
        )
        val changedQuote = fixture.quote(listingId, quantity = 2, unitPricePaise = 12_500)

        assertThrows(DomainException::class.java) {
            fixture.orders.checkout(
                changedQuote,
                fixture.organizationId,
                mapOf(listingId to "Dog Food"),
                "checkout-fingerprint",
                actor,
                "trace-retry",
            )
        }
        assertEquals(1, fixture.count("mypet.product_order"))
        assertEquals(1, fixture.inventory.reserved(listingId))
    }

    @Test
    fun `transition replay creates one history row and release happens once`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        fixture.inventory.adjust(
            listingId,
            2,
            StockReason.RECEIPT,
            "receive-reject",
            UUID.randomUUID(),
            "trace-receive",
        )
        val actor = UUID.randomUUID()
        val order = fixture.orders.checkout(
            fixture.quote(listingId, quantity = 1, unitPricePaise = 12_500),
            fixture.organizationId,
            mapOf(listingId to "Dog Food"),
            "checkout-reject",
            actor,
            "trace-checkout",
        )

        val first = fixture.orders.transition(
            order.id,
            OrderStatus.REJECTED,
            "reject-once",
            actorId = UUID.randomUUID(),
            actorRole = Role.MERCHANT,
            reason = "Item damaged during shelf verification",
            traceId = "trace-reject-1",
        )
        val replay = fixture.orders.transition(
            order.id,
            OrderStatus.REJECTED,
            "reject-once",
            actorId = UUID.randomUUID(),
            actorRole = Role.MERCHANT,
            reason = "Item damaged during shelf verification",
            traceId = "trace-reject-2",
        )

        assertEquals(OrderStatus.REJECTED, first.status)
        assertEquals(first.id, replay.id)
        assertEquals(2, fixture.inventory.available(listingId))
        assertEquals(0, fixture.inventory.reserved(listingId))
        assertEquals(2, fixture.count("mypet.product_order_history"))
        assertEquals(3, fixture.inventory.history(listingId).size)
    }

    @Test
    fun `ready order cannot skip pickup handover`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        fixture.inventory.adjust(
            listingId,
            1,
            StockReason.RECEIPT,
            "receive-handover",
            UUID.randomUUID(),
            "trace-receive",
        )
        val order = fixture.orders.checkout(
            fixture.quote(listingId, quantity = 1, unitPricePaise = 12_500),
            fixture.organizationId,
            mapOf(listingId to "Dog Food"),
            "checkout-handover",
            UUID.randomUUID(),
            "trace-checkout",
        )
        fixture.orders.transition(order.id, OrderStatus.ACCEPTED, "accept", actorRole = Role.MERCHANT)
        fixture.orders.transition(order.id, OrderStatus.PREPARING, "prepare", actorRole = Role.MERCHANT)
        fixture.orders.transition(order.id, OrderStatus.READY_FOR_PICKUP, "ready", actorRole = Role.MERCHANT)

        assertThrows(DomainException::class.java) {
            fixture.orders.transition(order.id, OrderStatus.DELIVERED, "skip-pickup", actorRole = Role.MERCHANT)
        }
        assertEquals(OrderStatus.READY_FOR_PICKUP, fixture.orders.get(order.id).status)
        assertEquals(1, fixture.inventory.reserved(listingId))
    }

    @Test
    fun `concurrent accept commands produce one winner and one canonical state`() {
        val fixture = fixture()
        val listingId = fixture.createListing()
        fixture.inventory.adjust(
            listingId,
            1,
            StockReason.RECEIPT,
            "receive-accept-race",
            UUID.randomUUID(),
            "trace-receive",
        )
        val order = fixture.orders.checkout(
            fixture.quote(listingId, quantity = 1, unitPricePaise = 12_500),
            fixture.organizationId,
            mapOf(listingId to "Dog Food"),
            "checkout-accept-race",
            UUID.randomUUID(),
            "trace-checkout",
        )
        val executor = Executors.newFixedThreadPool(2)

        try {
            val results = executor.invokeAll(
                listOf(
                    Callable {
                        runCatching {
                            fixture.orders.transition(
                                order.id,
                                OrderStatus.ACCEPTED,
                                "accept-a",
                                actorRole = Role.MERCHANT,
                                traceId = "trace-accept-a",
                            )
                        }.isSuccess
                    },
                    Callable {
                        runCatching {
                            fixture.orders.transition(
                                order.id,
                                OrderStatus.ACCEPTED,
                                "accept-b",
                                actorRole = Role.MERCHANT,
                                traceId = "trace-accept-b",
                            )
                        }.isSuccess
                    },
                ),
            ).map { it.get() }

            assertEquals(1, results.count { it })
            assertEquals(OrderStatus.ACCEPTED, fixture.orders.get(order.id).status)
            assertEquals(2, fixture.count("mypet.product_order_history"))
        } finally {
            executor.shutdownNow()
        }
    }

    private fun fixture(): Fixture {
        val databaseName = "orders_${UUID.randomUUID().toString().replace("-", "")}"
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:$databaseName;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
            "sa",
            "",
        )
        val jdbc = JdbcTemplate(dataSource)
        jdbc.execute("CREATE SCHEMA mypet")
        createSchema(jdbc)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
        val orders = OrderService(inventory, JdbcOrderPersistence(jdbc, transactions))
        return Fixture(
            jdbc = jdbc,
            transactions = transactions,
            inventory = inventory,
            orders = orders,
            organizationId = UUID.randomUUID(),
            outletId = UUID.randomUUID(),
        )
    }

    private fun createSchema(jdbc: JdbcTemplate) {
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
                CONSTRAINT uq_inventory_movement_idempotency UNIQUE (outlet_id, idempotency_key),
                CHECK (resulting_on_hand >= resulting_reserved),
                CHECK (resulting_reserved >= 0)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order (
                id UUID PRIMARY KEY,
                order_number VARCHAR(32) NOT NULL UNIQUE,
                customer_id UUID NOT NULL,
                organization_id UUID NOT NULL,
                outlet_id UUID NOT NULL,
                quote_id UUID NOT NULL,
                status VARCHAR(32) NOT NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                payment_method VARCHAR(40) NOT NULL,
                payment_status VARCHAR(40) NOT NULL,
                grand_total_paise BIGINT NOT NULL,
                platform_fee_paise BIGINT NOT NULL,
                merchant_commission_paise BIGINT NOT NULL,
                currency VARCHAR(3) NOT NULL DEFAULT 'INR',
                version BIGINT NOT NULL DEFAULT 0,
                checkout_idempotency_key VARCHAR(128),
                checkout_request_fingerprint VARCHAR(64),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_order_checkout UNIQUE (customer_id, checkout_idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order_line (
                order_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                listing_name VARCHAR(160) NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price_paise BIGINT NOT NULL,
                PRIMARY KEY (order_id, listing_id)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.product_order_history (
                id UUID PRIMARY KEY,
                order_id UUID NOT NULL,
                from_status VARCHAR(32),
                to_status VARCHAR(32) NOT NULL,
                actor_id UUID NOT NULL,
                actor_role VARCHAR(32) NOT NULL,
                reason VARCHAR(240),
                idempotency_key VARCHAR(128) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_order_history_command UNIQUE (order_id, idempotency_key)
            )
            """.trimIndent(),
        )
        jdbc.execute(
            """
            CREATE TABLE mypet.inventory_reservation (
                id UUID PRIMARY KEY,
                order_id UUID NOT NULL,
                listing_id UUID NOT NULL,
                quantity INTEGER NOT NULL,
                status VARCHAR(24) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_order_listing_reservation UNIQUE (order_id, listing_id)
            )
            """.trimIndent(),
        )
    }

    private data class Fixture(
        val jdbc: JdbcTemplate,
        val transactions: TransactionTemplate,
        val inventory: InventoryService,
        val orders: OrderService,
        val organizationId: UUID,
        val outletId: UUID,
    ) {
        fun createListing(): UUID {
            val listingId = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO mypet.catalog_listing (id, outlet_id) VALUES (?, ?)",
                listingId,
                outletId,
            )
            return listingId
        }

        fun quote(listingId: UUID, quantity: Int, unitPricePaise: Long): Quote {
            val subtotal = Math.multiplyExact(quantity.toLong(), unitPricePaise)
            return Quote(
                id = UUID.randomUUID(),
                customerId = UUID.randomUUID(),
                outletId = outletId,
                lines = mapOf(listingId to Pair(quantity, unitPricePaise)),
                cartSignature = UUID.randomUUID().toString(),
                pricing = PricingSnapshot(
                    itemSubtotalPaise = subtotal,
                    grandTotalPaise = Math.addExact(subtotal, 1_000),
                ),
                expiresAt = Instant.now().plusSeconds(300),
            )
        }

        fun count(table: String): Int = jdbc.queryForObject("SELECT COUNT(*) FROM $table", Int::class.java) ?: 0
    }
}
