package `in`.mypetnew.recurring.domain

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.ListingKind
import `in`.mypetnew.commerce.domain.CustomerOrderDetailSnapshot
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.commerce.domain.ProductOrder
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderOutlet
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

private val ALLOWED_CADENCES = setOf(7, 15, 25, 30, 35)
private const val MAX_QUANTITY_MULTIPLIER = 20
private const val DEFAULT_TIME_ZONE = "Asia/Kolkata"
private const val STORE_PICKUP = "STORE_PICKUP"
private const val CAPTAIN_DELIVERY = "MYPET_CAPTAIN_DELIVERY"

enum class RecurringOrderStatus {
    ACTIVE,
    PAUSED,
    /** Historical V20 compatibility only. New code never writes this state. */
    AWAITING_CONFIRMATION,
    CANCELLED,
}

enum class RenewalProposalStatus {
    DUE,
    REVALIDATION_FAILED,
    AWAITING_CONFIRMATION,
    CONFIRMED,
    ORDER_CREATED,
    EXPIRED,
    SKIPPED,
}

enum class OutstandingProposalAction { NONE, SKIP }

data class RecurringOrderSubscription(
    val id: UUID,
    val customerId: UUID,
    val providerId: UUID,
    val sourceOrderId: UUID,
    val deliveryAddressId: UUID?,
    val fulfilmentMode: String,
    val cadenceDays: Int,
    val quantityMultiplier: Int,
    val status: RecurringOrderStatus,
    val nextOrderAt: Instant,
    val lastRemindedAt: Instant?,
    val timeZone: String = DEFAULT_TIME_ZONE,
    val version: Long = 0,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class RecurringOrderPage(val items: List<RecurringOrderSubscription>, val hasNext: Boolean)

data class RenewalProposal(
    val id: UUID,
    val subscriptionId: UUID,
    val customerId: UUID,
    val providerId: UUID,
    val sourceOrderId: UUID,
    val deliveryAddressId: UUID?,
    val fulfilmentMode: String,
    val cadenceDays: Int,
    val quantityMultiplier: Int,
    val dueCycleAt: Instant,
    val status: RenewalProposalStatus,
    val expiresAt: Instant,
    val revalidatedAt: Instant?,
    val confirmedAt: Instant?,
    val orderId: UUID?,
    val checkoutIdempotencyKey: String?,
    val failureReason: String?,
    val version: Long = 0,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class RenewalProposalPage(val items: List<RenewalProposal>, val hasNext: Boolean)

data class RecurringHistoryEntry(
    val id: UUID,
    val subscriptionId: UUID,
    val proposalId: UUID?,
    val eventType: String,
    val actorId: UUID,
    val actorRole: String,
    val source: String,
    val idempotencyKey: String,
    val traceId: String,
    val details: String?,
    val occurredAt: Instant,
)

data class ProposalMutation<T>(val proposal: RenewalProposal, val value: T)

interface RecurringOrderPersistence {
    fun create(
        subscription: RecurringOrderSubscription,
        idempotencyKey: String,
        requestFingerprint: String,
        actorId: UUID,
        traceId: String,
    ): RecurringOrderSubscription

    fun get(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription?
    fun findBySource(customerId: UUID, sourceOrderId: UUID): RecurringOrderSubscription?
    fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage

    fun update(
        customerId: UUID,
        subscriptionId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
        eventType: String,
        actorId: UUID,
        traceId: String,
        outstandingProposalAction: OutstandingProposalAction,
        updater: (RecurringOrderSubscription) -> RecurringOrderSubscription,
    ): RecurringOrderSubscription

    fun createDueProposals(now: Instant, expiresAt: Instant, limit: Int): List<RenewalProposal>
    fun expireProposals(now: Instant, limit: Int): Int
    fun listProposals(customerId: UUID, page: Int, pageSize: Int): RenewalProposalPage
    fun getProposal(customerId: UUID, proposalId: UUID): RenewalProposal?
    fun getProposal(customerId: UUID, subscriptionId: UUID, proposalId: UUID): RenewalProposal?

    fun <T> mutateProposal(
        customerId: UUID,
        subscriptionId: UUID,
        proposalId: UUID,
        idempotencyKey: String,
        requestFingerprint: String,
        eventType: String,
        actorId: UUID,
        traceId: String,
        mutation: (RecurringOrderSubscription, RenewalProposal, Boolean) -> ProposalMutation<T>,
    ): ProposalMutation<T>

    fun markOrderCreated(
        customerId: UUID,
        proposalId: UUID,
        orderId: UUID,
        checkoutIdempotencyKey: String,
        actorId: UUID,
        traceId: String,
        now: Instant,
    ): RenewalProposal

    fun history(customerId: UUID, subscriptionId: UUID): List<RecurringHistoryEntry>
}

private data class InMemoryCommand(
    val fingerprint: String,
    val type: String,
    val subscriptionId: UUID,
    val proposalId: UUID?,
)

class InMemoryRecurringOrderPersistence : RecurringOrderPersistence {
    private val subscriptions = linkedMapOf<UUID, RecurringOrderSubscription>()
    private val proposals = linkedMapOf<UUID, RenewalProposal>()
    private val commands = mutableMapOf<Pair<UUID, String>, InMemoryCommand>()
    private val history = mutableListOf<RecurringHistoryEntry>()

    @Synchronized
    override fun create(
        subscription: RecurringOrderSubscription,
        idempotencyKey: String,
        requestFingerprint: String,
        actorId: UUID,
        traceId: String,
    ): RecurringOrderSubscription {
        replay(subscription.customerId, idempotencyKey, requestFingerprint, "CREATE")?.let {
            return subscriptions[it.subscriptionId] ?: unavailable()
        }
        if (findBySource(subscription.customerId, subscription.sourceOrderId) != null) alreadyExists()
        subscriptions[subscription.id] = subscription
        commands[subscription.customerId to idempotencyKey] = InMemoryCommand(requestFingerprint, "CREATE", subscription.id, null)
        appendHistory(subscription, null, "SUBSCRIPTION_CREATED", actorId, "CUSTOMER", "API", idempotencyKey, traceId)
        return subscription
    }

    @Synchronized
    override fun get(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription? =
        subscriptions[subscriptionId]?.takeIf { it.customerId == customerId }

    @Synchronized
    override fun findBySource(customerId: UUID, sourceOrderId: UUID): RecurringOrderSubscription? =
        subscriptions.values.firstOrNull { it.customerId == customerId && it.sourceOrderId == sourceOrderId }

    @Synchronized
    override fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage {
        val ordered = subscriptions.values.filter { it.customerId == customerId }
            .sortedWith(compareByDescending<RecurringOrderSubscription> { it.createdAt }.thenByDescending { it.id.toString() })
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= ordered.size.toLong()) return RecurringOrderPage(emptyList(), false)
        val candidates = ordered.drop(offset.toInt()).take(pageSize + 1)
        return RecurringOrderPage(candidates.take(pageSize), candidates.size > pageSize)
    }

    @Synchronized
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
        replay(customerId, idempotencyKey, requestFingerprint, eventType)?.let {
            return get(customerId, it.subscriptionId) ?: unavailable()
        }
        val current = get(customerId, subscriptionId) ?: unavailable()
        if (outstandingProposalAction == OutstandingProposalAction.SKIP) {
            skipOutstandingProposal(current, actorId, idempotencyKey, traceId)
        }
        val updated = updater(current).copy(version = current.version + 1)
        subscriptions[current.id] = updated
        commands[customerId to idempotencyKey] = InMemoryCommand(requestFingerprint, eventType, current.id, null)
        appendHistory(updated, null, eventType, actorId, "CUSTOMER", "API", idempotencyKey, traceId)
        return updated
    }

    @Synchronized
    override fun createDueProposals(now: Instant, expiresAt: Instant, limit: Int): List<RenewalProposal> {
        val due = subscriptions.values
            .filter { it.status == RecurringOrderStatus.ACTIVE && !it.nextOrderAt.isAfter(now) }
            .filter { subscription -> proposals.values.none { it.subscriptionId == subscription.id && it.dueCycleAt == subscription.nextOrderAt } }
            .sortedWith(compareBy<RecurringOrderSubscription> { it.nextOrderAt }.thenBy { it.id.toString() })
            .take(limit)
        return due.map { subscription ->
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
            proposals[proposal.id] = proposal
            subscriptions[subscription.id] = subscription.copy(lastRemindedAt = now, version = subscription.version + 1, updatedAt = now)
            appendHistory(subscription, proposal, "PROPOSAL_CREATED", InventoryService.SYSTEM_ACTOR_ID, "SYSTEM", "SCHEDULER", dueKey(subscription), "recurring-scheduler")
            proposal
        }
    }

    @Synchronized
    override fun expireProposals(now: Instant, limit: Int): Int {
        val expirable = proposals.values.filter {
            it.status in setOf(
                RenewalProposalStatus.AWAITING_CONFIRMATION,
                RenewalProposalStatus.REVALIDATION_FAILED,
                RenewalProposalStatus.CONFIRMED,
            ) && !it.expiresAt.isAfter(now)
        }.sortedWith(compareBy<RenewalProposal> { it.expiresAt }.thenBy { it.id.toString() }).take(limit)
        expirable.forEach { proposal ->
            val expired = proposal.copy(
                status = RenewalProposalStatus.EXPIRED,
                failureReason = proposal.failureReason ?: "PROPOSAL_EXPIRED",
                version = proposal.version + 1,
                updatedAt = now,
            )
            proposals[proposal.id] = expired
            val subscription = subscriptions[proposal.subscriptionId]
            if (subscription != null && subscription.status == RecurringOrderStatus.ACTIVE && subscription.nextOrderAt == proposal.dueCycleAt) {
                subscriptions[subscription.id] = subscription.copy(
                    nextOrderAt = anchoredNext(proposal.dueCycleAt, proposal.cadenceDays),
                    version = subscription.version + 1,
                    updatedAt = now,
                )
            }
            if (subscription != null) appendHistory(subscription, expired, "PROPOSAL_EXPIRED", InventoryService.SYSTEM_ACTOR_ID, "SYSTEM", "SCHEDULER", "expire:${proposal.id}", "recurring-scheduler")
        }
        return expirable.size
    }

    @Synchronized
    override fun listProposals(customerId: UUID, page: Int, pageSize: Int): RenewalProposalPage {
        val ordered = proposals.values.filter { it.customerId == customerId }
            .sortedWith(compareByDescending<RenewalProposal> { it.createdAt }.thenByDescending { it.id.toString() })
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= ordered.size.toLong()) return RenewalProposalPage(emptyList(), false)
        val candidates = ordered.drop(offset.toInt()).take(pageSize + 1)
        return RenewalProposalPage(candidates.take(pageSize), candidates.size > pageSize)
    }

    @Synchronized
    override fun getProposal(customerId: UUID, proposalId: UUID): RenewalProposal? = proposals[proposalId]?.takeIf { it.customerId == customerId }

    @Synchronized
    override fun getProposal(customerId: UUID, subscriptionId: UUID, proposalId: UUID): RenewalProposal? =
        proposals[proposalId]?.takeIf { it.customerId == customerId && it.subscriptionId == subscriptionId }

    @Synchronized
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
        val replay = replay(customerId, idempotencyKey, requestFingerprint, eventType)
        val subscription = get(customerId, subscriptionId) ?: unavailable()
        val current = getProposal(customerId, subscriptionId, proposalId) ?: unavailable()
        if (replay != null) return mutation(subscription, current, true).copy(proposal = current)
        val requested = mutation(subscription, current, false)
        val stored = requested.proposal.copy(version = current.version + 1)
        proposals[proposalId] = stored
        commands[customerId to idempotencyKey] = InMemoryCommand(requestFingerprint, eventType, subscriptionId, proposalId)
        appendHistory(subscription, stored, eventType, actorId, "CUSTOMER", "API", idempotencyKey, traceId, stored.failureReason)
        return requested.copy(proposal = stored)
    }

    @Synchronized
    override fun markOrderCreated(
        customerId: UUID,
        proposalId: UUID,
        orderId: UUID,
        checkoutIdempotencyKey: String,
        actorId: UUID,
        traceId: String,
        now: Instant,
    ): RenewalProposal {
        val proposal = getProposal(customerId, proposalId) ?: unavailable()
        if (proposal.status == RenewalProposalStatus.ORDER_CREATED) {
            if (proposal.orderId != orderId || proposal.checkoutIdempotencyKey != checkoutIdempotencyKey) idempotencyMismatch()
            return proposal
        }
        if (proposal.status != RenewalProposalStatus.CONFIRMED) invalidProposalState()
        val completed = proposal.copy(
            status = RenewalProposalStatus.ORDER_CREATED,
            orderId = orderId,
            checkoutIdempotencyKey = checkoutIdempotencyKey,
            failureReason = null,
            version = proposal.version + 1,
            updatedAt = now,
        )
        proposals[proposalId] = completed
        val subscription = get(customerId, proposal.subscriptionId) ?: unavailable()
        if (subscription.status == RecurringOrderStatus.ACTIVE && subscription.nextOrderAt == proposal.dueCycleAt) {
            subscriptions[subscription.id] = subscription.copy(
                nextOrderAt = anchoredNext(proposal.dueCycleAt, proposal.cadenceDays),
                version = subscription.version + 1,
                updatedAt = now,
            )
        }
        appendHistory(subscription, completed, "ORDER_CREATED", actorId, "CUSTOMER", "CHECKOUT", checkoutIdempotencyKey, traceId, orderId.toString())
        return completed
    }

    @Synchronized
    override fun history(customerId: UUID, subscriptionId: UUID): List<RecurringHistoryEntry> =
        history.filter { it.subscriptionId == subscriptionId && subscriptions[subscriptionId]?.customerId == customerId }
            .sortedWith(compareBy<RecurringHistoryEntry> { it.occurredAt }.thenBy { it.id.toString() })

    private fun replay(customerId: UUID, key: String, fingerprint: String, type: String): InMemoryCommand? {
        val existing = commands[customerId to key] ?: return null
        if (existing.fingerprint != fingerprint || existing.type != type) idempotencyMismatch()
        return existing
    }

    private fun skipOutstandingProposal(subscription: RecurringOrderSubscription, actorId: UUID, idempotencyKey: String, traceId: String) {
        proposals.values.filter {
            it.subscriptionId == subscription.id && it.status in setOf(
                RenewalProposalStatus.AWAITING_CONFIRMATION,
                RenewalProposalStatus.REVALIDATION_FAILED,
                RenewalProposalStatus.CONFIRMED,
            )
        }.forEach { current ->
            val skipped = current.copy(
                status = RenewalProposalStatus.SKIPPED,
                failureReason = "SUBSCRIPTION_MUTATED",
                version = current.version + 1,
                updatedAt = subscription.updatedAt,
            )
            proposals[current.id] = skipped
            appendHistory(subscription, skipped, "PROPOSAL_SKIPPED", actorId, "CUSTOMER", "API", idempotencyKey, traceId)
        }
    }

    private fun appendHistory(
        subscription: RecurringOrderSubscription,
        proposal: RenewalProposal?,
        eventType: String,
        actorId: UUID,
        actorRole: String,
        source: String,
        idempotencyKey: String,
        traceId: String,
        details: String? = null,
    ) {
        history += RecurringHistoryEntry(
            id = UUID.randomUUID(), subscriptionId = subscription.id, proposalId = proposal?.id,
            eventType = eventType, actorId = actorId, actorRole = actorRole, source = source,
            idempotencyKey = idempotencyKey, traceId = traceId, details = details,
            occurredAt = proposal?.updatedAt ?: subscription.updatedAt,
        )
    }
}

