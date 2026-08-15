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

data class DeliveryAddressSnapshot(
    val addressId: UUID,
    val recipientName: String,
    val phoneNumber: String,
    val line1: String,
    val line2: String?,
    val city: String,
    val state: String,
    val pincode: String,
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
    val deliveryAddress: DeliveryAddressSnapshot? = null,
    val etaMinutes: Int? = null,
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
    ): Quote = createQuote(
        customerId = customerId,
        outletId = outletId,
        lines = lines,
        fulfilmentMode = "STORE_PICKUP",
        deliveryFeePaise = 0,
        deliveryAddress = null,
        etaMinutes = null,
        ruleVersion = "s1-v1",
    )

    fun createDeliveryQuote(
        customerId: UUID,
        outletId: UUID,
        lines: Map<UUID, Pair<Int, Long>>,
        deliveryAddress: DeliveryAddressSnapshot,
        deliveryFeePaise: Long,
        etaMinutes: Int,
    ): Quote {
        if (deliveryFeePaise < 0) {
            throw DomainException("DELIVERY_FEE_INVALID", "The server delivery fee is invalid")
        }
        if (etaMinutes !in 1..240) {
            throw DomainException("DELIVERY_ETA_INVALID", "The server delivery ETA is invalid")
        }
        return createQuote(
            customerId = customerId,
            outletId = outletId,
            lines = lines,
            fulfilmentMode = "MYPET_CAPTAIN_DELIVERY",
            deliveryFeePaise = deliveryFeePaise,
            deliveryAddress = deliveryAddress,
            etaMinutes = etaMinutes,
            ruleVersion = "p4-v1",
        )
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

    private fun createQuote(
        customerId: UUID,
        outletId: UUID,
        lines: Map<UUID, Pair<Int, Long>>,
        fulfilmentMode: String,
        deliveryFeePaise: Long,
        deliveryAddress: DeliveryAddressSnapshot?,
        etaMinutes: Int?,
        ruleVersion: String,
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
        val signature = signature(customerId, outletId, lines, fulfilmentMode, deliveryAddress)
        val grandTotal = Math.addExact(Math.addExact(subtotal, 1_000), deliveryFeePaise)
        val quote = Quote(
            id = UUID.randomUUID(),
            customerId = customerId,
            outletId = outletId,
            lines = lines.toSortedMap(compareBy(UUID::toString)),
            cartSignature = signature,
            fulfilmentMode = fulfilmentMode,
            pricing = PricingSnapshot(
                itemSubtotalPaise = subtotal,
                deliveryFeePaise = deliveryFeePaise,
                grandTotalPaise = grandTotal,
                ruleVersion = ruleVersion,
            ),
            expiresAt = clock.instant().plus(lifetime),
            deliveryAddress = deliveryAddress,
            etaMinutes = etaMinutes,
        )
        return persistence.save(quote)
    }

    private fun signature(
        customerId: UUID,
        outletId: UUID,
        lines: Map<UUID, Pair<Int, Long>>,
        fulfilmentMode: String,
        deliveryAddress: DeliveryAddressSnapshot?,
    ): String {
        val canonical = buildString {
            append(customerId).append(':').append(outletId).append(':').append(fulfilmentMode)
            deliveryAddress?.let { address ->
                append(':').append(address.addressId)
                append(':').append(address.pincode)
                append(':').append(address.phoneNumber)
            }
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
