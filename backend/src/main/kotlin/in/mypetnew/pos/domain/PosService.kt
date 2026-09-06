package `in`.mypetnew.pos.domain

import `in`.mypetnew.catalog.domain.CommerceMode
import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.commerce.domain.CommerceListingAuthority
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.loyalty.domain.LoyaltyService
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class PaymentDeclaration {
    CASH,
    EXTERNAL_UPI,
    CARD_TERMINAL,
}

data class PosSale(
    val id: UUID,
    val merchantId: UUID,
    val outletId: UUID,
    val customerId: UUID?,
    val lines: Map<UUID, Pair<Int, Long>>,
    val totalPaise: Long,
    val paymentDeclaration: PaymentDeclaration,
    val completedAt: Instant,
    val loyaltyAwarded: Boolean,
    val cashierId: UUID = InventoryService.SYSTEM_ACTOR_ID,
    val traceId: String = InventoryService.SYSTEM_TRACE_ID,
)

data class PersistedPosSale(
    val requestFingerprint: String,
    val sale: PosSale,
)

interface PosPersistence {
    val rollsBackOnFailure: Boolean
    fun <T> inTransaction(block: () -> T): T
    fun find(outletId: UUID, idempotencyKey: String): PersistedPosSale?
    fun insert(
        sale: PosSale,
        listingNames: Map<UUID, String>,
        idempotencyKey: String,
        requestFingerprint: String,
    )
    fun updateLoyaltyResult(saleId: UUID, awarded: Boolean)
    fun delete(saleId: UUID)
    fun get(saleId: UUID): PosSale
}

class PosIdempotencyRace : RuntimeException()

