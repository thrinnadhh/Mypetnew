package `in`.mypetnew.recurring

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.recurring.domain.OutstandingProposalAction
import `in`.mypetnew.recurring.domain.ProposalMutation
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
import `in`.mypetnew.recurring.domain.RecurringOrderSubscription
import `in`.mypetnew.recurring.domain.RenewalProposal
import `in`.mypetnew.recurring.domain.RenewalProposalStatus
import `in`.mypetnew.recurring.infrastructure.GuardedRecurringOrderPersistence
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

class GuardedRecurringOrderPersistenceConcurrencyTest {
    private val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS)

    @Test
    fun `confirm racing expiry cannot resurrect an expired proposal`() {
        val database = database()
        val subscription = subscription()
        val proposal = proposal(subscription, expiresAt = now.minus(Duration.ofMinutes(1)))
        insertSubscription(database, subscription)
        insertProposal(database, proposal)
        val confirmer = guarded(database)
        val expirer = guarded(database)

        val results = raceAny(
            { confirm(confirmer, subscription, proposal, "confirm-expiry") },
            { expirer.expireProposals(now, 100) },
        )

        assertTrue(results.count { it.isSuccess } >= 1, results.map { it.exceptionOrNull() }.toString())
        assertEquals("EXPIRED", proposalStatus(database, proposal.id))
        assertEquals(1, historyCount(database, subscription.id, "PROPOSAL_EXPIRED"))
        assertTrue(historyCount(database, subscription.id, "PROPOSAL_CONFIRMED") <= 1)
    }

    @Test
    fun `confirm racing cancellation leaves subscription terminal and proposal skipped`() {
        val database = database()
        val subscription = subscription()
        val proposal = proposal(subscription, expiresAt = now.plus(Duration.ofDays(3)))
        insertSubscription(database, subscription)
        insertProposal(database, proposal)
        val confirmer = guarded(database)
        val canceller = guarded(database)

        val results = raceAny(
            { confirm(confirmer, subscription, proposal, "confirm-cancel") },
            {
                canceller.update(
                    subscription.customerId,
                    subscription.id,
                    "cancel-race",
                    "cancel-race-fingerprint",
                    "CANCELLED",
                    subscription.customerId,
                    "race",
                    OutstandingProposalAction.SKIP,
                ) { current -> current.copy(status = RecurringOrderStatus.CANCELLED, updatedAt = now) }
            },
        )

        assertTrue(results.count { it.isSuccess } >= 1, results.map { it.exceptionOrNull() }.toString())
        assertEquals("CANCELLED", subscriptionStatus(database, subscription.id))
        assertEquals("SKIPPED", proposalStatus(database, proposal.id))
        assertTrue(historyCount(database, subscription.id, "PROPOSAL_CONFIRMED") <= 1)
    }

    @Test
    fun `same confirmation key replays once across two API nodes`() {
        val database = database()
        val subscription = subscription()
        val proposal = proposal(subscription, expiresAt = now.plus(Duration.ofDays(3)))
        insertSubscription(database, subscription)
        insertProposal(database, proposal)
        val first = guarded(database)
        val second = guarded(database)

        val results = raceAny(
            { confirm(first, subscription, proposal, "same-confirm-key") },
            { confirm(second, subscription, proposal, "same-confirm-key") },
        )

        assertTrue(results.all { it.isSuccess }, results.map { it.exceptionOrNull() }.toString())
        assertEquals("CONFIRMED", proposalStatus(database, proposal.id))
        assertEquals(1, commandCount(database, subscription.customerId, "same-confirm-key"))
        assertEquals(1, historyCount(database, subscription.id, "PROPOSAL_CONFIRMED"))
    }

    @Test
    fun `different confirmation keys cannot confirm the same proposal twice`() {
        val database = database()
        val subscription = subscription()
        val proposal = proposal(subscription, expiresAt = now.plus(Duration.ofDays(3)))
        insertSubscription(database, subscription)
        insertProposal(database, proposal)
        val first = guarded(database)
        val second = guarded(database)

        val results = raceAny(
            { confirm(first, subscription, proposal, "confirm-a") },
            { confirm(second, subscription, proposal, "confirm-b") },
        )

        assertEquals(1, results.count { it.isSuccess }, results.map { it.exceptionOrNull() }.toString())
        val rejected = results.single { it.isFailure }.exceptionOrNull()
        assertTrue(rejected is DomainException)
        assertEquals("PROPOSAL_STATE_INVALID", (rejected as DomainException).code)
        assertEquals("CONFIRMED", proposalStatus(database, proposal.id))
        assertEquals(1, historyCount(database, subscription.id, "PROPOSAL_CONFIRMED"))
    }

    private fun confirm(
        persistence: GuardedRecurringOrderPersistence,
        subscription: RecurringOrderSubscription,
        proposal: RenewalProposal,
        key: String,
    ): ProposalMutation<String> = persistence.mutateProposal(
        subscription.customerId,
        subscription.id,
        proposal.id,
        key,
        "confirm-fingerprint",
        "PROPOSAL_CONFIRMED",
        subscription.customerId,
        "race",
    ) { _, current, replay ->
        ProposalMutation(
            if (replay) current else current.copy(
                status = RenewalProposalStatus.CONFIRMED,
                confirmedAt = now,
                revalidatedAt = now,
                updatedAt = now,
            ),
            "ok",
        )
    }

    private fun guarded(dataSource: DataSource): GuardedRecurringOrderPersistence {
        val jdbc = JdbcClient.create(dataSource)
        val transactions = TransactionTemplate(DataSourceTransactionManager(dataSource))
        return GuardedRecurringOrderPersistence(
            JdbcRecurringOrderPersistence(jdbc, transactions),
            jdbc,
            transactions,
        )
    }

    private fun raceAny(first: () -> Any, second: () -> Any): List<Result<Any>> {
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        return try {
            val futures = listOf(first, second).map { operation ->
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(5, TimeUnit.SECONDS))
                    runCatching(operation)
                })
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            futures.map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }
    }

    private fun database(): DataSource {
        val dataSource = DriverManagerDataSource(
            "jdbc:h2:mem:p14-confirm-${UUID.randomUUID()};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
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

    private fun subscription() = RecurringOrderSubscription(
        id = UUID.randomUUID(),
        customerId = UUID.randomUUID(),
        providerId = UUID.randomUUID(),
        sourceOrderId = UUID.randomUUID(),
        deliveryAddressId = null,
        fulfilmentMode = "STORE_PICKUP",
        cadenceDays = 7,
        quantityMultiplier = 1,
        status = RecurringOrderStatus.ACTIVE,
        nextOrderAt = now,
        lastRemindedAt = now,
        timeZone = "Asia/Kolkata",
        version = 0,
        createdAt = now.minus(Duration.ofDays(7)),
        updatedAt = now,
    )

    private fun proposal(subscription: RecurringOrderSubscription, expiresAt: Instant) = RenewalProposal(
        id = UUID.randomUUID(),
        subscriptionId = subscription.id,
        customerId = subscription.customerId,
        providerId = subscription.providerId,
        sourceOrderId = subscription.sourceOrderId,
        deliveryAddressId = subscription.deliveryAddressId,
        fulfilmentMode = subscription.fulfilmentMode,
        cadenceDays = subscription.cadenceDays,
        quantityMultiplier = subscription.quantityMultiplier,
        dueCycleAt = subscription.nextOrderAt,
        status = RenewalProposalStatus.AWAITING_CONFIRMATION,
        expiresAt = expiresAt,
        revalidatedAt = null,
        confirmedAt = null,
        orderId = null,
        checkoutIdempotencyKey = null,
        failureReason = null,
        version = 0,
        createdAt = now,
        updatedAt = now,
    )

    private fun insertSubscription(dataSource: DataSource, value: RecurringOrderSubscription) {
        JdbcTemplate(dataSource).update(
            """
            INSERT INTO mypet.recurring_order_subscription(
                id, customer_id, provider_id, source_order_id, delivery_address_id, fulfilment_mode,
                cadence_days, quantity_multiplier, status, next_order_at, last_reminded_at,
                time_zone, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            value.id, value.customerId, value.providerId, value.sourceOrderId, value.deliveryAddressId,
            value.fulfilmentMode, value.cadenceDays, value.quantityMultiplier, value.status.name,
            Timestamp.from(value.nextOrderAt), Timestamp.from(value.lastRemindedAt), value.timeZone,
            value.version, Timestamp.from(value.createdAt), Timestamp.from(value.updatedAt),
        )
    }

    private fun insertProposal(dataSource: DataSource, value: RenewalProposal) {
        JdbcTemplate(dataSource).update(
            """
            INSERT INTO mypet.recurring_order_proposal(
                id, subscription_id, customer_id, provider_id, source_order_id, delivery_address_id,
                fulfilment_mode, cadence_days, quantity_multiplier, due_cycle_at, status, expires_at,
                revalidated_at, confirmed_at, order_id, checkout_idempotency_key, failure_reason,
                version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            value.id, value.subscriptionId, value.customerId, value.providerId, value.sourceOrderId,
            value.deliveryAddressId, value.fulfilmentMode, value.cadenceDays, value.quantityMultiplier,
            Timestamp.from(value.dueCycleAt), value.status.name, Timestamp.from(value.expiresAt), null, null,
            null, null, null, value.version, Timestamp.from(value.createdAt), Timestamp.from(value.updatedAt),
        )
    }

    private fun proposalStatus(dataSource: DataSource, proposalId: UUID): String =
        checkNotNull(JdbcTemplate(dataSource).queryForObject(
            "SELECT status FROM mypet.recurring_order_proposal WHERE id = ?",
            String::class.java,
            proposalId,
        ))

    private fun subscriptionStatus(dataSource: DataSource, subscriptionId: UUID): String =
        checkNotNull(JdbcTemplate(dataSource).queryForObject(
            "SELECT status FROM mypet.recurring_order_subscription WHERE id = ?",
            String::class.java,
            subscriptionId,
        ))

    private fun historyCount(dataSource: DataSource, subscriptionId: UUID, eventType: String): Int =
        JdbcTemplate(dataSource).queryForObject(
            "SELECT COUNT(*) FROM mypet.recurring_order_history WHERE subscription_id = ? AND event_type = ?",
            Int::class.java,
            subscriptionId,
            eventType,
        ) ?: 0

    private fun commandCount(dataSource: DataSource, customerId: UUID, key: String): Int =
        JdbcTemplate(dataSource).queryForObject(
            "SELECT COUNT(*) FROM mypet.recurring_order_command WHERE customer_id = ? AND idempotency_key = ?",
            Int::class.java,
            customerId,
            key,
        ) ?: 0
}
