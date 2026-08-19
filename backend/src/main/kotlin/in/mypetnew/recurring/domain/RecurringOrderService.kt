package `in`.mypetnew.recurring.domain

import `in`.mypetnew.catalog.domain.CatalogService
import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.commerce.domain.CustomerOrderQuery
import `in`.mypetnew.commerce.domain.OrderStatus
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.customer.domain.CustomerDataService
import `in`.mypetnew.provider.domain.ProviderCapability
import `in`.mypetnew.provider.domain.ProviderService
import `in`.mypetnew.provider.domain.ProviderStatus
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

enum class RecurringOrderStatus { ACTIVE, PAUSED, AWAITING_CONFIRMATION, CANCELLED }

data class RecurringOrderSubscription(
    val id: UUID,
    val customerId: UUID,
    val providerId: UUID,
    val sourceOrderId: UUID,
    val deliveryAddressId: UUID,
    val cadenceDays: Int,
    val quantityMultiplier: Int,
    val status: RecurringOrderStatus,
    val nextOrderAt: Instant,
    val lastRemindedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class RecurringOrderPage(val items: List<RecurringOrderSubscription>, val hasNext: Boolean)

data class RevalidatedRecurringItem(
    val offeringId: UUID,
    val offeringName: String,
    val unitPricePaise: Long,
    val quantity: Int,
    val available: Boolean,
    val message: String?,
)

data class RecurringOrderConfirmation(
    val subscription: RecurringOrderSubscription,
    val originalOrderId: UUID,
    val providerId: UUID,
    val providerServiceable: Boolean,
    val items: List<RevalidatedRecurringItem>,
    val canReorder: Boolean,
)

interface RecurringOrderPersistence {
    fun save(subscription: RecurringOrderSubscription): RecurringOrderSubscription
    fun get(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription?
    fun findBySource(customerId: UUID, sourceOrderId: UUID): RecurringOrderSubscription?
    fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage
}

class InMemoryRecurringOrderPersistence : RecurringOrderPersistence {
    private val values = mutableMapOf<UUID, RecurringOrderSubscription>()

    @Synchronized
    override fun save(subscription: RecurringOrderSubscription): RecurringOrderSubscription = subscription.also { values[it.id] = it }

    @Synchronized
    override fun get(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription? =
        values[subscriptionId]?.takeIf { it.customerId == customerId }

    @Synchronized
    override fun findBySource(customerId: UUID, sourceOrderId: UUID): RecurringOrderSubscription? =
        values.values.firstOrNull { it.customerId == customerId && it.sourceOrderId == sourceOrderId }

    @Synchronized
    override fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage {
        val ordered = values.values.filter { it.customerId == customerId }
            .sortedWith(compareByDescending<RecurringOrderSubscription> { it.createdAt }.thenByDescending { it.id.toString() })
        val offset = page.toLong() * pageSize.toLong()
        if (offset >= ordered.size.toLong()) return RecurringOrderPage(emptyList(), false)
        val candidates = ordered.drop(offset.toInt()).take(pageSize + 1)
        return RecurringOrderPage(candidates.take(pageSize), candidates.size > pageSize)
    }
}

class RecurringOrderService(
    private val persistence: RecurringOrderPersistence,
    private val orders: CustomerOrderQuery,
    private val catalog: CatalogService,
    private val providers: ProviderService,
    private val customerData: CustomerDataService,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun create(customerId: UUID, sourceOrderId: UUID, cadenceDays: Int, quantityMultiplier: Int): RecurringOrderSubscription {
        validateCadence(cadenceDays)
        validateQuantity(quantityMultiplier)
        val source = ownedSource(customerId, sourceOrderId)
        if (source.status != OrderStatus.DELIVERED) {
            throw DomainException("RECURRING_SOURCE_INELIGIBLE", "Only delivered orders can become recurring reminders")
        }
        if (persistence.findBySource(customerId, sourceOrderId) != null) {
            throw DomainException("RECURRING_ALREADY_EXISTS", "A recurring reminder already exists for this order")
        }
        requireProvider(source.outletId)
        val addresses = customerData.listAddresses(customerId)
        val address = addresses.firstOrNull { it.isDefault }
            ?: addresses.firstOrNull()
            ?: throw DomainException("RECURRING_ADDRESS_REQUIRED", "Add a delivery address before creating a recurring reminder")
        if (source.items.isEmpty()) {
            throw DomainException("RECURRING_SOURCE_INELIGIBLE", "The source order has no reusable items")
        }
        source.items.forEach { line ->
            val listing = runCatching { catalog.getListing(line.listingId) }.getOrNull()
            if (listing == null || listing.outletId != source.outletId || listing.commerceMode != CommerceMode.COMMERCE) {
                throw DomainException("RECURRING_SOURCE_INELIGIBLE", "The source order contains an item that is no longer eligible")
            }
        }
        val now = clock.instant()
        return persistence.save(
            RecurringOrderSubscription(
                id = UUID.randomUUID(),
                customerId = customerId,
                providerId = source.outletId,
                sourceOrderId = sourceOrderId,
                deliveryAddressId = address.id,
                cadenceDays = cadenceDays,
                quantityMultiplier = quantityMultiplier,
                status = RecurringOrderStatus.ACTIVE,
                nextOrderAt = now.plus(cadenceDays.toLong(), ChronoUnit.DAYS),
                lastRemindedAt = null,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }

    fun list(customerId: UUID, page: Int, pageSize: Int): RecurringOrderPage {
        validatePagination(page, pageSize)
        val now = clock.instant()
        val loaded = persistence.list(customerId, page, pageSize)
        return loaded.copy(items = loaded.items.map { promoteDue(it, now) })
    }

    fun update(
        customerId: UUID,
        subscriptionId: UUID,
        action: String,
        cadenceDays: Int?,
        quantityMultiplier: Int?,
        deliveryAddressId: UUID?,
    ): RecurringOrderSubscription {
        val current = owned(customerId, subscriptionId)
        val now = clock.instant()
        val normalized = action.trim().uppercase()
        val updated = when (normalized) {
            "PAUSE" -> {
                if (current.status == RecurringOrderStatus.CANCELLED) invalidState()
                current.copy(status = RecurringOrderStatus.PAUSED, updatedAt = now)
            }
            "RESUME" -> {
                if (current.status != RecurringOrderStatus.PAUSED) invalidState()
                current.copy(
                    status = RecurringOrderStatus.ACTIVE,
                    nextOrderAt = now.plus(current.cadenceDays.toLong(), ChronoUnit.DAYS),
                    lastRemindedAt = null,
                    updatedAt = now,
                )
            }
            "SKIP", "SKIP_NEXT" -> {
                if (current.status == RecurringOrderStatus.CANCELLED) invalidState()
                current.copy(
                    status = RecurringOrderStatus.ACTIVE,
                    nextOrderAt = current.nextOrderAt.plus(current.cadenceDays.toLong(), ChronoUnit.DAYS),
                    lastRemindedAt = null,
                    updatedAt = now,
                )
            }
            "CANCEL" -> current.copy(status = RecurringOrderStatus.CANCELLED, updatedAt = now)
            "CHANGE" -> {
                if (current.status == RecurringOrderStatus.CANCELLED) invalidState()
                val nextCadence = cadenceDays ?: current.cadenceDays
                val nextQuantity = quantityMultiplier ?: current.quantityMultiplier
                validateCadence(nextCadence)
                validateQuantity(nextQuantity)
                val nextAddress = deliveryAddressId?.also { customerData.getAddress(customerId, it) } ?: current.deliveryAddressId
                current.copy(
                    cadenceDays = nextCadence,
                    quantityMultiplier = nextQuantity,
                    deliveryAddressId = nextAddress,
                    nextOrderAt = now.plus(nextCadence.toLong(), ChronoUnit.DAYS),
                    lastRemindedAt = null,
                    updatedAt = now,
                )
            }
            else -> throw DomainException("RECURRING_ACTION_INVALID", "The requested recurring-order action is not supported")
        }
        return persistence.save(updated)
    }

    fun confirm(customerId: UUID, subscriptionId: UUID): RecurringOrderConfirmation {
        val current = promoteDue(owned(customerId, subscriptionId), clock.instant())
        if (current.status != RecurringOrderStatus.AWAITING_CONFIRMATION) invalidState()
        customerData.getAddress(customerId, current.deliveryAddressId)
        val source = ownedSource(customerId, current.sourceOrderId)
        if (source.outletId != current.providerId) unavailable()
        val providerServiceable = runCatching { requireProvider(current.providerId) }.isSuccess
        val items = source.items.map { line ->
            val listing = runCatching { catalog.getListing(line.listingId) }.getOrNull()
            val available = providerServiceable && listing != null &&
                listing.outletId == current.providerId && listing.commerceMode == CommerceMode.COMMERCE
            RevalidatedRecurringItem(
                offeringId = line.listingId,
                offeringName = listing?.name ?: line.listingName,
                unitPricePaise = listing?.sellingPricePaise ?: line.unitPricePaise,
                quantity = Math.multiplyExact(line.quantity, current.quantityMultiplier),
                available = available,
                message = if (available) null else "This item is no longer available from the original provider",
            )
        }
        val canReorder = providerServiceable && items.isNotEmpty() && items.all { it.available }
        if (canReorder) {
            val now = clock.instant()
            persistence.save(
                current.copy(
                    status = RecurringOrderStatus.ACTIVE,
                    nextOrderAt = now.plus(current.cadenceDays.toLong(), ChronoUnit.DAYS),
                    lastRemindedAt = null,
                    updatedAt = now,
                ),
            )
        }
        return RecurringOrderConfirmation(
            subscription = persistence.get(customerId, subscriptionId) ?: current,
            originalOrderId = source.orderId,
            providerId = current.providerId,
            providerServiceable = providerServiceable,
            items = items,
            canReorder = canReorder,
        )
    }

    private fun promoteDue(subscription: RecurringOrderSubscription, now: Instant): RecurringOrderSubscription {
        if (subscription.status != RecurringOrderStatus.ACTIVE || subscription.nextOrderAt.isAfter(now)) return subscription
        return persistence.save(
            subscription.copy(
                status = RecurringOrderStatus.AWAITING_CONFIRMATION,
                lastRemindedAt = now,
                updatedAt = now,
            ),
        )
    }

    private fun owned(customerId: UUID, subscriptionId: UUID): RecurringOrderSubscription =
        persistence.get(customerId, subscriptionId) ?: unavailable()

    private fun ownedSource(customerId: UUID, sourceOrderId: UUID) =
        orders.detail(customerId, sourceOrderId) ?: unavailable()

    private fun requireProvider(providerId: UUID) {
        val outlet = providers.getOutlet(providerId)
        if (outlet.status != ProviderStatus.ACTIVE || ProviderCapability.PRODUCT_STORE !in outlet.capabilities) unavailable()
    }

    private fun validateCadence(value: Int) {
        if (value !in ALLOWED_CADENCES) {
            throw DomainException("RECURRING_CADENCE_INVALID", "Cadence must be one of 7, 15, 25, 30 or 35 days")
        }
    }

    private fun validateQuantity(value: Int) {
        if (value !in 1..20) throw DomainException("RECURRING_QUANTITY_INVALID", "Quantity multiplier must be between 1 and 20")
    }

    private fun validatePagination(page: Int, pageSize: Int) {
        if (page < 0 || pageSize !in 1..100) {
            throw DomainException("PAGE_SIZE_INVALID", "Pagination values are outside the allowed range")
        }
    }

    private fun invalidState(): Nothing = throw DomainException("RECURRING_STATE_INVALID", "The recurring reminder is not in a valid state for this action")
    private fun unavailable(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    companion object {
        val ALLOWED_CADENCES = setOf(7, 15, 25, 30, 35)
    }
}
