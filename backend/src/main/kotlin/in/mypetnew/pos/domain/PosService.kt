package `in`.mypetnew.pos.domain

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
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
    ): PosSale {
        validateKey(idempotencyKey, traceId)
        if (lines.isEmpty()) throw DomainException("POS_CART_EMPTY", "The POS cart is empty")
        var totalPaise = 0L
        lines.forEach { (_, line) ->
            val (quantity, unitPricePaise) = line
            if (quantity <= 0 || unitPricePaise < 0) {
                throw DomainException("POS_LINE_INVALID", "A POS line is invalid")
            }
            totalPaise = Math.addExact(totalPaise, Math.multiplyExact(quantity.toLong(), unitPricePaise))
        }
        if (listingNames.keys != lines.keys || listingNames.values.any { it.isBlank() || it.length > 160 }) {
            throw DomainException("POS_LINE_INVALID", "A POS line snapshot is invalid")
        }
        val fingerprint = fingerprint(merchantId, outletId, customerId, lines, payment)
        replay(outletId, idempotencyKey, fingerprint)?.let { return it }

        try {
            return persistence.inTransaction {
                replay(outletId, idempotencyKey, fingerprint)?.let { return@inTransaction it }
                val sale = PosSale(
                    id = UUID.randomUUID(),
                    merchantId = merchantId,
                    outletId = outletId,
                    customerId = customerId,
                    lines = lines.toSortedMap(compareBy(UUID::toString)),
                    totalPaise = totalPaise,
                    paymentDeclaration = payment,
                    completedAt = clock.instant(),
                    loyaltyAwarded = false,
                    cashierId = cashierId,
                    traceId = traceId,
                )
                persistence.insert(sale, listingNames, idempotencyKey, fingerprint)
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
                    val award = customerId?.let {
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
            return replay(outletId, idempotencyKey, fingerprint)
                ?: throw DomainException("POS_CONFLICT", "POS completion raced with another request; retry")
        }
    }

    private fun replay(outletId: UUID, idempotencyKey: String, fingerprint: String): PosSale? {
        val existing = persistence.find(outletId, idempotencyKey) ?: return null
        if (existing.requestFingerprint != fingerprint) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return existing.sale
    }

    private fun fingerprint(
        merchantId: UUID,
        outletId: UUID,
        customerId: UUID?,
        lines: Map<UUID, Pair<Int, Long>>,
        payment: PaymentDeclaration,
    ): String {
        val canonical = listOf(merchantId, outletId, customerId, canonicalLines(lines), payment).joinToString(":")
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun canonicalLines(lines: Map<UUID, Pair<Int, Long>>): String = lines
        .toSortedMap(compareBy(UUID::toString))
        .entries
        .joinToString(",") { "${it.key}=${it.value.first}@${it.value.second}" }

    private fun validateKey(idempotencyKey: String, traceId: String) {
        if (!idempotencyKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
        if (!traceId.matches(Regex("[A-Za-z0-9._:-]{1,64}"))) {
            throw DomainException("TRACE_ID_INVALID", "The trace identifier is invalid")
        }
    }
}

private class InMemoryPosPersistence : PosPersistence {
    override val rollsBackOnFailure: Boolean = false
    private val monitor = Any()
    private val sales = mutableMapOf<UUID, PosSale>()
    private val keys = IdempotencyStore<UUID>()
    private val bindings = mutableMapOf<Pair<UUID, String>, String>()

    override fun <T> inTransaction(block: () -> T): T = synchronized(monitor) { block() }

    override fun find(outletId: UUID, idempotencyKey: String): PersistedPosSale? = synchronized(monitor) {
        val fingerprint = bindings[outletId to idempotencyKey] ?: return@synchronized null
        val sale = sales.values.firstOrNull { it.outletId == outletId && keys.execute("lookup:$outletId", idempotencyKey, fingerprint) { it.id } == it.id }
            ?: return@synchronized null
        PersistedPosSale(fingerprint, sale)
    }

    override fun insert(
        sale: PosSale,
        listingNames: Map<UUID, String>,
        idempotencyKey: String,
        requestFingerprint: String,
    ) = synchronized(monitor) {
        val key = sale.outletId to idempotencyKey
        if (bindings.containsKey(key)) throw PosIdempotencyRace()
        bindings[key] = requestFingerprint
        keys.execute("lookup:${sale.outletId}", idempotencyKey, requestFingerprint) { sale.id }
        sales[sale.id] = sale
    }

    override fun updateLoyaltyResult(saleId: UUID, awarded: Boolean) = synchronized(monitor) {
        val sale = sales[saleId] ?: notFound()
        sales[saleId] = sale.copy(loyaltyAwarded = awarded)
    }

    override fun delete(saleId: UUID) = synchronized(monitor) {
        val sale = sales.remove(saleId) ?: return@synchronized
        bindings.entries.removeIf { entry ->
            entry.key.first == sale.outletId && runCatching {
                keys.execute("lookup:${sale.outletId}", entry.key.second, entry.value) { saleId }
            }.getOrNull() == saleId
        }
    }

    override fun get(saleId: UUID): PosSale = synchronized(monitor) {
        sales[saleId] ?: notFound()
    }

    private fun notFound(): Nothing = throw DomainException("POS_SALE_NOT_FOUND", "The POS sale is unavailable")
}
