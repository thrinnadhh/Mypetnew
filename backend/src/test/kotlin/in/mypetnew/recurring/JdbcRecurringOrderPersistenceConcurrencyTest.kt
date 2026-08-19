package `in`.mypetnew.recurring

import `in`.mypetnew.recurring.domain.OutstandingProposalAction
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
import `in`.mypetnew.recurring.domain.RecurringOrderSubscription
import `in`.mypetnew.recurring.infrastructure.JdbcRecurringOrderPersistence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

class JdbcRecurringOrderPersistenceConcurrencyTest {
    private val now = Instant.parse("2026-08-26T00:00:00Z")

    @Test
    fun `two scheduler instances create exactly one durable proposal for the same due cycle`() {
        val database = database()
        val subscription = subscription()
        insertSubscription(database, subscription)
        val first = persistence(database)
        val second = persistence(database)

        val results = race(
            { first.createDueProposals(now, now.plus(Duration.ofHours(72)), 100) },
            { second.createDueProposals(now, now.plus(Duration.ofHours(72)), 100) },
        )

        assertTrue(results.all { it.isSuccess }, results.map { it.exceptionOrNull() }.toString())
        assertEquals(1, results.sumOf { it.getOrThrow().size })
        assertEquals(1, proposalCount(database, subscription.id, subscription.nextOrderAt))
        assertEquals(1, historyCount(database, subscription.id, "PROPOSAL_CREATED"))
    }

    @Test
    fun `scheduler race with pause cancel skip or change cannot leave an open invalid proposal`() {
        listOf("PAUSED", "CANCELLED", "SKIPPED", "CHANGED").forEach { event ->
            val database = database()
            val subscription = subscription()
            insertSubscription(database, subscription)
            val scheduler = persistence(database)
            val command = persistence(database)

            val results = raceAny(
                {
                    scheduler.createDueProposals(now, now.plus(Duration.ofHours(72)), 100)
                },
                {
                    command.update(
                        subscription.customerId,
                        subscription.id,
                        "race-${event.lowercase()}",
                        "fingerprint-$event",
                        event,
                        subscription.customerId,
                        "race-test",
                        OutstandingProposalAction.SKIP,
                    ) { current ->
                        when (event) {
                            "PAUSED" -> current.copy(status = RecurringOrderStatus.PAUSED, updatedAt = now)
                            "CANCELLED" -> current.copy(status = RecurringOrderStatus.CANCELLED, updatedAt = now)
                            "SKIPPED" -> current.copy(
                                nextOrderAt = current.nextOrderAt.plus(Duration.ofDays(current.cadenceDays.toLong())),
                                updatedAt = now,
                            )
                            else -> current.copy(
                                cadenceDays = 15,
                                nextOrderAt = now.plus(Duration.ofDays(15)),
                                updatedAt = now,
                            )
                        }
                    }
                },
            )

            assertTrue(results.all { it.isSuccess }, "$event -> ${results.map { it.exceptionOrNull() }}")
            assertEquals(0, openProposalCount(database, subscription.id), "event=$event")
            val storedStatus = JdbcTemplate(database).queryForObject(
                "SELECT status FROM mypet.recurring_order_subscription WHERE id = ?",
                String::class.java,
                subscription.id,
            )
            if (event == "PAUSED") assertEquals("PAUSED", storedStatus)
            if (event == "CANCELLED") assertEquals("CANCELLED", storedStatus)
        }
    }

    @Test
    fun `same customer command key is durable across independent persistence instances`() {
        val database = database()
        val customerId = UUID.randomUUID()
        val sourceOrderId = UUID.randomUUID()
        val first = persistence(database)
        val second = persistence(database)
        val left = subscription(customerId = customerId, sourceOrderId = sourceOrderId)
        val right = left.copy(id = UUID.randomUUID())

        val results = race(
            { listOf(first.create(left, "same-key", "same-fingerprint", customerId, "a")) },
            { listOf(second.create(right, "same-key", "same-fingerprint", customerId, "b")) },
        )

        assertTrue(results.all { it.isSuccess }, results.map { it.exceptionOrNull() }.toString())
        val ids = results.flatMap { it.getOrThrow() }.map { it.id }.toSet()
        assertEquals(1, ids.size)
        assertEquals(1, subscriptionCount(database, customerId, sourceOrderId))
        assertEquals(1, commandCount(database, customerId, "same-key"))
    }

    private fun race(
        first: () -> List<Any>,
        second: () -> List<Any>,
    ): List<Result<List<Any>>> = raceInternal(first, second)

    private fun raceAny(first: () -> Any, second: () -> Any): List<Result<Any>> = raceInternal(first, second)

