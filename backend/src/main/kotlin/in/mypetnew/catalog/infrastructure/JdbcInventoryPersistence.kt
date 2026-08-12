package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.InventoryPersistence
import `in`.mypetnew.catalog.domain.StockMovement
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.common.error.DomainException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID

class JdbcInventoryPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
) : InventoryPersistence {
    override fun adjust(
        listingId: UUID,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement = mutate(
        listingId = listingId,
        operationScope = "stock-adjust",
        idempotencyKey = idempotencyKey,
        fingerprint = fingerprint(listingId, delta, reason.name),
        reason = reason,
        quantityDelta = delta,
        sourceReference = idempotencyKey,
        actorId = actorId,
        traceId = traceId,
    ) { balance ->
        val newOnHand = Math.addExact(balance.onHand, delta)
        if (newOnHand < 0 || newOnHand < balance.reserved) insufficient()
        balance.copy(onHand = newOnHand)
    }

    override fun reserve(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return mutate(
            listingId = listingId,
            operationScope = "stock-reserve",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(listingId, quantity, StockReason.ORDER_RESERVE.name),
            reason = StockReason.ORDER_RESERVE,
            quantityDelta = 0,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.onHand - balance.reserved < quantity) insufficient()
            balance.copy(reserved = Math.addExact(balance.reserved, quantity))
        }
    }

    override fun release(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return mutate(
            listingId = listingId,
            operationScope = "stock-release",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(listingId, quantity, StockReason.ORDER_RELEASE.name),
            reason = StockReason.ORDER_RELEASE,
            quantityDelta = 0,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.reserved < quantity) {
                throw DomainException("STOCK_RESERVATION_MISSING", "The stock reservation is unavailable")
            }
            balance.copy(reserved = balance.reserved - quantity)
        }
    }

    override fun fulfil(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return mutate(
            listingId = listingId,
            operationScope = "stock-fulfil",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(listingId, quantity, StockReason.ORDER_FULFIL.name),
            reason = StockReason.ORDER_FULFIL,
            quantityDelta = -quantity,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.reserved < quantity || balance.onHand < quantity) insufficient()
            balance.copy(onHand = balance.onHand - quantity, reserved = balance.reserved - quantity)
        }
    }

    override fun sell(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        return mutate(
            listingId = listingId,
            operationScope = "stock-pos",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(listingId, quantity, StockReason.POS_SALE.name),
            reason = StockReason.POS_SALE,
            quantityDelta = -quantity,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.onHand - balance.reserved < quantity) insufficient()
            balance.copy(onHand = balance.onHand - quantity)
        }
    }

    override fun available(listingId: UUID): Int = jdbc.query(
        "SELECT on_hand, reserved FROM mypet.inventory_balance WHERE listing_id = ?",
        { result, _ -> result.getInt("on_hand") - result.getInt("reserved") },
        listingId,
    ).singleOrNull() ?: 0

    override fun reserved(listingId: UUID): Int = jdbc.query(
        "SELECT reserved FROM mypet.inventory_balance WHERE listing_id = ?",
        { result, _ -> result.getInt("reserved") },
        listingId,
    ).singleOrNull() ?: 0

    override fun history(listingId: UUID): List<StockMovement> = jdbc.query(
        """
        SELECT id, listing_id, reason, quantity_delta, resulting_on_hand, resulting_reserved,
               source_reference, occurred_at
        FROM mypet.inventory_movement
        WHERE listing_id = ?
        ORDER BY occurred_at, id
        """.trimIndent(),
        { result, _ -> movement(result) },
        listingId,
    )

    private fun mutate(
        listingId: UUID,
        operationScope: String,
        idempotencyKey: String,
        fingerprint: String,
        reason: StockReason,
        quantityDelta: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
        change: (Balance) -> Balance,
    ): StockMovement {
        validateCommand(idempotencyKey, traceId)
        val outletId = outletFor(listingId)
        var lastDuplicate: DuplicateKeyException? = null
        repeat(2) {
            try {
                return transactions.execute {
                    ensureBalance(listingId)
                    val existing = existingMovement(outletId, idempotencyKey)
                    if (existing != null) return@execute replay(existing, operationScope, fingerprint)

                    val before = lockBalance(listingId)
                    val after = change(before)
                    validateBalance(after)
                    val updated = jdbc.update(
                        """
                        UPDATE mypet.inventory_balance
                        SET on_hand = ?, reserved = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
                        WHERE listing_id = ? AND version = ?
                        """.trimIndent(),
                        after.onHand,
                        after.reserved,
                        listingId,
                        before.version,
                    )
                    if (updated != 1) {
                        throw DomainException("STOCK_CONFLICT", "Stock changed concurrently; retry with fresh state")
                    }

                    val movement = StockMovement(
                        id = UUID.randomUUID(),
                        listingId = listingId,
                        reason = reason,
                        quantityDelta = quantityDelta,
                        resultingOnHand = after.onHand,
                        resultingReserved = after.reserved,
                        sourceReference = sourceReference,
                    )
                    jdbc.update(
                        """
                        INSERT INTO mypet.inventory_movement (
                            id, listing_id, outlet_id, reason, quantity_delta, resulting_on_hand,
                            resulting_reserved, source_type, source_reference, actor_id, idempotency_key,
                            trace_id, operation_scope, request_fingerprint, occurred_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """.trimIndent(),
                        movement.id,
                        movement.listingId,
                        outletId,
                        movement.reason.name,
                        movement.quantityDelta,
                        movement.resultingOnHand,
                        movement.resultingReserved,
                        movement.reason.name,
                        movement.sourceReference,
                        actorId,
                        idempotencyKey,
                        traceId,
                        operationScope,
                        fingerprint,
                        movement.occurredAt,
                    )
                    movement
                } ?: throw IllegalStateException("Inventory transaction returned no result")
            } catch (duplicate: DuplicateKeyException) {
                lastDuplicate = duplicate
                existingMovement(outletId, idempotencyKey)?.let { return replay(it, operationScope, fingerprint) }
            }
        }
        throw lastDuplicate ?: DomainException("STOCK_CONFLICT", "Stock changed concurrently; retry")
    }

    private fun ensureBalance(listingId: UUID) {
        val present = jdbc.queryForObject(
            "SELECT COUNT(*) FROM mypet.inventory_balance WHERE listing_id = ?",
            Long::class.java,
            listingId,
        ) ?: 0L
        if (present == 0L) {
            jdbc.update(
                """
                INSERT INTO mypet.inventory_balance (listing_id, on_hand, reserved, version, updated_at)
                VALUES (?, 0, 0, 0, CURRENT_TIMESTAMP)
                """.trimIndent(),
                listingId,
            )
        }
    }

    private fun lockBalance(listingId: UUID): Balance = jdbc.query(
        "SELECT on_hand, reserved, version FROM mypet.inventory_balance WHERE listing_id = ? FOR UPDATE",
        { result, _ -> Balance(result.getInt("on_hand"), result.getInt("reserved"), result.getLong("version")) },
        listingId,
    ).singleOrNull() ?: throw DomainException("STOCK_NOT_FOUND", "Stock is unavailable")

    private fun outletFor(listingId: UUID): UUID = jdbc.query(
        "SELECT outlet_id FROM mypet.catalog_listing WHERE id = ?",
        { result, _ -> result.getObject("outlet_id", UUID::class.java) },
        listingId,
    ).singleOrNull() ?: throw DomainException("LISTING_UNAVAILABLE", "The listing is unavailable")

    private fun existingMovement(outletId: UUID, idempotencyKey: String): StoredMovement? = jdbc.query(
        """
        SELECT id, listing_id, reason, quantity_delta, resulting_on_hand, resulting_reserved,
               source_reference, occurred_at, operation_scope, request_fingerprint
        FROM mypet.inventory_movement
        WHERE outlet_id = ? AND idempotency_key = ?
        """.trimIndent(),
        { result, _ -> StoredMovement(movement(result), result.getString("operation_scope"), result.getString("request_fingerprint")) },
        outletId,
        idempotencyKey,
    ).singleOrNull()

    private fun replay(existing: StoredMovement, operationScope: String, fingerprint: String): StockMovement {
        if (existing.operationScope != operationScope || existing.requestFingerprint != fingerprint) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return existing.movement
    }

    private fun movement(result: ResultSet): StockMovement = StockMovement(
        id = result.getObject("id", UUID::class.java),
        listingId = result.getObject("listing_id", UUID::class.java),
        reason = StockReason.valueOf(result.getString("reason")),
        quantityDelta = result.getInt("quantity_delta"),
        resultingOnHand = result.getInt("resulting_on_hand"),
        resultingReserved = result.getInt("resulting_reserved"),
        sourceReference = result.getString("source_reference"),
        occurredAt = result.getObject("occurred_at", java.time.OffsetDateTime::class.java).toInstant(),
    )

    private fun validateCommand(idempotencyKey: String, traceId: String) {
        if (!idempotencyKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
        if (!traceId.matches(Regex("[A-Za-z0-9._:-]{1,64}"))) {
            throw DomainException("TRACE_ID_INVALID", "The trace identifier is invalid")
        }
    }

    private fun validateBalance(balance: Balance) {
        if (balance.onHand < 0 || balance.reserved < 0 || balance.reserved > balance.onHand) insufficient()
    }

    private fun requirePositive(quantity: Int) {
        if (quantity <= 0) throw DomainException("QUANTITY_INVALID", "Quantity must be positive")
    }

    private fun insufficient(): Nothing = throw DomainException("INSUFFICIENT_STOCK", "Stock is unavailable")

    private fun fingerprint(listingId: UUID, quantity: Int, discriminator: String): String {
        val canonical = "$listingId:$quantity:$discriminator"
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private data class Balance(val onHand: Int, val reserved: Int, val version: Long)
    private data class StoredMovement(
        val movement: StockMovement,
        val operationScope: String,
        val requestFingerprint: String,
    )
}
