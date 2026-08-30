package `in`.mypetnew.merchantops

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.UpdateListingCommand
import `in`.mypetnew.catalog.infrastructure.JdbcCatalogPersistence
import `in`.mypetnew.catalog.infrastructure.JdbcInventoryPersistence
import `in`.mypetnew.commerce.domain.CommerceListingAuthority
import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.Quote
import `in`.mypetnew.commerce.domain.QuoteService
import `in`.mypetnew.commerce.infrastructure.JdbcCommerceListingAuthority
import `in`.mypetnew.commerce.infrastructure.JdbcOrderPersistence
import `in`.mypetnew.commerce.infrastructure.JdbcQuotePersistence
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.loyalty.domain.LoyaltyService
import `in`.mypetnew.loyalty.infrastructure.JdbcLoyaltyPersistence
import `in`.mypetnew.merchantops.testsupport.MerchantOpsConcurrency
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.MerchantScenario
import `in`.mypetnew.merchantops.testsupport.MerchantScenarioFixture
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import `in`.mypetnew.pos.domain.CustomerAssociationChallengeService
import `in`.mypetnew.pos.domain.PaymentDeclaration
import `in`.mypetnew.pos.domain.PosSale
import `in`.mypetnew.pos.domain.PosService
import `in`.mypetnew.pos.infrastructure.JdbcCustomerAssociationPersistence
import `in`.mypetnew.pos.infrastructure.JdbcPosPersistence
import `in`.mypetnew.provider.domain.ProviderCapability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@MerchantOpsPostgres
@MerchantOpsConcurrency
class M9OrderPosConcurrencyPostgresContractTest {
    private val dataSource = PostgresTestDatabase.dataSource()
    private val jdbc = JdbcTemplate(dataSource)
    private val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
    private val inventory = InventoryService(JdbcInventoryPersistence(jdbc, transactions))
    private val listingAuthority = JdbcCommerceListingAuthority(jdbc)
    private val fixture = MerchantScenarioFixture(dataSource)

    @BeforeEach
    fun resetDatabase() {
        PostgresTestDatabase.resetAndMigrate()
    }

