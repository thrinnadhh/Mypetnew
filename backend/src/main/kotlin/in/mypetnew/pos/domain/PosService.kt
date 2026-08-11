package `in`.mypetnew.pos.domain

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.idempotency.IdempotencyStore
import `in`.mypetnew.loyalty.domain.LoyaltyService
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
)

class PosService(
    private val inventory: InventoryService,
    private val loyalty: LoyaltyService,
) {
    private val sales = mutableMapOf<UUID, PosSale>()
    private val completionKeys = IdempotencyStore<PosSale>()

    @Synchronized
    fun complete(
        merchantId: UUID,
        outletId: UUID,
        customerId: UUID?,
        lines: Map<UUID, Pair<Int, Long>>,
        payment: PaymentDeclaration,
        idempotencyKey: String,
    ): PosSale {
        val fingerprint = listOf(merchantId, outletId, customerId, canonicalLines(lines), payment).joinToString(":")
        return completionKeys.execute("pos:$outletId", idempotencyKey, fingerprint) {
            if (lines.isEmpty()) throw DomainException("POS_CART_EMPTY", "The POS cart is empty")
            var totalPaise = 0L
            lines.forEach { (_, line) ->
                val (quantity, unitPricePaise) = line
                if (quantity <= 0 || unitPricePaise < 0) {
                    throw DomainException("POS_LINE_INVALID", "A POS line is invalid")
                }
                totalPaise = Math.addExact(totalPaise, Math.multiplyExact(quantity.toLong(), unitPricePaise))
            }
            val saleId = UUID.randomUUID()
            val sold = mutableListOf<Pair<UUID, Int>>()
            try {
                lines.toSortedMap(compareBy(UUID::toString)).forEach { (listingId, line) ->
                    inventory.sell(listingId, line.first, "$saleId:$listingId")
                    sold += listingId to line.first
                }
            } catch (error: RuntimeException) {
                sold.forEach { (listingId, quantity) ->
                    inventory.adjust(listingId, quantity, `in`.mypetnew.catalog.domain.StockReason.COUNT_CORRECTION, "rollback:$saleId:$listingId")
                }
                throw error
            }
            val award = customerId?.let {
                loyalty.award(it, merchantId, "POS_SALE:$saleId", totalPaise)
            }
            PosSale(
                id = saleId,
                merchantId = merchantId,
                outletId = outletId,
                customerId = customerId,
                lines = lines.toMap(),
                totalPaise = totalPaise,
                paymentDeclaration = payment,
                completedAt = Instant.now(),
                loyaltyAwarded = award?.awarded == true,
            ).also { sales[saleId] = it }
        }
    }

    private fun canonicalLines(lines: Map<UUID, Pair<Int, Long>>): String = lines
        .toSortedMap(compareBy(UUID::toString))
        .entries
        .joinToString(",") { "${it.key}=${it.value.first}@${it.value.second}" }
}

