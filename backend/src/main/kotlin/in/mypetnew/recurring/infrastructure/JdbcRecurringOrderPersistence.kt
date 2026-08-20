package `in`.mypetnew.recurring.infrastructure

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.recurring.domain.OutstandingProposalAction
import `in`.mypetnew.recurring.domain.ProposalMutation
import `in`.mypetnew.recurring.domain.RecurringHistoryEntry
import `in`.mypetnew.recurring.domain.RecurringOrderPage
import `in`.mypetnew.recurring.domain.RecurringOrderPersistence
import `in`.mypetnew.recurring.domain.RecurringOrderStatus
import `in`.mypetnew.recurring.domain.RecurringOrderSubscription
import `in`.mypetnew.recurring.domain.RenewalProposal
import `in`.mypetnew.recurring.domain.RenewalProposalPage
import `in`.mypetnew.recurring.domain.RenewalProposalStatus
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID

class JdbcRecurringOrderPersistence(
    private val jdbc: JdbcClient,
    private val transactions: TransactionTemplate,
) : RecurringOrderPersistence {
    private data class CommandRow(
        val fingerprint: String,
        val type: String,
        val subscriptionId: UUID,
        val proposalId: UUID?,
    )

    override fun create(
        subscription: RecurringOrderSubscription,
        idempotencyKey: String,
        requestFingerprint: String,
        actorId: UUID,
        traceId: String,
    ): RecurringOrderSubscription {
        try {
            return tx {
                command(subscription.customerId, idempotencyKey)?.let { replay ->
                    verifyCommand(replay, requestFingerprint, "CREATE")
                    return@tx get(subscription.customerId, replay.subscriptionId) ?: unavailable()
                }
                insertSubscription(subscription)
                insertCommand(
                    subscription.customerId,
                    idempotencyKey,
                    requestFingerprint,
                    "CREATE",
                    subscription.id,
                    null,
                )
                insertHistory(
                    subscription.id,
                    null,
                    "SUBSCRIPTION_CREATED",
                    actorId,
                    "CUSTOMER",
                    "API",
                    idempotencyKey,
                    traceId,
                    null,
                    subscription.createdAt,
                )
                subscription
            }
        } catch (_: DuplicateKeyException) {
            command(subscription.customerId, idempotencyKey)?.let { replay ->
                verifyCommand(replay, requestFingerprint, "CREATE")
                return get(subscription.customerId, replay.subscriptionId) ?: unavailable()
            }
            if (findBySource(subscription.customerId, subscription.sourceOrderId) != null) alreadyExists()
            conflict()
        }
    }

    override fun get(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription? =
        jdbc.sql(
            "SELECT * FROM mypet.recurring_order_subscription WHERE id = :id AND customer_id = :customerId",
        )
            .param("id", subscriptionId)
            .param("customerId", customerId)
            .query(::mapSubscription)
            .optional()
            .orElse(null)

    override fun findBySource(customerId: UUID, sourceOrderId: UUID): RecurringOrderSubscription? =
        jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_subscription
            WHERE customer_id = :customerId AND source_order_id = :sourceOrderId
            LIMIT 1
            """.trimIndent(),
        )
            .param("customerId", customerId)
            .param("sourceOrderId", sourceOrderId)
            .query(::mapSubscription)
            .optional()
            .orElse(null)

    override fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage {
        val rows = jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_subscription
            WHERE customer_id = :customerId
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        )
            .param("customerId", customerId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::mapSubscription)
            .list()
        return RecurringOrderPage(rows.take(pageSize), rows.size > pageSize)
    }

    override fun update(
        customerId: UUID,
        subscriptionId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
        eventType: String,
        actorId: UUID,
        traceId: String,
        outstandingProposalAction: OutstandingProposalAction,
        updater: (RecurringOrderSubscription) -> RecurringOrderSubscription,
    ): RecurringOrderSubscription {
        try {
            return tx {
                command(customerId, idempotencyKey)?.let { replay ->
                    verifyCommand(replay, requestFingerprint, eventType)
                    return@tx get(customerId, replay.subscriptionId) ?: unavailable()
                }
                val current = lockSubscription(customerId, subscriptionId) ?: unavailable()
                val requested = updater(current)
                if (outstandingProposalAction == OutstandingProposalAction.SKIP) {
                    skipOutstandingProposals(current, requested.updatedAt, actorId, idempotencyKey, traceId)
                }
                val updated = requested.copy(version = current.version + 1)
                updateSubscription(current, updated)
                insertCommand(customerId, idempotencyKey, requestFingerprint, eventType, subscriptionId, null)
                insertHistory(
                    subscriptionId,
                    null,
                    eventType,
                    actorId,
                    "CUSTOMER",
                    "API",
                    idempotencyKey,
                    traceId,
                    null,
                    updated.updatedAt,
                )
                updated
            }
        } catch (_: DuplicateKeyException) {
            val replay = command(customerId, idempotencyKey) ?: conflict()
            verifyCommand(replay, requestFingerprint, eventType)
            return get(customerId, replay.subscriptionId) ?: unavailable()
        }
    }

    override fun createDueProposals(now: Instant, expiresAt: Instant, limit: Int): List<RenewalProposal> {
        val candidateIds = jdbc.sql(
            """
            SELECT s.id
            FROM mypet.recurring_order_subscription s
            WHERE s.status = 'ACTIVE'
              AND s.next_order_at <= :now
              AND NOT EXISTS (
                  SELECT 1
                  FROM mypet.recurring_order_proposal p
                  WHERE p.subscription_id = s.id AND p.due_cycle_at = s.next_order_at
              )
            ORDER BY s.next_order_at, s.id
            LIMIT :limit
            """.trimIndent(),
        )
            .param("now", now.jdbcTimestamp())
            .param("limit", limit)
            .query { result, _ -> checkNotNull(result.getObject("id", UUID::class.java)) }
            .list()

        return candidateIds.mapNotNull { subscriptionId ->
            txNullable {
                val subscription = lockSubscriptionById(subscriptionId) ?: return@txNullable null
                if (subscription.status != RecurringOrderStatus.ACTIVE || subscription.nextOrderAt.isAfter(now)) {
                    return@txNullable null
                }
                if (existingProposal(subscription.id, subscription.nextOrderAt) != null) return@txNullable null

                val proposal = RenewalProposal(
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
                    createdAt = now,
                    updatedAt = now,
                )
                try {
                    insertProposal(proposal)
                } catch (_: DuplicateKeyException) {
                    return@txNullable null
                }
                jdbc.sql(
                    """
                    UPDATE mypet.recurring_order_subscription
                    SET last_reminded_at = :now, version = version + 1, updated_at = :now
                    WHERE id = :id
                    """.trimIndent(),
                )
                    .param("now", now.jdbcTimestamp())
                    .param("id", subscription.id)
                    .update()
                insertHistory(
                    subscription.id,
                    proposal.id,
                    "PROPOSAL_CREATED",
                    InventoryService.SYSTEM_ACTOR_ID,
                    "SYSTEM",
                    "SCHEDULER",
                    dueKey(subscription),
                    "recurring-scheduler",
                    null,
                    now,
                )
                proposal
            }
        }
    }

    override fun expireProposals(now: Instant, limit: Int): Int {
        val candidateIds = jdbc.sql(
            """
            SELECT id
            FROM mypet.recurring_order_proposal
            WHERE status IN ('AWAITING_CONFIRMATION', 'REVALIDATION_FAILED', 'CONFIRMED')
              AND expires_at <= :now
            ORDER BY expires_at, id
            LIMIT :limit
            """.trimIndent(),
        )
            .param("now", now.jdbcTimestamp())
            .param("limit", limit)
            .query { result, _ -> checkNotNull(result.getObject("id", UUID::class.java)) }
            .list()

        var expired = 0
        candidateIds.forEach { proposalId ->
            if (tx { expireOne(proposalId, now) }) expired++
        }
        return expired
    }

    private fun expireOne(proposalId: UUID, now: Instant): Boolean {
        val owner = proposalOwner(proposalId) ?: return false
        val subscription = lockSubscription(owner.first, owner.second) ?: return false
        val proposal = lockProposal(owner.first, proposalId) ?: return false
        if (
            proposal.status !in setOf(
                RenewalProposalStatus.AWAITING_CONFIRMATION,
                RenewalProposalStatus.REVALIDATION_FAILED,
                RenewalProposalStatus.CONFIRMED,
            ) || proposal.expiresAt.isAfter(now)
        ) return false

        val expired = updateProposal(
            proposal,
            proposal.copy(
                status = RenewalProposalStatus.EXPIRED,
                failureReason = proposal.failureReason ?: "PROPOSAL_EXPIRED",
                updatedAt = now,
            ),
        )
        if (subscription.status == RecurringOrderStatus.ACTIVE && subscription.nextOrderAt == proposal.dueCycleAt) {
            advanceSubscription(
                subscription,
                proposal.dueCycleAt.plus(Duration.ofDays(proposal.cadenceDays.toLong())),
                now,
            )
        }
        insertHistory(
            subscription.id,
            proposal.id,
            "PROPOSAL_EXPIRED",
            InventoryService.SYSTEM_ACTOR_ID,
            "SYSTEM",
            "SCHEDULER",
            "expire:${proposal.id}",
            "recurring-scheduler",
            expired.failureReason,
            now,
        )
        return true
    }

    override fun listProposals(customerId: UUID, page: Int, pageSize: Int): RenewalProposalPage {
        val rows = jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_proposal
            WHERE customer_id = :customerId
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """.trimIndent(),
        )
            .param("customerId", customerId)
            .param("limit", pageSize + 1)
            .param("offset", page.toLong() * pageSize.toLong())
            .query(::mapProposal)
            .list()
        return RenewalProposalPage(rows.take(pageSize), rows.size > pageSize)
    }

    override fun getProposal(customerId: UUID, proposalId: UUID): RenewalProposal? =
        jdbc.sql(
            "SELECT * FROM mypet.recurring_order_proposal WHERE id = :id AND customer_id = :customerId",
        )
            .param("id", proposalId)
            .param("customerId", customerId)
            .query(::mapProposal)
            .optional()
            .orElse(null)

    override fun getProposal(customerId: UUID, subscriptionId: UUID, proposalId: UUID): RenewalProposal? =
        jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_proposal
            WHERE id = :id AND subscription_id = :subscriptionId AND customer_id = :customerId
            """.trimIndent(),
        )
            .param("id", proposalId)
            .param("subscriptionId", subscriptionId)
            .param("customerId", customerId)
            .query(::mapProposal)
            .optional()
            .orElse(null)

    override fun <T> mutateProposal(
        customerId: UUID,
        subscriptionId: UUID,
        proposalId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
        eventType: String,
        actorId: UUID,
        traceId: String,
        mutation: (RecurringOrderSubscription, RenewalProposal, Boolean) -> ProposalMutation<T>,
    ): ProposalMutation<T> {
        try {
            return tx {
                val subscription = lockSubscription(customerId, subscriptionId) ?: unavailable()
                val current = lockProposal(customerId, subscriptionId, proposalId) ?: unavailable()
                command(customerId, idempotencyKey)?.let { replay ->
                    verifyCommand(replay, requestFingerprint, eventType)
                    return@tx mutation(subscription, current, true).copy(proposal = current)
                }
                val requested = mutation(subscription, current, false)
                val stored = updateProposal(current, requested.proposal)
                insertCommand(
                    customerId,
                    idempotencyKey,
                    requestFingerprint,
                    eventType,
                    subscriptionId,
                    proposalId,
                )
                insertHistory(
                    subscriptionId,
                    proposalId,
                    eventType,
                    actorId,
                    "CUSTOMER",
                    "API",
                    idempotencyKey,
                    traceId,
                    stored.failureReason,
                    stored.updatedAt,
                )
                requested.copy(proposal = stored)
            }
        } catch (_: DuplicateKeyException) {
            return tx {
                val subscription = lockSubscription(customerId, subscriptionId) ?: unavailable()
                val current = lockProposal(customerId, subscriptionId, proposalId) ?: unavailable()
                val replay = command(customerId, idempotencyKey) ?: conflict()
                verifyCommand(replay, requestFingerprint, eventType)
                mutation(subscription, current, true).copy(proposal = current)
            }
        }
    }

    override fun markOrderCreated(
        customerId: UUID,
        proposalId: UUID,
        orderId: UUID,
        checkoutIdempotencyKey: String,
        actorId: UUID,
        traceId: String,
        now: Instant,
    ): RenewalProposal = tx {
        val owner = proposalOwner(proposalId)?.takeIf { it.first == customerId } ?: unavailable()
        val subscription = lockSubscription(customerId, owner.second) ?: unavailable()
        val proposal = lockProposal(customerId, proposalId) ?: unavailable()
        if (proposal.status == RenewalProposalStatus.ORDER_CREATED) {
            if (proposal.orderId != orderId || proposal.checkoutIdempotencyKey != checkoutIdempotencyKey) {
                idempotencyMismatch()
            }
            return@tx proposal
        }
        if (proposal.status != RenewalProposalStatus.CONFIRMED) invalidProposalState()

        val completed = updateProposal(
            proposal,
            proposal.copy(
                status = RenewalProposalStatus.ORDER_CREATED,
                orderId = orderId,
                checkoutIdempotencyKey = checkoutIdempotencyKey,
                failureReason = null,
                updatedAt = now,
            ),
        )
        if (subscription.status == RecurringOrderStatus.ACTIVE && subscription.nextOrderAt == proposal.dueCycleAt) {
            advanceSubscription(
                subscription,
                proposal.dueCycleAt.plus(Duration.ofDays(proposal.cadenceDays.toLong())),
                now,
            )
        }
        insertHistory(
            subscription.id,
            proposal.id,
            "ORDER_CREATED",
            actorId,
            "CUSTOMER",
            "CHECKOUT",
            checkoutIdempotencyKey,
            traceId,
            orderId.toString(),
            now,
        )
        completed
    }

    override fun history(customerId: UUID, subscriptionId: UUID): List<RecurringHistoryEntry> {
        if (get(customerId, subscriptionId) == null) return emptyList()
        return jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_history
            WHERE subscription_id = :subscriptionId
            ORDER BY occurred_at, id
            """.trimIndent(),
        )
            .param("subscriptionId", subscriptionId)
            .query { result, _ ->
                RecurringHistoryEntry(
                    id = checkNotNull(result.getObject("id", UUID::class.java)),
                    subscriptionId = checkNotNull(result.getObject("subscription_id", UUID::class.java)),
                    proposalId = result.getObject("proposal_id", UUID::class.java),
                    eventType = result.getString("event_type"),
                    actorId = checkNotNull(result.getObject("actor_id", UUID::class.java)),
                    actorRole = result.getString("actor_role"),
                    source = result.getString("source"),
                    idempotencyKey = result.getString("idempotency_key"),
                    traceId = result.getString("trace_id"),
                    details = result.getString("details"),
                    occurredAt = result.getTimestamp("occurred_at").toInstant(),
                )
            }
            .list()
    }

    private fun insertSubscription(subscription: RecurringOrderSubscription) {
        jdbc.sql(
            """
            INSERT INTO mypet.recurring_order_subscription (
                id, customer_id, provider_id, source_order_id, delivery_address_id,
                fulfilment_mode, cadence_days, quantity_multiplier, status, next_order_at,
                last_reminded_at, time_zone, version, created_at, updated_at
            ) VALUES (
                :id, :customerId, :providerId, :sourceOrderId, :deliveryAddressId,
                :fulfilmentMode, :cadenceDays, :quantityMultiplier, :status, :nextOrderAt,
                :lastRemindedAt, :timeZone, :version, :createdAt, :updatedAt
            )
            """.trimIndent(),
        )
            .param("id", subscription.id)
            .param("customerId", subscription.customerId)
            .param("providerId", subscription.providerId)
            .param("sourceOrderId", subscription.sourceOrderId)
            .param("deliveryAddressId", subscription.deliveryAddressId)
            .param("fulfilmentMode", subscription.fulfilmentMode)
            .param("cadenceDays", subscription.cadenceDays)
            .param("quantityMultiplier", subscription.quantityMultiplier)
            .param("status", subscription.status.name)
            .param("nextOrderAt", subscription.nextOrderAt.jdbcTimestamp())
            .param("lastRemindedAt", subscription.lastRemindedAt?.jdbcTimestamp())
            .param("timeZone", subscription.timeZone)
            .param("version", subscription.version)
            .param("createdAt", subscription.createdAt.jdbcTimestamp())
            .param("updatedAt", subscription.updatedAt.jdbcTimestamp())
            .update()
    }

    private fun updateSubscription(current: RecurringOrderSubscription, updated: RecurringOrderSubscription) {
        val changed = jdbc.sql(
            """
            UPDATE mypet.recurring_order_subscription
            SET delivery_address_id = :deliveryAddressId,
                fulfilment_mode = :fulfilmentMode,
                cadence_days = :cadenceDays,
                quantity_multiplier = :quantityMultiplier,
                status = :status,
                next_order_at = :nextOrderAt,
                last_reminded_at = :lastRemindedAt,
                time_zone = :timeZone,
                version = :nextVersion,
                updated_at = :updatedAt
            WHERE id = :id AND customer_id = :customerId AND version = :expectedVersion
            """.trimIndent(),
        )
            .param("deliveryAddressId", updated.deliveryAddressId)
            .param("fulfilmentMode", updated.fulfilmentMode)
            .param("cadenceDays", updated.cadenceDays)
            .param("quantityMultiplier", updated.quantityMultiplier)
            .param("status", updated.status.name)
            .param("nextOrderAt", updated.nextOrderAt.jdbcTimestamp())
            .param("lastRemindedAt", updated.lastRemindedAt?.jdbcTimestamp())
            .param("timeZone", updated.timeZone)
            .param("nextVersion", updated.version)
            .param("updatedAt", updated.updatedAt.jdbcTimestamp())
            .param("id", updated.id)
            .param("customerId", updated.customerId)
            .param("expectedVersion", current.version)
            .update()
        if (changed != 1) conflict()
    }

    private fun lockSubscription(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription? =
        jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_subscription
            WHERE id = :id AND customer_id = :customerId
            FOR UPDATE
            """.trimIndent(),
        )
            .param("id", subscriptionId)
            .param("customerId", customerId)
            .query(::mapSubscription)
            .optional()
            .orElse(null)

    private fun lockSubscriptionById(subscriptionId: UUID): RecurringOrderSubscription? =
        jdbc.sql("SELECT * FROM mypet.recurring_order_subscription WHERE id = :id FOR UPDATE")
            .param("id", subscriptionId)
            .query(::mapSubscription)
            .optional()
            .orElse(null)

    private fun lockProposal(customerId: UUID, proposalId: UUID): RenewalProposal? =
        jdbc.sql(
            "SELECT * FROM mypet.recurring_order_proposal WHERE id = :id AND customer_id = :customerId FOR UPDATE",
        )
            .param("id", proposalId)
            .param("customerId", customerId)
            .query(::mapProposal)
            .optional()
            .orElse(null)

    private fun lockProposal(customerId: UUID, subscriptionId: UUID, proposalId: UUID): RenewalProposal? =
        jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_proposal
            WHERE id = :id AND subscription_id = :subscriptionId AND customer_id = :customerId
            FOR UPDATE
            """.trimIndent(),
        )
            .param("id", proposalId)
            .param("subscriptionId", subscriptionId)
            .param("customerId", customerId)
            .query(::mapProposal)
            .optional()
            .orElse(null)

    private fun existingProposal(subscriptionId: UUID, dueCycleAt: Instant): RenewalProposal? =
        jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_proposal
            WHERE subscription_id = :subscriptionId AND due_cycle_at = :dueCycleAt
            """.trimIndent(),
        )
            .param("subscriptionId", subscriptionId)
            .param("dueCycleAt", dueCycleAt.jdbcTimestamp())
            .query(::mapProposal)
            .optional()
            .orElse(null)

    private fun proposalOwner(proposalId: UUID): Pair<UUID, UUID>? =
        jdbc.sql("SELECT customer_id, subscription_id FROM mypet.recurring_order_proposal WHERE id = :id")
            .param("id", proposalId)
            .query { result, _ ->
                checkNotNull(result.getObject("customer_id", UUID::class.java)) to
                    checkNotNull(result.getObject("subscription_id", UUID::class.java))
            }
            .optional()
            .orElse(null)

    private fun skipOutstandingProposals(
        subscription: RecurringOrderSubscription,
        now: Instant,
        actorId: UUID,
        idempotencyKey: String,
        traceId: String,
    ) {
        val open = jdbc.sql(
            """
            SELECT * FROM mypet.recurring_order_proposal
            WHERE subscription_id = :subscriptionId
              AND status IN ('AWAITING_CONFIRMATION', 'REVALIDATION_FAILED', 'CONFIRMED')
            ORDER BY due_cycle_at, id
            FOR UPDATE
            """.trimIndent(),
        )
            .param("subscriptionId", subscription.id)
            .query(::mapProposal)
            .list()
        open.forEach { proposal ->
            val skipped = updateProposal(
                proposal,
                proposal.copy(
                    status = RenewalProposalStatus.SKIPPED,
                    failureReason = "SUBSCRIPTION_MUTATED",
                    updatedAt = now,
                ),
            )
            insertHistory(
                subscription.id,
                proposal.id,
                "PROPOSAL_SKIPPED",
                actorId,
                "CUSTOMER",
                "API",
                idempotencyKey,
                traceId,
                skipped.failureReason,
                now,
            )
        }
    }

    private fun insertProposal(proposal: RenewalProposal) {
        jdbc.sql(
            """
            INSERT INTO mypet.recurring_order_proposal (
                id, subscription_id, customer_id, provider_id, source_order_id, delivery_address_id,
                fulfilment_mode, cadence_days, quantity_multiplier, due_cycle_at, status, expires_at,
                revalidated_at, confirmed_at, order_id, checkout_idempotency_key, failure_reason,
                version, created_at, updated_at
            ) VALUES (
                :id, :subscriptionId, :customerId, :providerId, :sourceOrderId, :deliveryAddressId,
                :fulfilmentMode, :cadenceDays, :quantityMultiplier, :dueCycleAt, :status, :expiresAt,
                :revalidatedAt, :confirmedAt, :orderId, :checkoutIdempotencyKey, :failureReason,
                :version, :createdAt, :updatedAt
            )
            """.trimIndent(),
        )
            .param("id", proposal.id)
            .param("subscriptionId", proposal.subscriptionId)
            .param("customerId", proposal.customerId)
            .param("providerId", proposal.providerId)
            .param("sourceOrderId", proposal.sourceOrderId)
            .param("deliveryAddressId", proposal.deliveryAddressId)
            .param("fulfilmentMode", proposal.fulfilmentMode)
            .param("cadenceDays", proposal.cadenceDays)
            .param("quantityMultiplier", proposal.quantityMultiplier)
            .param("dueCycleAt", proposal.dueCycleAt.jdbcTimestamp())
            .param("status", proposal.status.name)
            .param("expiresAt", proposal.expiresAt.jdbcTimestamp())
            .param("revalidatedAt", proposal.revalidatedAt?.jdbcTimestamp())
            .param("confirmedAt", proposal.confirmedAt?.jdbcTimestamp())
            .param("orderId", proposal.orderId)
            .param("checkoutIdempotencyKey", proposal.checkoutIdempotencyKey)
            .param("failureReason", proposal.failureReason)
            .param("version", proposal.version)
            .param("createdAt", proposal.createdAt.jdbcTimestamp())
            .param("updatedAt", proposal.updatedAt.jdbcTimestamp())
            .update()
    }

    private fun updateProposal(current: RenewalProposal, requested: RenewalProposal): RenewalProposal {
        val next = requested.copy(version = current.version + 1)
        val changed = jdbc.sql(
            """
            UPDATE mypet.recurring_order_proposal
            SET delivery_address_id = :deliveryAddressId,
                status = :status,
                revalidated_at = :revalidatedAt,
                confirmed_at = :confirmedAt,
                order_id = :orderId,
                checkout_idempotency_key = :checkoutIdempotencyKey,
                failure_reason = :failureReason,
                version = :nextVersion,
                updated_at = :updatedAt
            WHERE id = :id AND version = :expectedVersion
            """.trimIndent(),
        )
            .param("deliveryAddressId", next.deliveryAddressId)
            .param("status", next.status.name)
            .param("revalidatedAt", next.revalidatedAt?.jdbcTimestamp())
            .param("confirmedAt", next.confirmedAt?.jdbcTimestamp())
            .param("orderId", next.orderId)
            .param("checkoutIdempotencyKey", next.checkoutIdempotencyKey)
            .param("failureReason", next.failureReason)
            .param("nextVersion", next.version)
            .param("updatedAt", next.updatedAt.jdbcTimestamp())
            .param("id", next.id)
            .param("expectedVersion", current.version)
            .update()
        if (changed != 1) conflict()
        return next
    }

    private fun advanceSubscription(subscription: RecurringOrderSubscription, nextOrderAt: Instant, now: Instant) {
        val changed = jdbc.sql(
            """
            UPDATE mypet.recurring_order_subscription
            SET next_order_at = :nextOrderAt, version = version + 1, updated_at = :now
            WHERE id = :id AND version = :version
            """.trimIndent(),
        )
            .param("nextOrderAt", nextOrderAt.jdbcTimestamp())
            .param("now", now.jdbcTimestamp())
            .param("id", subscription.id)
            .param("version", subscription.version)
            .update()
        if (changed != 1) conflict()
    }

    private fun command(customerId: UUID, key: String): CommandRow? =
        jdbc.sql(
            """
            SELECT request_fingerprint, command_type, subscription_id, proposal_id
            FROM mypet.recurring_order_command
            WHERE customer_id = :customerId AND idempotency_key = :key
            """.trimIndent(),
        )
            .param("customerId", customerId)
            .param("key", key)
            .query { result, _ ->
                CommandRow(
                    fingerprint = result.getString("request_fingerprint"),
                    type = result.getString("command_type"),
                    subscriptionId = checkNotNull(result.getObject("subscription_id", UUID::class.java)),
                    proposalId = result.getObject("proposal_id", UUID::class.java),
                )
            }
            .optional()
            .orElse(null)

    private fun insertCommand(
        customerId: UUID,
        key: String,
        fingerprint: String,
        type: String,
        subscriptionId: UUID,
        proposalId: UUID?,
    ) {
        jdbc.sql(
            """
            INSERT INTO mypet.recurring_order_command (
                customer_id, idempotency_key, request_fingerprint, command_type, subscription_id, proposal_id
            ) VALUES (:customerId, :key, :fingerprint, :type, :subscriptionId, :proposalId)
            """.trimIndent(),
        )
            .param("customerId", customerId)
            .param("key", key)
            .param("fingerprint", fingerprint)
            .param("type", type)
            .param("subscriptionId", subscriptionId)
            .param("proposalId", proposalId)
            .update()
    }

    private fun verifyCommand(existing: CommandRow, fingerprint: String, type: String) {
        if (existing.fingerprint != fingerprint || existing.type != type) idempotencyMismatch()
    }

    private fun insertHistory(
        subscriptionId: UUID,
        proposalId: UUID?,
        eventType: String,
        actorId: UUID,
        actorRole: String,
        source: String,
        idempotencyKey: String,
        traceId: String,
        details: String?,
        occurredAt: Instant,
    ) {
        jdbc.sql(
            """
            INSERT INTO mypet.recurring_order_history (
                id, subscription_id, proposal_id, event_type, actor_id, actor_role, source,
                idempotency_key, trace_id, details, occurred_at
            ) VALUES (
                :id, :subscriptionId, :proposalId, :eventType, :actorId, :actorRole, :source,
                :idempotencyKey, :traceId, :details, :occurredAt
            )
            """.trimIndent(),
        )
            .param("id", UUID.randomUUID())
            .param("subscriptionId", subscriptionId)
            .param("proposalId", proposalId)
            .param("eventType", eventType)
            .param("actorId", actorId)
            .param("actorRole", actorRole)
            .param("source", source)
            .param("idempotencyKey", idempotencyKey)
            .param("traceId", traceId.take(128))
            .param("details", details?.take(1000))
            .param("occurredAt", occurredAt.jdbcTimestamp())
            .update()
    }

    private fun mapSubscription(result: java.sql.ResultSet, @Suppress("UNUSED_PARAMETER") row: Int) = RecurringOrderSubscription(
        id = checkNotNull(result.getObject("id", UUID::class.java)),
        customerId = checkNotNull(result.getObject("customer_id", UUID::class.java)),
        providerId = checkNotNull(result.getObject("provider_id", UUID::class.java)),
        sourceOrderId = checkNotNull(result.getObject("source_order_id", UUID::class.java)),
        deliveryAddressId = result.getObject("delivery_address_id", UUID::class.java),
        fulfilmentMode = result.getString("fulfilment_mode"),
        cadenceDays = result.getInt("cadence_days"),
        quantityMultiplier = result.getInt("quantity_multiplier"),
        status = RecurringOrderStatus.valueOf(result.getString("status")),
        nextOrderAt = result.getTimestamp("next_order_at").toInstant(),
        lastRemindedAt = result.getTimestamp("last_reminded_at")?.toInstant(),
        timeZone = result.getString("time_zone"),
        version = result.getLong("version"),
        createdAt = result.getTimestamp("created_at").toInstant(),
        updatedAt = result.getTimestamp("updated_at").toInstant(),
    )

    private fun mapProposal(result: java.sql.ResultSet, @Suppress("UNUSED_PARAMETER") row: Int) = RenewalProposal(
        id = checkNotNull(result.getObject("id", UUID::class.java)),
        subscriptionId = checkNotNull(result.getObject("subscription_id", UUID::class.java)),
        customerId = checkNotNull(result.getObject("customer_id", UUID::class.java)),
        providerId = checkNotNull(result.getObject("provider_id", UUID::class.java)),
        sourceOrderId = checkNotNull(result.getObject("source_order_id", UUID::class.java)),
        deliveryAddressId = result.getObject("delivery_address_id", UUID::class.java),
        fulfilmentMode = result.getString("fulfilment_mode"),
        cadenceDays = result.getInt("cadence_days"),
        quantityMultiplier = result.getInt("quantity_multiplier"),
        dueCycleAt = result.getTimestamp("due_cycle_at").toInstant(),
        status = RenewalProposalStatus.valueOf(result.getString("status")),
        expiresAt = result.getTimestamp("expires_at").toInstant(),
        revalidatedAt = result.getTimestamp("revalidated_at")?.toInstant(),
        confirmedAt = result.getTimestamp("confirmed_at")?.toInstant(),
        orderId = result.getObject("order_id", UUID::class.java),
        checkoutIdempotencyKey = result.getString("checkout_idempotency_key"),
        failureReason = result.getString("failure_reason"),
        version = result.getLong("version"),
        createdAt = result.getTimestamp("created_at").toInstant(),
        updatedAt = result.getTimestamp("updated_at").toInstant(),
    )


    private fun Instant.jdbcTimestamp(): Timestamp = Timestamp.from(this)

    private fun <T> tx(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("Recurring-order transaction returned no result")

    private fun <T> txNullable(block: () -> T?): T? = transactions.execute { block() }

    private fun dueKey(subscription: RecurringOrderSubscription): String =
        "due:${subscription.id}:${subscription.nextOrderAt.epochSecond}"

    private fun conflict(): Nothing = throw DomainException(
        "RECURRING_CONFLICT",
        "The recurring schedule changed concurrently; refresh and retry",
    )

    private fun unavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )

    private fun alreadyExists(): Nothing = throw DomainException(
        "RECURRING_ALREADY_EXISTS",
        "A recurring schedule already exists for this source order",
    )

    private fun invalidProposalState(): Nothing = throw DomainException(
        "PROPOSAL_STATE_INVALID",
        "The renewal proposal cannot perform that action",
    )

    private fun idempotencyMismatch(): Nothing = throw DomainException(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        "The idempotency key was already used for another request",
    )
}