class PosService(
    private val inventory: InventoryService,
    private val loyalty: LoyaltyService,
    private val persistence: PosPersistence = InMemoryPosPersistence(),
    private val clock: Clock = Clock.systemUTC(),
    private val listingAuthority: CommerceListingAuthority? = null,
    private val customerAssociations: CustomerAssociationChallengeService? = null,
) {
    fun complete(
        merchantId: UUID,
        outletId: UUID,
        customerId: UUID?,
        lines: Map<UUID, Pair<Int, Long>>,
        payment: PaymentDeclaration,
        idempotencyKey: String,
        listingNames: Map<UUID, String> = lines.keys.associateWith { it.toString() },
        cashierId: UUID = InventoryService.SYSTEM_ACTOR_ID,
        traceId: String = InventoryService.SYSTEM_TRACE_ID,
        associationChallengeId: UUID? = null,
    ): PosSale {
        validateKey(idempotencyKey, traceId)
        if (customerId != null && associationChallengeId != null) {
            throw DomainException("POS_CUSTOMER_ASSOCIATION_INVALID", "POS customer association is ambiguous")
        }
        if (lines.isEmpty()) throw DomainException("POS_CART_EMPTY", "The POS cart is empty")
        lines.forEach { (_, line) ->
            val (quantity, unitPricePaise) = line
            if (quantity <= 0 || unitPricePaise < 0) {
                throw DomainException("POS_LINE_INVALID", "A POS line is invalid")
            }
        }
        if (listingNames.keys != lines.keys || listingNames.values.any { it.isBlank() || it.length > 160 }) {
            throw DomainException("POS_LINE_INVALID", "A POS line snapshot is invalid")
        }
        val fingerprint = fingerprint(
            merchantId,
            outletId,
            customerId,
            associationChallengeId,
            lines,
            payment,
            cashierId,
        )
        replay(outletId, idempotencyKey, fingerprint) { sale ->
            legacyReplayMatches(sale, merchantId, outletId, customerId, associationChallengeId, lines, payment, cashierId)
        }?.let { return it }

        try {
            return persistence.inTransaction {
                replay(outletId, idempotencyKey, fingerprint) { sale ->
                    legacyReplayMatches(sale, merchantId, outletId, customerId, associationChallengeId, lines, payment, cashierId)
                }?.let { return@inTransaction it }
                val canonical = canonicalPosLines(merchantId, outletId, lines, listingNames)
                val resolvedCustomerId = associationChallengeId?.let { challengeId ->
                    val associations = customerAssociations ?: throw DomainException(
                        "POS_CUSTOMER_ASSOCIATION_UNAVAILABLE",
                        "Customer association is unavailable for POS completion",
                    )
                    associations.consume(challengeId, merchantId, outletId)
                } ?: customerId
                val totalPaise = canonical.lines.values.fold(0L) { total, line ->
                    Math.addExact(total, Math.multiplyExact(line.first.toLong(), line.second))
                }
                val sale = PosSale(
                    id = UUID.randomUUID(),
                    merchantId = merchantId,
                    outletId = outletId,
                    customerId = resolvedCustomerId,
                    lines = canonical.lines,
                    totalPaise = totalPaise,
                    paymentDeclaration = payment,
                    completedAt = clock.instant(),
                    loyaltyAwarded = false,
                    cashierId = cashierId,
                    traceId = traceId,
                )
                persistence.insert(sale, canonical.listingNames, idempotencyKey, fingerprint)
                val sold = mutableListOf<Pair<UUID, Int>>()
                try {
                    sale.lines.forEach { (listingId, line) ->
                        inventory.sell(
                            listingId,
                            line.first,
                            "pos:${sale.id}:sell:$listingId",
                            cashierId,
                            traceId,
                        )
                        sold += listingId to line.first
                    }
                    val award = resolvedCustomerId?.let {
                        loyalty.award(it, merchantId, "POS_SALE:${sale.id}", totalPaise)
                    }
                    val awarded = award?.awarded == true
                    persistence.updateLoyaltyResult(sale.id, awarded)
                    persistence.get(sale.id)
                } catch (error: RuntimeException) {
                    if (!persistence.rollsBackOnFailure) {
                        sold.asReversed().forEach { (listingId, quantity) ->
                            runCatching {
                                inventory.adjust(
                                    listingId,
                                    quantity,
                                    StockReason.COUNT_CORRECTION,
                                    "pos:${sale.id}:rollback:$listingId",
                                    cashierId,
                                    traceId,
                                )
                            }.onFailure(error::addSuppressed)
                        }
                        persistence.delete(sale.id)
                    }
                    throw error
                }
            }
        } catch (race: PosIdempotencyRace) {
            return replay(outletId, idempotencyKey, fingerprint) { sale ->
                legacyReplayMatches(sale, merchantId, outletId, customerId, associationChallengeId, lines, payment, cashierId)
            } ?: throw DomainException("POS_CONFLICT", "POS completion raced with another request; retry")
        }
    }

    fun get(saleId: UUID): PosSale = persistence.get(saleId)

    fun find(outletId: UUID, idempotencyKey: String): PersistedPosSale? = persistence.find(outletId, idempotencyKey)

    private fun canonicalPosLines(
        merchantId: UUID,
        outletId: UUID,
        requested: Map<UUID, Pair<Int, Long>>,
        fallbackListingNames: Map<UUID, String>,
    ): CanonicalPosLines {
        val ordered = requested.toSortedMap(compareBy(UUID::toString))
        val authority = listingAuthority
        if (authority == null) {
            return CanonicalPosLines(ordered, fallbackListingNames)
        }

        val locked = authority.lockForCommerce(ordered.keys)
        if (locked.size != ordered.size) unavailable()
        val canonicalLines = linkedMapOf<UUID, Pair<Int, Long>>()
        val canonicalNames = linkedMapOf<UUID, String>()
        ordered.forEach { (listingId, requestedLine) ->
            val current = locked[listingId] ?: unavailable()
            if (
                current.organizationId != merchantId ||
                current.outletId != outletId ||
                !current.active ||
                current.commerceMode != CommerceMode.COMMERCE
            ) {
                unavailable()
            }
            canonicalLines[listingId] = requestedLine.first to current.sellingPricePaise
            canonicalNames[listingId] = current.name
        }
        return CanonicalPosLines(canonicalLines, canonicalNames)
    }

    private fun unavailable(): Nothing = throw DomainException(
        "LISTING_UNAVAILABLE",
        "A POS item is unavailable",
    )

    private fun replay(
        outletId: UUID,
        idempotencyKey: String,
        fingerprint: String,
        legacyCompatible: (PosSale) -> Boolean,
    ): PosSale? {
        val existing = persistence.find(outletId, idempotencyKey) ?: return null
        if (existing.requestFingerprint != fingerprint && !legacyCompatible(existing.sale)) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return existing.sale
    }

    private fun legacyReplayMatches(
        sale: PosSale,
        merchantId: UUID,
        outletId: UUID,
        customerId: UUID?,
        associationChallengeId: UUID?,
        lines: Map<UUID, Pair<Int, Long>>,
        payment: PaymentDeclaration,
        cashierId: UUID,
    ): Boolean {
        val expectedCustomerId = if (associationChallengeId != null) {
            customerAssociations?.resolveCustomerForReplay(associationChallengeId, merchantId, outletId)
                ?: return false
        } else {
            customerId
        }
        return sale.merchantId == merchantId &&
            sale.outletId == outletId &&
            sale.customerId == expectedCustomerId &&
            sale.paymentDeclaration == payment &&
            sale.cashierId == cashierId &&
            sale.lines.mapValues { it.value.first } == lines.mapValues { it.value.first }
    }

    private fun fingerprint(
        merchantId: UUID,
        outletId: UUID,
        customerId: UUID?,
        associationChallengeId: UUID?,
        lines: Map<UUID, Pair<Int, Long>>,
        payment: PaymentDeclaration,
        cashierId: UUID,
    ): String {
        // Unit prices are server state, not caller intent. Excluding them keeps retry identity stable
        // across a server-side reprice while persisted replays still return the original receipt.
        val canonical = listOf(
            merchantId,
            outletId,
            customerId,
            associationChallengeId,
            canonicalQuantities(lines),
            payment,
            cashierId,
        ).joinToString(":")
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun canonicalQuantities(lines: Map<UUID, Pair<Int, Long>>): String = lines
        .toSortedMap(compareBy(UUID::toString))
        .entries
        .joinToString(",") { "${it.key}=${it.value.first}" }

    fun validateKey(idempotencyKey: String) {
        if (!idempotencyKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    fun replaySale(
        merchantId: UUID,
        outletId: UUID,
        customerId: UUID?,
        associationChallengeId: UUID?,
        lineQuantities: Map<UUID, Int>,
        payment: PaymentDeclaration,
        cashierId: UUID,
        idempotencyKey: String,
    ): PosSale? {
        validateKey(idempotencyKey)
        val existing = persistence.find(outletId, idempotencyKey) ?: return null
        val linesForFp = lineQuantities.mapValues { it.value to 0L }
        val fp = fingerprint(
            merchantId = merchantId,
            outletId = outletId,
            customerId = customerId,
            associationChallengeId = associationChallengeId,
            lines = linesForFp,
            payment = payment,
            cashierId = cashierId,
        )
        if (existing.requestFingerprint != fp && !legacyReplayMatches(existing.sale, merchantId, outletId, customerId, associationChallengeId, linesForFp, payment, cashierId)) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return existing.sale
    }

    private fun validateKey(idempotencyKey: String, traceId: String) {
        validateKey(idempotencyKey)
        if (!traceId.matches(Regex("[A-Za-z0-9._:-]{1,64}"))) {
            throw DomainException("TRACE_ID_INVALID", "The trace identifier is invalid")
        }
    }
}

private data class CanonicalPosLines(
    val lines: Map<UUID, Pair<Int, Long>>,
    val listingNames: Map<UUID, String>,
)

private class InMemoryPosPersistence : PosPersistence {
    override val rollsBackOnFailure: Boolean = false

    private data class Binding(val fingerprint: String, val saleId: UUID)

    private val monitor = Any()
    private val sales = mutableMapOf<UUID, PosSale>()
    private val bindings = mutableMapOf<Pair<UUID, String>, Binding>()

    override fun <T> inTransaction(block: () -> T): T = synchronized(monitor) { block() }

    override fun find(outletId: UUID, idempotencyKey: String): PersistedPosSale? = synchronized(monitor) {
        val binding = bindings[outletId to idempotencyKey] ?: return@synchronized null
        val sale = sales[binding.saleId] ?: return@synchronized null
        PersistedPosSale(binding.fingerprint, sale)
    }

    override fun insert(
        sale: PosSale,
        listingNames: Map<UUID, String>,
        idempotencyKey: String,
        requestFingerprint: String,
    ) = synchronized(monitor) {
        val key = sale.outletId to idempotencyKey
        if (bindings.containsKey(key)) throw PosIdempotencyRace()
        sales[sale.id] = sale
        bindings[key] = Binding(requestFingerprint, sale.id)
    }

    override fun updateLoyaltyResult(saleId: UUID, awarded: Boolean) = synchronized(monitor) {
        val sale = sales[saleId] ?: notFound()
        sales[saleId] = sale.copy(loyaltyAwarded = awarded)
    }

    override fun delete(saleId: UUID) = synchronized(monitor) {
        val sale = sales.remove(saleId) ?: return@synchronized
        bindings.entries.removeIf { it.value.saleId == sale.id }
    }

    override fun get(saleId: UUID): PosSale = synchronized(monitor) {
        sales[saleId] ?: notFound()
    }

    private fun notFound(): Nothing = throw DomainException("POS_SALE_NOT_FOUND", "The POS sale is unavailable")
}