    @Test
    fun `M9 POS versus order final unit has one durable winner and no loser residue`() {
        val scenario = fixture.create()
        seedStock(scenario, 1, "m9-final-unit-seed")
        val customerId = createCustomer()
        val quote = pickupQuote(scenario, customerId, 1, 9_000)
        val services = services()
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val futures = listOf(
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching {
                        services.orders.checkout(
                            quote = quote,
                            organizationId = scenario.organizationId,
                            listingNames = mapOf(scenario.listingId to "stale caller name"),
                            idempotencyKey = "m9-order-final-unit",
                            actorId = customerId,
                            traceId = "trace-m9-order-final-unit",
                        )
                    }
                }),
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching {
                        services.pos.complete(
                            merchantId = scenario.organizationId,
                            outletId = scenario.outletId,
                            customerId = null,
                            lines = mapOf(scenario.listingId to (1 to 9_000L)),
                            payment = PaymentDeclaration.CASH,
                            idempotencyKey = "m9-pos-final-unit",
                            listingNames = mapOf(scenario.listingId to "stale caller name"),
                            cashierId = scenario.accountId,
                            traceId = "trace-m9-pos-final-unit",
                        )
                    }
                }),
            )
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val results = futures.map { it.get(15, TimeUnit.SECONDS) }

            assertEquals(1, results.count { it.isSuccess }, results.map { it.exceptionOrNull() }.toString())
            assertEquals(1, count("mypet.product_order") + count("mypet.pos_sale"))
            assertEquals(count("mypet.product_order"), countWhere("mypet.inventory_reservation", "status = 'RESERVED'"))
            assertEquals(count("mypet.product_order"), countWhere("mypet.inventory_movement", "reason = 'ORDER_RESERVE'"))
            assertEquals(count("mypet.pos_sale"), countWhere("mypet.inventory_movement", "reason = 'POS_SALE'"))
            assertEquals(2, inventory.history(scenario.listingId).size)
            assertEquals(0, inventory.available(scenario.listingId))
            inventory.requireReconciled(scope(scenario))
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `M9 POS holds catalog price stable while completion commits then next sale reprices online`() {
        val scenario = fixture.create()
        seedStock(scenario, 2, "m9-pos-price-seed")
        val lockHeld = CountDownLatch(1)
        val allowCompletion = CountDownLatch(1)
        val blockingAuthority = CommerceListingAuthority { ids ->
            val locked = listingAuthority.lockForCommerce(ids)
            lockHeld.countDown()
            check(allowCompletion.await(5, TimeUnit.SECONDS))
            locked
        }
        val firstPos = services(blockingAuthority).pos
        val executor = Executors.newFixedThreadPool(2)
        val updateConnection = dataSource.connection

        try {
            val firstSaleFuture = executor.submit(Callable {
                firstPos.complete(
                    merchantId = scenario.organizationId,
                    outletId = scenario.outletId,
                    customerId = null,
                    lines = mapOf(scenario.listingId to (1 to 1L)),
                    payment = PaymentDeclaration.CARD_TERMINAL,
                    idempotencyKey = "m9-pos-price-first",
                    listingNames = mapOf(scenario.listingId to "caller supplied name"),
                    cashierId = scenario.accountId,
                    traceId = "trace-m9-pos-price-first",
                )
            })
            assertTrue(lockHeld.await(5, TimeUnit.SECONDS), "POS must hold the catalog row before price update")

            updateConnection.autoCommit = false
            val updatePid = backendPid(updateConnection)
            val updateFuture = executor.submit(Callable {
                updateConnection.prepareStatement(
                    "UPDATE mypet.catalog_listing SET selling_price_paise = 8500, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                ).use { statement ->
                    statement.setObject(1, scenario.listingId)
                    statement.executeUpdate()
                }
            })
            awaitDatabaseLock(updatePid)
            assertFalse(updateFuture.isDone, "price update must wait behind the POS catalog lock")

            allowCompletion.countDown()
            val firstSale = firstSaleFuture.get(10, TimeUnit.SECONDS)
            assertEquals(9_000, firstSale.totalPaise)
            assertEquals(9_000, firstSale.lines.getValue(scenario.listingId).second)
            assertEquals(1, updateFuture.get(10, TimeUnit.SECONDS))
            updateConnection.commit()

            val secondSale = services().pos.complete(
                merchantId = scenario.organizationId,
                outletId = scenario.outletId,
                customerId = null,
                lines = mapOf(scenario.listingId to (1 to 9_000L)),
                payment = PaymentDeclaration.CASH,
                idempotencyKey = "m9-pos-price-second",
                listingNames = mapOf(scenario.listingId to "old cached name"),
                cashierId = scenario.accountId,
                traceId = "trace-m9-pos-price-second",
            )
            assertEquals(8_500, secondSale.totalPaise)
            assertEquals(8_500, secondSale.lines.getValue(scenario.listingId).second)
            assertEquals(8_500, jdbc.queryForObject(
                "SELECT unit_price_paise FROM mypet.pos_sale_line WHERE sale_id = ?",
                Long::class.java,
                secondSale.id,
            ))

            val replay = services().pos.complete(
                merchantId = scenario.organizationId,
                outletId = scenario.outletId,
                customerId = null,
                lines = mapOf(scenario.listingId to (1 to 8_500L)),
                payment = PaymentDeclaration.CARD_TERMINAL,
                idempotencyKey = "m9-pos-price-first",
                listingNames = mapOf(scenario.listingId to "new cached name"),
                cashierId = scenario.accountId,
                traceId = "trace-m9-pos-price-replay",
            )
            assertEquals(firstSale.id, replay.id)
            assertEquals(9_000, replay.totalPaise)
            val differentCashier = assertThrows(DomainException::class.java) {
                services().pos.complete(
                    merchantId = scenario.organizationId,
                    outletId = scenario.outletId,
                    customerId = null,
                    lines = mapOf(scenario.listingId to (1 to 8_500L)),
                    payment = PaymentDeclaration.CARD_TERMINAL,
                    idempotencyKey = "m9-pos-price-first",
                    listingNames = mapOf(scenario.listingId to "new cached name"),
                    cashierId = UUID.randomUUID(),
                    traceId = "trace-m9-pos-price-foreign-cashier",
                )
            }
            assertEquals("IDEMPOTENCY_FINGERPRINT_MISMATCH", differentCashier.code)
            assertEquals(2, count("mypet.pos_sale"))
            assertEquals(0, inventory.available(scenario.listingId))
            inventory.requireReconciled(scope(scenario))
        } finally {
            runCatching { updateConnection.rollback() }
            updateConnection.close()
            allowCompletion.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `M9 failed associated POS rolls back challenge then retry commits sale inventory and loyalty once`() {
        val scenario = fixture.create()
        val customerId = createCustomer()
        val associations = CustomerAssociationChallengeService(
            persistence = JdbcCustomerAssociationPersistence(jdbc, transactions),
        )
        val challenge = associations.create(
            customerId = customerId,
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            idempotencyKey = "m9-association-create",
        )
        val pos = services(associations = associations).pos

        val failure = assertThrows(DomainException::class.java) {
            pos.complete(
                merchantId = scenario.organizationId,
                outletId = scenario.outletId,
                customerId = null,
                lines = mapOf(scenario.listingId to (2 to 9_000L)),
                payment = PaymentDeclaration.EXTERNAL_UPI,
                idempotencyKey = "m9-associated-sale",
                listingNames = mapOf(scenario.listingId to "cached name"),
                cashierId = scenario.accountId,
                traceId = "trace-m9-associated-fail",
                associationChallengeId = challenge.id,
            )
        }
        assertEquals("INSUFFICIENT_STOCK", failure.code)
        assertEquals(0, count("mypet.pos_sale"))
        assertEquals(0, count("mypet.loyalty_source"))
        assertEquals(
            1,
            countWhere(
                "mypet.pos_customer_association_challenge",
                "id = '${challenge.id}' AND consumed_at IS NULL",
            ),
        )

        seedStock(scenario, 2, "m9-associated-stock")
        val sale = pos.complete(
            merchantId = scenario.organizationId,
            outletId = scenario.outletId,
            customerId = null,
            lines = mapOf(scenario.listingId to (2 to 1L)),
            payment = PaymentDeclaration.EXTERNAL_UPI,
            idempotencyKey = "m9-associated-sale",
            listingNames = mapOf(scenario.listingId to "caller name ignored"),
            cashierId = scenario.accountId,
            traceId = "trace-m9-associated-success",
            associationChallengeId = challenge.id,
        )
        assertEquals(customerId, sale.customerId)
        assertTrue(sale.loyaltyAwarded)
        assertEquals(18_000, sale.totalPaise)
        assertEquals(1, count("mypet.pos_sale"))
        assertEquals(1, count("mypet.loyalty_source"))
        assertEquals(
            1,
            countWhere(
                "mypet.pos_customer_association_challenge",
                "id = '${challenge.id}' AND consumed_at IS NOT NULL",
            ),
        )

        val replay = pos.complete(
            merchantId = scenario.organizationId,
            outletId = scenario.outletId,
            customerId = null,
            lines = mapOf(scenario.listingId to (2 to 18_000L)),
            payment = PaymentDeclaration.EXTERNAL_UPI,
            idempotencyKey = "m9-associated-sale",
            listingNames = mapOf(scenario.listingId to "changed caller snapshot"),
            cashierId = scenario.accountId,
            traceId = "trace-m9-associated-replay",
            associationChallengeId = challenge.id,
        )
        assertEquals(sale.id, replay.id)
        assertEquals(1, count("mypet.pos_sale"))
        assertEquals(1, count("mypet.loyalty_source"))
        assertEquals(0, inventory.available(scenario.listingId))
        inventory.requireReconciled(scope(scenario))
    }

    @Test
    fun `M9 pre-deploy associated POS retry resolves consumed challenge only for existing receipt`() {
        val scenario = fixture.create()
        seedStock(scenario, 1, "m9-legacy-associated-stock")
        val customerId = createCustomer()
        val associationPersistence = JdbcCustomerAssociationPersistence(jdbc, transactions)
        val associations = CustomerAssociationChallengeService(persistence = associationPersistence)
        val challenge = associations.create(
            customerId = customerId,
            organizationId = scenario.organizationId,
            outletId = scenario.outletId,
            idempotencyKey = "m9-legacy-association-create",
        )
        assertEquals(customerId, associations.consume(challenge.id, scenario.organizationId, scenario.outletId))

        val oldSale = PosSale(
            id = UUID.randomUUID(),
            merchantId = scenario.organizationId,
            outletId = scenario.outletId,
            customerId = customerId,
            lines = mapOf(scenario.listingId to (1 to 9_000L)),
            totalPaise = 9_000,
            paymentDeclaration = PaymentDeclaration.CASH,
            completedAt = java.time.Instant.now(),
            loyaltyAwarded = false,
            cashierId = scenario.accountId,
            traceId = "trace-m9-legacy-original",
        )
        val persistence = JdbcPosPersistence(jdbc, transactions)
        transactions.executeWithoutResult {
            persistence.insert(
                oldSale,
                mapOf(scenario.listingId to "pre-M9 item"),
                "m9-legacy-associated-sale",
                "pre-m9-associated-fingerprint",
            )
            inventory.sell(
                scenario.listingId,
                1,
                "m9-legacy-associated-movement",
                scenario.accountId,
                "trace-m9-legacy-movement",
            )
        }

        val pos = services(associations = associations).pos
        val replay = pos.complete(
            merchantId = scenario.organizationId,
            outletId = scenario.outletId,
            customerId = null,
            lines = mapOf(scenario.listingId to (1 to 8_500L)),
            payment = PaymentDeclaration.CASH,
            idempotencyKey = "m9-legacy-associated-sale",
            listingNames = mapOf(scenario.listingId to "changed cached name"),
            cashierId = scenario.accountId,
            traceId = "trace-m9-legacy-retry",
            associationChallengeId = challenge.id,
        )
        assertEquals(oldSale.id, replay.id)
        assertEquals(9_000, replay.totalPaise)
        assertEquals(1, count("mypet.pos_sale"))
        assertEquals(0, inventory.available(scenario.listingId))

        val reuse = assertThrows(DomainException::class.java) {
            pos.complete(
                merchantId = scenario.organizationId,
                outletId = scenario.outletId,
                customerId = null,
                lines = mapOf(scenario.listingId to (1 to 9_000L)),
                payment = PaymentDeclaration.CASH,
                idempotencyKey = "m9-legacy-associated-new-key",
                listingNames = mapOf(scenario.listingId to "cached name"),
                cashierId = scenario.accountId,
                traceId = "trace-m9-legacy-reuse",
                associationChallengeId = challenge.id,
            )
        }
        assertEquals("CUSTOMER_ASSOCIATION_INVALID", reuse.code)
        assertEquals(1, count("mypet.pos_sale"))
        inventory.requireReconciled(scope(scenario))
    }

    @Test
    fun `M9 checkout rejects a quote when catalog price commits before transaction lock`() {
        val scenario = fixture.create()
        seedStock(scenario, 1, "m9-order-price-seed")
        val customerId = createCustomer()
        val quote = pickupQuote(scenario, customerId, 1, 9_000)
        val catalog = CatalogService(JdbcCatalogPersistence(jdbc, transactions))
        reprice(catalog, scenario, 8_500, "m9-reprice-before-checkout")

        val failure = assertThrows(DomainException::class.java) {
            services().orders.checkout(
                quote = quote,
                organizationId = scenario.organizationId,
                listingNames = mapOf(scenario.listingId to "cached name"),
                idempotencyKey = "m9-stale-checkout",
                actorId = customerId,
                traceId = "trace-m9-stale-checkout",
            )
        }
        assertEquals("QUOTE_STALE", failure.code)
        assertEquals(0, count("mypet.product_order"))
        assertEquals(0, count("mypet.inventory_reservation"))
        assertEquals(0, countWhere("mypet.inventory_movement", "reason = 'ORDER_RESERVE'"))
        assertEquals(1, inventory.available(scenario.listingId))

        val refreshed = pickupQuote(scenario, customerId, 1, 8_500)
        val order = services().orders.checkout(
            quote = refreshed,
            organizationId = scenario.organizationId,
            listingNames = mapOf(scenario.listingId to "cached name"),
            idempotencyKey = "m9-refreshed-checkout",
            actorId = customerId,
            traceId = "trace-m9-refreshed-checkout",
        )
        assertEquals(8_500, jdbc.queryForObject(
            "SELECT unit_price_paise FROM mypet.product_order_line WHERE order_id = ?",
            Long::class.java,
            order.id,
        ))
        assertEquals(0, inventory.available(scenario.listingId))
        assertEquals(1, inventory.reserved(scenario.listingId))
        inventory.requireReconciled(scope(scenario))
    }

    @Test
    fun `M9 reservation release fulfilment and transition replay stay atomic in PostgreSQL`() {
        val scenario = fixture.create()
        seedStock(scenario, 2, "m9-lifecycle-seed")
        val customerId = createCustomer()
        val orders = services().orders

        val cancelled = orders.checkout(
            quote = pickupQuote(scenario, customerId, 1, 9_000),
            organizationId = scenario.organizationId,
            listingNames = mapOf(scenario.listingId to "cached name"),
            idempotencyKey = "m9-checkout-cancel",
            actorId = customerId,
            traceId = "trace-m9-checkout-cancel",
        )
        assertEquals(1, inventory.reserved(scenario.listingId))
        val firstCancellation = orders.transition(
            orderId = cancelled.id,
            target = OrderStatus.CANCELLED,
            idempotencyKey = "m9-cancel",
            actorId = customerId,
            actorRole = Role.CUSTOMER,
            reason = "Customer changed plan",
            traceId = "trace-m9-cancel",
        )
        val cancellationReplay = orders.transition(
            orderId = cancelled.id,
            target = OrderStatus.CANCELLED,
            idempotencyKey = "m9-cancel",
            actorId = customerId,
            actorRole = Role.CUSTOMER,
            reason = "Customer changed plan",
            traceId = "trace-m9-cancel-replay",
        )
        assertEquals(firstCancellation.id, cancellationReplay.id)
        assertEquals(0, inventory.reserved(scenario.listingId))
        assertEquals(2, inventory.available(scenario.listingId))

        val fulfilled = orders.checkout(
            quote = pickupQuote(scenario, customerId, 1, 9_000),
            organizationId = scenario.organizationId,
            listingNames = mapOf(scenario.listingId to "cached name"),
            idempotencyKey = "m9-checkout-fulfil",
            actorId = customerId,
            traceId = "trace-m9-checkout-fulfil",
        )
        orders.transition(fulfilled.id, OrderStatus.ACCEPTED, "m9-accept", scenario.accountId, Role.MERCHANT, traceId = "trace-m9-accept")
        orders.transition(fulfilled.id, OrderStatus.PREPARING, "m9-prepare", scenario.accountId, Role.MERCHANT, traceId = "trace-m9-prepare")
        orders.transition(fulfilled.id, OrderStatus.READY_FOR_PICKUP, "m9-ready", scenario.accountId, Role.MERCHANT, traceId = "trace-m9-ready")
        orders.transition(fulfilled.id, OrderStatus.PICKED_UP, "m9-picked", scenario.accountId, Role.MERCHANT, traceId = "trace-m9-picked")
        val delivered = orders.transition(fulfilled.id, OrderStatus.DELIVERED, "m9-delivered", scenario.accountId, Role.MERCHANT, traceId = "trace-m9-delivered")

        assertEquals(OrderStatus.DELIVERED, delivered.status)
        assertEquals(0, inventory.reserved(scenario.listingId))
        assertEquals(1, inventory.available(scenario.listingId))
        assertEquals(1, countWhere("mypet.inventory_reservation", "status = 'RELEASED'"))
        assertEquals(1, countWhere("mypet.inventory_reservation", "status = 'FULFILLED'"))
        assertEquals(2, countWhere("mypet.inventory_movement", "reason = 'ORDER_RESERVE'"))
        assertEquals(1, countWhere("mypet.inventory_movement", "reason = 'ORDER_RELEASE'"))
        assertEquals(1, countWhere("mypet.inventory_movement", "reason = 'ORDER_FULFIL'"))
        assertEquals(1, countWhere("mypet.product_order_history", "order_id = '${cancelled.id}' AND to_status = 'CANCELLED'"))
        inventory.requireReconciled(scope(scenario))
    }

    private fun services(
        authority: CommerceListingAuthority = listingAuthority,
        associations: CustomerAssociationChallengeService? = null,
    ): Services {
        val loyalty = LoyaltyService(JdbcLoyaltyPersistence(jdbc, transactions))
        return Services(
            orders = OrderService(inventory, JdbcOrderPersistence(jdbc, transactions), listingAuthority = authority),
            pos = PosService(
                inventory,
                loyalty,
                JdbcPosPersistence(jdbc, transactions),
                listingAuthority = authority,
                customerAssociations = associations,
            ),
        )
    }

    private fun pickupQuote(scenario: MerchantScenario, customerId: UUID, quantity: Int, unitPricePaise: Long): Quote =
        QuoteService(persistence = JdbcQuotePersistence(jdbc, transactions)).createPickupQuote(
            customerId = customerId,
            outletId = scenario.outletId,
            lines = mapOf(scenario.listingId to (quantity to unitPricePaise)),
        )

    private fun seedStock(scenario: MerchantScenario, quantity: Int, key: String) {
        inventory.adjust(
            listingId = scenario.listingId,
            delta = quantity,
            reason = StockReason.RECEIPT,
            idempotencyKey = key,
            actorId = scenario.accountId,
            traceId = "trace-$key",
        )
    }

    private fun reprice(catalog: CatalogService, scenario: MerchantScenario, sellingPricePaise: Long, key: String) {
        val current = catalog.getManagedListing(scenario.organizationId, scenario.outletId, scenario.listingId)
        catalog.updateListing(
            UpdateListingCommand(
                organizationId = current.organizationId,
                outletId = current.outletId,
                listingId = current.id,
                expectedVersion = current.version,
                name = current.name,
                mrpPaise = current.mrpPaise,
                sellingPricePaise = sellingPricePaise,
                category = current.category,
                brand = current.brand,
                description = current.description,
                petType = current.petType,
                lifeStage = current.lifeStage,
                packLabel = current.packLabel,
                sku = current.sku,
                capabilities = setOf(ProviderCapability.PRODUCT_STORE),
            ),
            key,
            scenario.accountId,
        )
    }

    private fun createCustomer(): UUID = UUID.randomUUID().also { customerId ->
        jdbc.update(
            "INSERT INTO mypet.identity_account(id, mobile_e164, role, status) VALUES (?, '+918100000001', 'CUSTOMER', 'ACTIVE')",
            customerId,
        )
    }

    private fun backendPid(connection: Connection): Int = connection.createStatement().use { statement ->
        statement.executeQuery("SELECT pg_backend_pid()").use { result ->
            check(result.next())
            result.getInt(1)
        }
    }

    private fun awaitDatabaseLock(pid: Int) {
        repeat(100) {
            val waiting = jdbc.queryForObject(
                "SELECT COALESCE(wait_event_type = 'Lock', FALSE) FROM pg_stat_activity WHERE pid = ?",
                Boolean::class.java,
                pid,
            ) == true
            if (waiting) return
            Thread.sleep(50)
        }
        throw AssertionError("Catalog update never reached the expected PostgreSQL lock wait")
    }

    private fun count(table: String): Int = jdbc.queryForObject("SELECT COUNT(*) FROM $table", Int::class.java) ?: 0

    private fun countWhere(table: String, predicate: String): Int =
        jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE $predicate", Int::class.java) ?: 0

    private fun scope(scenario: MerchantScenario) = `in`.mypetnew.catalog.domain.InventoryScope(
        scenario.organizationId,
        scenario.outletId,
        scenario.listingId,
    )

    private data class Services(val orders: OrderService, val pos: PosService)
}