    private fun <T> raceInternal(first: () -> T, second: () -> T): List<Result<T>> {
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        return try {
            val tasks = listOf(first, second).map { operation ->
                Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching(operation)
                }
            }
            val futures = tasks.map(executor::submit)
            assertTrue(ready.await(5, TimeUnit.SECONDS), "Both operations must reach the start barrier")
            start.countDown()
            futures.map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }
    }

    private fun database(): DataSource {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:p14-${UUID.randomUUID()};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
            "sa",
            "",
        )
        JdbcTemplate(dataSource).execute(
            """
            CREATE SCHEMA mypet;
            CREATE TABLE mypet.recurring_order_subscription(
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL,
                provider_id UUID NOT NULL,
                source_order_id UUID NOT NULL,
                delivery_address_id UUID NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                cadence_days INTEGER NOT NULL,
                quantity_multiplier INTEGER NOT NULL,
                status VARCHAR(32) NOT NULL,
                next_order_at TIMESTAMP WITH TIME ZONE NOT NULL,
                last_reminded_at TIMESTAMP WITH TIME ZONE NULL,
                time_zone VARCHAR(64) NOT NULL,
                version BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_recurring_source UNIQUE(customer_id, source_order_id)
            );
            CREATE TABLE mypet.recurring_order_proposal(
                id UUID PRIMARY KEY,
                subscription_id UUID NOT NULL,
                customer_id UUID NOT NULL,
                provider_id UUID NOT NULL,
                source_order_id UUID NOT NULL,
                delivery_address_id UUID NULL,
                fulfilment_mode VARCHAR(32) NOT NULL,
                cadence_days INTEGER NOT NULL,
                quantity_multiplier INTEGER NOT NULL,
                due_cycle_at TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(32) NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                revalidated_at TIMESTAMP WITH TIME ZONE NULL,
                confirmed_at TIMESTAMP WITH TIME ZONE NULL,
                order_id UUID NULL,
                checkout_idempotency_key VARCHAR(128) NULL,
                failure_reason VARCHAR(240) NULL,
                version BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_recurring_proposal_cycle UNIQUE(subscription_id, due_cycle_at)
            );
            CREATE TABLE mypet.recurring_order_command(
                customer_id UUID NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL,
                command_type VARCHAR(48) NOT NULL,
                subscription_id UUID NOT NULL,
                proposal_id UUID NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(customer_id, idempotency_key)
            );
            CREATE TABLE mypet.recurring_order_history(
                id UUID PRIMARY KEY,
                subscription_id UUID NOT NULL,
                proposal_id UUID NULL,
                event_type VARCHAR(48) NOT NULL,
                actor_id UUID NOT NULL,
                actor_role VARCHAR(24) NOT NULL,
                source VARCHAR(24) NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                trace_id VARCHAR(128) NOT NULL,
                details VARCHAR(1000) NULL,
                occurred_at TIMESTAMP WITH TIME ZONE NOT NULL
            );
            """.trimIndent(),
        )
        return dataSource
    }

    private fun persistence(dataSource: DataSource) = JdbcRecurringOrderPersistence(
        JdbcClient.create(dataSource),
        TransactionTemplate(DataSourceTransactionManager(dataSource)),
    )

    private fun subscription(
        customerId: UUID = UUID.randomUUID(),
        sourceOrderId: UUID = UUID.randomUUID(),
    ) = RecurringOrderSubscription(
        id = UUID.randomUUID(),
        customerId = customerId,
        providerId = UUID.randomUUID(),
        sourceOrderId = sourceOrderId,
        deliveryAddressId = null,
        fulfilmentMode = "STORE_PICKUP",
        cadenceDays = 7,
        quantityMultiplier = 1,
        status = RecurringOrderStatus.ACTIVE,
        nextOrderAt = now,
        lastRemindedAt = null,
        timeZone = "Asia/Kolkata",
        version = 0,
        createdAt = now.minus(Duration.ofDays(7)),
        updatedAt = now.minus(Duration.ofDays(7)),
    )

    private fun insertSubscription(dataSource: DataSource, value: RecurringOrderSubscription) {
        JdbcTemplate(dataSource).update(
            """
            INSERT INTO mypet.recurring_order_subscription(
                id, customer_id, provider_id, source_order_id, delivery_address_id,
                fulfilment_mode, cadence_days, quantity_multiplier, status, next_order_at,
                last_reminded_at, time_zone, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            value.id,
            value.customerId,
            value.providerId,
            value.sourceOrderId,
            value.deliveryAddressId,
            value.fulfilmentMode,
            value.cadenceDays,
            value.quantityMultiplier,
            value.status.name,
            Timestamp.from(value.nextOrderAt),
            null,
            value.timeZone,
            value.version,
            Timestamp.from(value.createdAt),
            Timestamp.from(value.updatedAt),
        )
    }

    private fun proposalCount(dataSource: DataSource, subscriptionId: UUID, dueCycleAt: Instant): Int =
        JdbcTemplate(dataSource).queryForObject(
            "SELECT COUNT(*) FROM mypet.recurring_order_proposal WHERE subscription_id = ? AND due_cycle_at = ?",
            Int::class.java,
            subscriptionId,
            Timestamp.from(dueCycleAt),
        ) ?: 0

    private fun openProposalCount(dataSource: DataSource, subscriptionId: UUID): Int =
        JdbcTemplate(dataSource).queryForObject(
            """
            SELECT COUNT(*) FROM mypet.recurring_order_proposal
            WHERE subscription_id = ? AND status IN ('AWAITING_CONFIRMATION','REVALIDATION_FAILED','CONFIRMED')
            """.trimIndent(),
            Int::class.java,
            subscriptionId,
        ) ?: 0

    private fun historyCount(dataSource: DataSource, subscriptionId: UUID, eventType: String): Int =
        JdbcTemplate(dataSource).queryForObject(
            "SELECT COUNT(*) FROM mypet.recurring_order_history WHERE subscription_id = ? AND event_type = ?",
            Int::class.java,
            subscriptionId,
            eventType,
        ) ?: 0

    private fun subscriptionCount(dataSource: DataSource, customerId: UUID, sourceOrderId: UUID): Int =
        JdbcTemplate(dataSource).queryForObject(
            "SELECT COUNT(*) FROM mypet.recurring_order_subscription WHERE customer_id = ? AND source_order_id = ?",
            Int::class.java,
            customerId,
            sourceOrderId,
        ) ?: 0

    private fun commandCount(dataSource: DataSource, customerId: UUID, key: String): Int =
        JdbcTemplate(dataSource).queryForObject(
            "SELECT COUNT(*) FROM mypet.recurring_order_command WHERE customer_id = ? AND idempotency_key = ?",
            Int::class.java,
            customerId,
            key,
        ) ?: 0
}
