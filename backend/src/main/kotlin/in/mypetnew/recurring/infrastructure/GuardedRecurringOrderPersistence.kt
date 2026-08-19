package `in`.mypetnew.recurring.infrastructure

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
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID

/**
 * Production-only database guard around the JDBC persistence implementation.
 *
 * Confirmation, expiry and subscription mutation all use the same lock order:
 * subscription row first, proposal row second. The delegate's TransactionTemplate
 * uses REQUIRED propagation, so its mutation joins this transaction. This closes
 * the pre-read race where EXPIRED/SKIPPED could otherwise be resurrected as
 * CONFIRMED by a request that started slightly earlier on another API node.
 */
class GuardedRecurringOrderPersistence(
    private val delegate: RecurringOrderPersistence,
    private val jdbc: JdbcClient,
    private val transactions: TransactionTemplate,
) : RecurringOrderPersistence by delegate {
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
        if (eventType != "PROPOSAL_CONFIRMED") {
            return delegate.mutateProposal(
                customerId,
                subscriptionId,
                proposalId,
                idempotencyKey,
                requestFingerprint,
                eventType,
                actorId,
                traceId,
                mutation,
            )
        }

        return transactions.execute {
            val subscriptionStatus = jdbc.sql(
                """
                SELECT status
                FROM mypet.recurring_order_subscription
                WHERE id = :subscriptionId AND customer_id = :customerId
                FOR UPDATE
                """.trimIndent(),
            )
                .param("subscriptionId", subscriptionId)
                .param("customerId", customerId)
                .query(String::class.java)
                .optional()
                .orElseThrow { unavailable() }

            if (subscriptionStatus != RecurringOrderStatus.ACTIVE.name) invalidProposalState()

            val proposalStatus = jdbc.sql(
                """
                SELECT status
                FROM mypet.recurring_order_proposal
                WHERE id = :proposalId
                  AND subscription_id = :subscriptionId
                  AND customer_id = :customerId
                FOR UPDATE
                """.trimIndent(),
            )
                .param("proposalId", proposalId)
                .param("subscriptionId", subscriptionId)
                .param("customerId", customerId)
                .query(String::class.java)
                .optional()
                .orElseThrow { unavailable() }

            if (proposalStatus !in setOf(
                    RenewalProposalStatus.AWAITING_CONFIRMATION.name,
                    RenewalProposalStatus.REVALIDATION_FAILED.name,
                    RenewalProposalStatus.CONFIRMED.name,
                )
            ) {
                invalidProposalState()
            }

            delegate.mutateProposal(
                customerId,
                subscriptionId,
                proposalId,
                idempotencyKey,
                requestFingerprint,
                eventType,
                actorId,
                traceId,
                mutation,
            )
        } ?: throw IllegalStateException("Recurring confirmation transaction returned no result")
    }

    // Explicitly repeat signatures below to keep the decorator's authority obvious
    // to static analyzers and future refactors; all non-confirm paths delegate.
    override fun create(
        subscription: RecurringOrderSubscription,
        idempotencyKey: String,
        requestFingerprint: String,
        actorId: UUID,
        traceId: String,
    ) = delegate.create(subscription, idempotencyKey, requestFingerprint, actorId, traceId)

    override fun get(customerId: UUID, subscriptionId: UUID) = delegate.get(customerId, subscriptionId)
    override fun findBySource(customerId: UUID, sourceOrderId: UUID) = delegate.findBySource(customerId, sourceOrderId)
    override fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage = delegate.list(customerId, page, pageSize)

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
    ) = delegate.update(
        customerId,
        subscriptionId,
        idempotencyKey,
        requestFingerprint,
        eventType,
        actorId,
        traceId,
        outstandingProposalAction,
        updater,
    )

    override fun createDueProposals(now: Instant, expiresAt: Instant, limit: Int) =
        delegate.createDueProposals(now, expiresAt, limit)

    override fun expireProposals(now: Instant, limit: Int) = delegate.expireProposals(now, limit)
    override fun listProposals(customerId: UUID, page: Int, pageSize: Int): RenewalProposalPage =
        delegate.listProposals(customerId, page, pageSize)

    override fun getProposal(customerId: UUID, proposalId: UUID) = delegate.getProposal(customerId, proposalId)
    override fun getProposal(customerId: UUID, subscriptionId: UUID, proposalId: UUID) =
        delegate.getProposal(customerId, subscriptionId, proposalId)

    override fun markOrderCreated(
        customerId: UUID,
        proposalId: UUID,
        orderId: UUID,
        checkoutIdempotencyKey: String,
        actorId: UUID,
        traceId: String,
        now: Instant,
    ) = delegate.markOrderCreated(customerId, proposalId, orderId, checkoutIdempotencyKey, actorId, traceId, now)

    override fun history(customerId: UUID, subscriptionId: UUID): List<RecurringHistoryEntry> =
        delegate.history(customerId, subscriptionId)

    private fun unavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )

    private fun invalidProposalState(): Nothing = throw DomainException(
        "PROPOSAL_STATE_INVALID",
        "The renewal proposal cannot perform that action",
    )
}
