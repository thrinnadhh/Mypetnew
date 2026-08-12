package `in`.mypetnew.commerce.domain

import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

data class PricingSnapshot(
    val itemSubtotalPaise: Long,
    val itemDiscountPaise: Long = 0,
    val couponDiscountPaise: Long = 0,
    val loyaltyRewardPaise: Long = 0,
    val taxPaise: Long = 0,
    val platformFeePaise: Long = 1_000,
    val deliveryFeePaise: Long = 0,
    val merchantCommissionPaise: Long = 1_000,
    val grandTotalPaise: Long,
    val currency: String = "INR",
    val ruleVersion: String = "s1-v1",
)

data class Quote(
    val id: UUID,
    val customerId: UUID,
    val outletId: UUID,
    val lines: Map<UUID, Pair<Int, Long>>,
    val cartSignature: String,
    val fulfilmentMode: String = "STORE_PICKUP",
    val paymentMethod: String = "PAY_ON_FULFILMENT",
    val pricing: PricingSnapshot,
    val expiresAt: Instant,
)

interface QuotePersistence {
    fun save(quote: Quote): Quote
    fun get(id: UUID): Quote?
}

class QuoteService(
    private val clock: Clock = Clock.systemUTC(),
    private val lifetime: Duration = Duration.ofMinutes(5),
    private val persistence: QuotePersistence = InMemoryQuotePersistence(),
) {
    fun createPickupQuote(
        customerId: UUID,
        outletId: UUID,
        lines: Map<UUID, Pair<Int, Long>>,
    ): Quote {
        if (lines.isEmpty()) throw DomainException("CART_EMPTY", "The cart is empty")
        var subtotal = 0L
        lines.forEach { (_, line) ->
            val (quantity, unitPricePaise) = line
            if (quantity <= 0 || unitPricePaise < 0) {
                throw DomainException("QUOTE_LINE_INVALID", "A quote line is invalid")
            }
            subtotal = Math.addExact(subtotal, Math.multiplyExact(quantity.toLong(), unitPricePaise))
        }
        val signature = signature(customerId, outletId, lines)
        val quote = Quote(
            id = UUID.randomUUID(),
            customerId = customerId,
            outletId = outletId,
            lines = lines.toSortedMap(compareBy(UUID::toString)),
            cartSignature = signature,
            pricing = PricingSnapshot(
                itemSubtotalPaise = subtotal,
                grandTotalPaise = Math.addExact(subtotal, 1_000),
            ),
            expiresAt = clock.instant().plus(lifetime),
        )
        return persistence.save(quote)
    }

    fun requireValid(id: UUID, cartSignature: String, at: Instant = clock.instant()): Quote {
        val quote = persistence.get(id) ?: throw DomainException("QUOTE_NOT_FOUND", "The quote is unavailable")
        if (quote.cartSignature != cartSignature) {
            throw DomainException("QUOTE_STALE", "The cart changed after this quote was created")
        }
        if (!at.isBefore(quote.expiresAt)) {
            throw DomainException("QUOTE_EXPIRED", "The quote expired")
        }
        return quote
    }

    fun get(id: UUID): Quote = persistence.get(id)
        ?: throw DomainException("QUOTE_NOT_FOUND", "The quote is unavailable")

    private fun signature(customerId: UUID, outletId: UUID, lines: Map<UUID, Pair<Int, Long>>): String {
        val canonical = buildString {
            append(customerId).append(':').append(outletId)
            lines.toSortedMap(compareBy(UUID::toString)).forEach { (listingId, line) ->
                append(':').append(listingId).append(':').append(line.first).append(':').append(line.second)
            }
        }
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}

private class InMemoryQuotePersistence : QuotePersistence {
    private val quotes = mutableMapOf<UUID, Quote>()

    @Synchronized
    override fun save(quote: Quote): Quote = quote.also { quotes[it.id] = it }

    @Synchronized
    override fun get(id: UUID): Quote? = quotes[id]
}