data class RecurringRevalidationItem(
    val listingId: UUID,
    val name: String,
    val quantity: Int,
    val unitPricePaise: Long,
    val available: Boolean,
    val failureReason: String? = null,
)

data class RecurringOrderConfirmation(
    val subscription: RecurringOrderSubscription,
    val proposal: RenewalProposal,
    val originalOrderId: UUID,
    val providerId: UUID,
    val providerServiceable: Boolean,
    val items: List<RecurringRevalidationItem>,
    val canReorder: Boolean,
    val createdOrderId: UUID? = null,
)

data class RecurringSchedulerResult(val proposalsCreated: Int, val proposalsExpired: Int)

class RecurringOrderService(
    private val persistence: RecurringOrderPersistence,
    private val orderQuery: CustomerOrderQuery,
    private val catalog: CatalogService,
    private val providers: ProviderService,
    private val customerData: CustomerDataService,
    private val inventory: InventoryService,
    private val clock: Clock = Clock.systemUTC(),
    private val proposalTtl: Duration = Duration.ofHours(72),
) {
    fun create(
        customerId: UUID,
        sourceOrderId: UUID,
        cadenceDays: Int,
        quantityMultiplier: Int,
        idempotencyKey: String,
        traceId: String = "recurring-create",
    ): RecurringOrderSubscription {
        validateCadence(cadenceDays)
        validateQuantity(quantityMultiplier)
        validateIdempotencyKey(idempotencyKey)
        val source = requireDeliveredSource(customerId, sourceOrderId)
        val outlet = requireProvider(source.outletId)
        val fulfilmentMode = validateFulfilmentMode(source.fulfilmentMode)
        val addressId = when (fulfilmentMode) {
            STORE_PICKUP -> null
            CAPTAIN_DELIVERY -> {
                val addresses = customerData.listAddresses(customerId)
                val address = addresses.firstOrNull { it.isDefault } ?: addresses.firstOrNull()
                    ?: throw DomainException("ADDRESS_REQUIRED", "A delivery address is required for recurring Captain delivery")
                if (!isServiceable(outlet, fulfilmentMode, address.pincode)) {
                    throw DomainException("OUTLET_NOT_SERVICEABLE", "The delivery address is not currently serviceable")
                }
                address.id
            }
            else -> error("unreachable")
        }
        validateReusableSourceItems(source, outlet)
        val now = clock.instant()
        val subscription = RecurringOrderSubscription(
            id = UUID.randomUUID(), customerId = customerId, providerId = source.outletId,
            sourceOrderId = source.orderId, deliveryAddressId = addressId, fulfilmentMode = fulfilmentMode,
            cadenceDays = cadenceDays, quantityMultiplier = quantityMultiplier, status = RecurringOrderStatus.ACTIVE,
            nextOrderAt = now.plus(Duration.ofDays(cadenceDays.toLong())), lastRemindedAt = null,
            timeZone = DEFAULT_TIME_ZONE, createdAt = now, updatedAt = now,
        )
        return persistence.create(
            subscription, idempotencyKey,
            fingerprint("CREATE", sourceOrderId, cadenceDays, quantityMultiplier, fulfilmentMode, addressId),
            customerId, traceId,
        )
    }

    fun create(customerId: UUID, sourceOrderId: UUID, cadenceDays: Int, quantityMultiplier: Int): RecurringOrderSubscription =
        create(customerId, sourceOrderId, cadenceDays, quantityMultiplier, "legacy-create-$sourceOrderId")

    fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage {
        validatePagination(page, pageSize)
        return persistence.list(customerId, page, pageSize)
    }

    fun listProposals(customerId: UUID, page: Int, pageSize: Int): RenewalProposalPage {
        validatePagination(page, pageSize)
        return persistence.listProposals(customerId, page, pageSize)
    }

    fun getProposal(customerId: UUID, subscriptionId: UUID, proposalId: UUID): RenewalProposal =
        persistence.getProposal(customerId, subscriptionId, proposalId) ?: unavailable()

    fun runScheduler(batchSize: Int = 100): RecurringSchedulerResult {
        if (batchSize !in 1..500) throw DomainException("BATCH_SIZE_INVALID", "Recurring scheduler batch size is invalid")
        val now = clock.instant()
        val expired = persistence.expireProposals(now, batchSize)
        val created = persistence.createDueProposals(now, now.plus(proposalTtl), batchSize)
        return RecurringSchedulerResult(created.size, expired)
    }

    fun update(
        customerId: UUID,
        subscriptionId: UUID,
        action: String,
        cadenceDays: Int?,
        quantityMultiplier: Int?,
        deliveryAddressId: UUID?,
        idempotencyKey: String = "legacy-update-${UUID.randomUUID()}",
        traceId: String = "recurring-update",
    ): RecurringOrderSubscription {
        validateIdempotencyKey(idempotencyKey)
        val normalized = action.trim().uppercase()
        val eventType = when (normalized) {
            "PAUSE" -> "PAUSED"
            "RESUME" -> "RESUMED"
            "SKIP", "SKIP_NEXT" -> "SKIPPED"
            "CANCEL" -> "CANCELLED"
            "CHANGE" -> "CHANGED"
            else -> throw DomainException("RECURRING_ACTION_INVALID", "The recurring-order action is invalid")
        }
        val fp = fingerprint("UPDATE", subscriptionId, normalized, cadenceDays, quantityMultiplier, deliveryAddressId)
        val skipOutstanding = normalized in setOf("PAUSE", "SKIP", "SKIP_NEXT", "CANCEL", "CHANGE")
        return persistence.update(
            customerId, subscriptionId, idempotencyKey, fp, eventType, customerId, traceId,
            if (skipOutstanding) OutstandingProposalAction.SKIP else OutstandingProposalAction.NONE,
        ) { current ->
            val now = clock.instant()
            when (normalized) {
                "PAUSE" -> {
                    if (current.status == RecurringOrderStatus.CANCELLED) invalidState()
                    if (current.status == RecurringOrderStatus.PAUSED) current else current.copy(status = RecurringOrderStatus.PAUSED, updatedAt = now)
                }
                "RESUME" -> {
                    if (current.status == RecurringOrderStatus.CANCELLED) invalidState()
                    if (current.status == RecurringOrderStatus.ACTIVE) current else current.copy(
                        status = RecurringOrderStatus.ACTIVE,
                        nextOrderAt = now.plus(Duration.ofDays(current.cadenceDays.toLong())),
                        updatedAt = now,
                    )
                }
                "SKIP", "SKIP_NEXT" -> {
                    if (current.status != RecurringOrderStatus.ACTIVE) invalidState()
                    current.copy(nextOrderAt = anchoredNext(current.nextOrderAt, current.cadenceDays), updatedAt = now)
                }
                "CANCEL" -> if (current.status == RecurringOrderStatus.CANCELLED) current else current.copy(
                    status = RecurringOrderStatus.CANCELLED, updatedAt = now,
                )
                "CHANGE" -> {
                    if (current.status == RecurringOrderStatus.CANCELLED) invalidState()
                    val nextCadence = cadenceDays ?: current.cadenceDays
                    val nextMultiplier = quantityMultiplier ?: current.quantityMultiplier
                    validateCadence(nextCadence)
                    validateQuantity(nextMultiplier)
                    val nextAddress = if (current.fulfilmentMode == CAPTAIN_DELIVERY) {
                        val addressId = deliveryAddressId ?: current.deliveryAddressId
                            ?: throw DomainException("ADDRESS_REQUIRED", "A delivery address is required")
                        val address = customerData.getAddress(customerId, addressId)
                        val outlet = requireProvider(current.providerId)
                        if (!isServiceable(outlet, current.fulfilmentMode, address.pincode)) {
                            throw DomainException("OUTLET_NOT_SERVICEABLE", "The delivery address is not currently serviceable")
                        }
                        address.id
                    } else null
                    if (nextCadence == current.cadenceDays && nextMultiplier == current.quantityMultiplier && nextAddress == current.deliveryAddressId) {
                        current
                    } else current.copy(
                        cadenceDays = nextCadence, quantityMultiplier = nextMultiplier, deliveryAddressId = nextAddress,
                        nextOrderAt = now.plus(Duration.ofDays(nextCadence.toLong())), updatedAt = now,
                    )
                }
                else -> error("unreachable")
            }
        }
    }

    fun confirm(
        customerId: UUID,
        subscriptionId: UUID,
        proposalId: UUID,
        idempotencyKey: String,
        traceId: String = "recurring-confirm",
    ): RecurringOrderConfirmation {
        validateIdempotencyKey(idempotencyKey)
        val now = clock.instant()
        persistence.expireProposals(now, 500)
        val currentProposal = getProposal(customerId, subscriptionId, proposalId)
        if (currentProposal.status == RenewalProposalStatus.EXPIRED) throw DomainException("PROPOSAL_EXPIRED", "The renewal proposal has expired")
        if (currentProposal.status in setOf(RenewalProposalStatus.SKIPPED, RenewalProposalStatus.ORDER_CREATED)) invalidProposalState()
        val mutation = persistence.mutateProposal(
            customerId, subscriptionId, proposalId, idempotencyKey,
            fingerprint("CONFIRM", subscriptionId, proposalId), "PROPOSAL_CONFIRMED", customerId, traceId,
        ) { subscription, proposal, _ ->
            val validation = revalidate(subscription, proposal)
            ProposalMutation(
                proposal.copy(
                    status = if (validation.canReorder) RenewalProposalStatus.CONFIRMED else RenewalProposalStatus.REVALIDATION_FAILED,
                    revalidatedAt = now,
                    confirmedAt = if (validation.canReorder) now else proposal.confirmedAt,
                    failureReason = if (validation.canReorder) null else validation.failureReason,
                    updatedAt = now,
                ),
                validation,
            )
        }
        val subscription = persistence.get(customerId, subscriptionId) ?: unavailable()
        return RecurringOrderConfirmation(
            subscription = subscription, proposal = mutation.proposal, originalOrderId = mutation.proposal.sourceOrderId,
            providerId = mutation.proposal.providerId, providerServiceable = mutation.value.providerServiceable,
            items = mutation.value.items, canReorder = mutation.value.canReorder, createdOrderId = mutation.proposal.orderId,
        )
    }

    fun confirm(customerId: UUID, subscriptionId: UUID): RecurringOrderConfirmation {
        val proposal = listProposals(customerId, 0, 100).items
            .firstOrNull { it.subscriptionId == subscriptionId && it.status != RenewalProposalStatus.ORDER_CREATED }
            ?: throw DomainException("PROPOSAL_REQUIRED", "A scheduler-created renewal proposal is required")
        return confirm(customerId, subscriptionId, proposal.id, "legacy-confirm-${proposal.id}")
    }

    fun requireConfirmedProposalForCheckout(
        customerId: UUID,
        proposalId: UUID,
        checkoutIdempotencyKey: String,
        outletId: UUID,
        fulfilmentMode: String,
        lines: Map<UUID, Int>,
    ): RenewalProposal {
        validateIdempotencyKey(checkoutIdempotencyKey)
        val proposal = persistence.getProposal(customerId, proposalId) ?: unavailable()
        if (proposal.status == RenewalProposalStatus.ORDER_CREATED) {
            if (proposal.checkoutIdempotencyKey != checkoutIdempotencyKey) {
                throw DomainException("PROPOSAL_ALREADY_PROCESSED", "The renewal proposal already created an order")
            }
            return proposal
        }
        if (proposal.status != RenewalProposalStatus.CONFIRMED) invalidProposalState()
        if (!proposal.expiresAt.isAfter(clock.instant())) throw DomainException("PROPOSAL_EXPIRED", "The renewal proposal has expired")
        if (proposal.providerId != outletId || proposal.fulfilmentMode != fulfilmentMode) {
            throw DomainException("PROPOSAL_CHECKOUT_MISMATCH", "The checkout does not match the renewal proposal")
        }
        if (expectedProposalLines(customerId, proposal) != lines) {
            throw DomainException("PROPOSAL_CHECKOUT_MISMATCH", "The checkout cart changed after renewal confirmation")
        }
        return proposal
    }

    fun completeWithOrder(
        customerId: UUID,
        proposalId: UUID,
        order: ProductOrder,
        checkoutIdempotencyKey: String,
        traceId: String,
    ): RenewalProposal {
        requireConfirmedProposalForCheckout(customerId, proposalId, checkoutIdempotencyKey, order.outletId, order.fulfilmentMode, order.lines)
        if (order.customerId != customerId) unavailable()
        return persistence.markOrderCreated(
            customerId, proposalId, order.id, checkoutIdempotencyKey, customerId, traceId, clock.instant(),
        )
    }

    fun history(customerId: UUID, subscriptionId: UUID): List<RecurringHistoryEntry> = persistence.history(customerId, subscriptionId)

    private data class Revalidation(
        val providerServiceable: Boolean,
        val items: List<RecurringRevalidationItem>,
        val canReorder: Boolean,
        val failureReason: String?,
    )

    private fun revalidate(subscription: RecurringOrderSubscription, proposal: RenewalProposal): Revalidation {
        if (subscription.status != RecurringOrderStatus.ACTIVE) return Revalidation(false, emptyList(), false, "SUBSCRIPTION_NOT_ACTIVE")
        val source = orderQuery.detail(subscription.customerId, proposal.sourceOrderId)
        if (source == null || source.status != OrderStatus.DELIVERED || source.outletId != proposal.providerId) {
            return Revalidation(false, emptyList(), false, "SOURCE_ORDER_UNAVAILABLE")
        }
        val outlet = runCatching { providers.getOutlet(proposal.providerId) }.getOrNull()
        val providerServiceable = outlet != null && providerServiceable(subscription.customerId, proposal, outlet)
        val items = source.items.map { sourceItem ->
            val listing = runCatching { catalog.getListing(sourceItem.listingId) }.getOrNull()
            val quantity = try { Math.multiplyExact(sourceItem.quantity, proposal.quantityMultiplier) } catch (_: ArithmeticException) { 0 }
            val eligible = listing != null && listing.outletId == proposal.providerId && listing.kind == ListingKind.PRODUCT &&
                listing.commerceMode == CommerceMode.COMMERCE && quantity > 0
            val stockAvailable = eligible && inventory.available(sourceItem.listingId) >= quantity
            val available = providerServiceable && stockAvailable
            val reason = when {
                listing == null -> "LISTING_UNAVAILABLE"
                listing.outletId != proposal.providerId -> "LISTING_PROVIDER_CHANGED"
                listing.kind != ListingKind.PRODUCT || listing.commerceMode != CommerceMode.COMMERCE -> "LISTING_NOT_COMMERCE"
                quantity <= 0 -> "QUANTITY_OVERFLOW"
                !providerServiceable -> "PROVIDER_NOT_SERVICEABLE"
                !stockAvailable -> "INSUFFICIENT_STOCK"
                else -> null
            }
            RecurringRevalidationItem(
                listingId = sourceItem.listingId, name = listing?.name ?: sourceItem.listingName,
                quantity = quantity, unitPricePaise = listing?.sellingPricePaise ?: 0L,
                available = available, failureReason = reason,
            )
        }
        val canReorder = providerServiceable && items.isNotEmpty() && items.all { it.available }
        return Revalidation(
            providerServiceable, items, canReorder,
            items.firstOrNull { !it.available }?.failureReason ?: if (!providerServiceable) "PROVIDER_NOT_SERVICEABLE" else null,
        )
    }

    private fun expectedProposalLines(customerId: UUID, proposal: RenewalProposal): Map<UUID, Int> {
        val source = orderQuery.detail(customerId, proposal.sourceOrderId) ?: unavailable()
        if (source.status != OrderStatus.DELIVERED || source.outletId != proposal.providerId) invalidProposalState()
        return source.items.associate { line ->
            val quantity = try { Math.multiplyExact(line.quantity, proposal.quantityMultiplier) } catch (_: ArithmeticException) {
                throw DomainException("RECURRING_QUANTITY_INVALID", "Recurring quantity exceeds the supported range")
            }
            if (quantity <= 0) throw DomainException("RECURRING_QUANTITY_INVALID", "Recurring quantity must be positive")
            line.listingId to quantity
        }
    }

    private fun requireDeliveredSource(customerId: UUID, sourceOrderId: UUID): CustomerOrderDetailSnapshot {
        val source = orderQuery.detail(customerId, sourceOrderId) ?: unavailable()
        if (source.status != OrderStatus.DELIVERED) throw DomainException("RECURRING_SOURCE_INVALID", "Only delivered product orders can become recurring schedules")
        return source
    }

    private fun requireProvider(providerId: UUID): ProviderOutlet {
        val outlet = providers.getOutlet(providerId)
        if (outlet.status != ProviderStatus.ACTIVE || ProviderCapability.PRODUCT_STORE !in outlet.capabilities) {
            throw DomainException("PROVIDER_UNAVAILABLE", "The source provider is unavailable")
        }
        return outlet
    }

    private fun validateReusableSourceItems(source: CustomerOrderDetailSnapshot, outlet: ProviderOutlet) {
        if (source.items.isEmpty()) throw DomainException("RECURRING_SOURCE_INVALID", "The source order has no reusable items")
        source.items.forEach { item ->
            val listing = catalog.getListing(item.listingId)
            if (listing.outletId != outlet.id || listing.kind != ListingKind.PRODUCT || listing.commerceMode != CommerceMode.COMMERCE) {
                throw DomainException("RECURRING_ITEM_INVALID", "The source order contains an item that cannot recur")
            }
        }
    }

    private fun providerServiceable(customerId: UUID, proposal: RenewalProposal, outlet: ProviderOutlet): Boolean = when (proposal.fulfilmentMode) {
        STORE_PICKUP -> isServiceable(outlet, STORE_PICKUP, null)
        CAPTAIN_DELIVERY -> {
            val addressId = proposal.deliveryAddressId ?: return false
            val address = runCatching { customerData.getAddress(customerId, addressId) }.getOrNull() ?: return false
            isServiceable(outlet, CAPTAIN_DELIVERY, address.pincode)
        }
        else -> false
    }

    private fun isServiceable(outlet: ProviderOutlet, fulfilmentMode: String, pincode: String?): Boolean {
        if (outlet.status != ProviderStatus.ACTIVE || ProviderCapability.PRODUCT_STORE !in outlet.capabilities) return false
        return when (fulfilmentMode) {
            STORE_PICKUP -> outlet.pickupEnabled
            CAPTAIN_DELIVERY -> pincode != null && pincode in outlet.servicePinCodes && outlet.latitude != null && outlet.longitude != null
            else -> false
        }
    }

    private fun validateFulfilmentMode(mode: String): String = when (mode) {
        STORE_PICKUP, CAPTAIN_DELIVERY -> mode
        else -> throw DomainException("RECURRING_FULFILMENT_INVALID", "The source order fulfilment mode cannot recur")
    }

    private fun validateCadence(value: Int) {
        if (value !in ALLOWED_CADENCES) throw DomainException("RECURRING_CADENCE_INVALID", "Recurring cadence must be one of 7, 15, 25, 30 or 35 days")
    }

    private fun validateQuantity(value: Int) {
        if (value !in 1..MAX_QUANTITY_MULTIPLIER) throw DomainException("RECURRING_QUANTITY_INVALID", "Recurring quantity multiplier is outside the allowed range")
    }

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
    }

    private fun validateIdempotencyKey(value: String) {
        if (!value.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
    }

    private fun fingerprint(vararg parts: Any?): String {
        val canonical = parts.joinToString("\u001f") { it?.toString() ?: "<null>" }
        return MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun invalidState(): Nothing = throw DomainException("RECURRING_STATE_INVALID", "The recurring schedule cannot perform that action")
    private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
}

private fun anchoredNext(anchor: Instant, cadenceDays: Int): Instant = anchor.plus(Duration.ofDays(cadenceDays.toLong()))
private fun dueKey(subscription: RecurringOrderSubscription): String = "due:${subscription.id}:${subscription.nextOrderAt.epochSecond}"
private fun alreadyExists(): Nothing = throw DomainException("RECURRING_ALREADY_EXISTS", "A recurring schedule already exists for this source order")
private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
private fun invalidProposalState(): Nothing = throw DomainException("PROPOSAL_STATE_INVALID", "The renewal proposal cannot perform that action")
private fun idempotencyMismatch(): Nothing = throw DomainException(
    "IDEMPOTENCY_FINGERPRINT_MISMATCH",
    "The idempotency key was already used for another request",
)
