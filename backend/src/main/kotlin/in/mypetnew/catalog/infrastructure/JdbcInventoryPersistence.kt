package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.InventoryBalance
import `in`.mypetnew.catalog.domain.InventoryHistoryPage
import `in`.mypetnew.catalog.domain.InventoryPersistence
import `in`.mypetnew.catalog.domain.InventoryScope
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
import java.time.OffsetDateTime
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
    ): StockMovement {
        if (delta == 0) invalidQuantity()
        val scope = scopeForListing(listingId)
        return mutate(
            scope = scope,
            operationScope = "stock-adjust",
            idempotencyKey = idempotencyKey,
            fingerprint = fingerprint(scope.organizationId, scope.outletId, listingId, delta, reason.name),
            reason = reason,
            quantityDelta = delta,
            sourceType = reason.name,
            sourceReference = idempotencyKey,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            val newOnHand = safeAdd(balance.onHand, delta)
            if (newOnHand < 0 || newOnHand < balance.reserved) insufficient()
            balance.copy(onHand = newOnHand)
        }
    }

    override fun adjustScoped(
        scope: InventoryScope,
        delta: Int,
        reason: StockReason,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String?,
        referenceId: String?,
    ): StockMovement {
        if (delta == 0) invalidQuantity()
        val sourceType = referenceType ?: "MERCHANT_ADJUSTMENT"
        val sourceReference = referenceId ?: idempotencyKey
        return mutate(
            scope = scope,
            operationScope = "merchant-adjust",
            idempotencyKey = idempotencyKey,
            fingerprint = fingerprint(
                scope.organizationId,
                scope.outletId,
                scope.listingId,
                delta,
                reason.name,
                referenceType,
                referenceId,
            ),
            reason = reason,
            quantityDelta = delta,
            sourceType = sourceType,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            val newOnHand = safeAdd(balance.onHand, delta)
            if (newOnHand < 0 || newOnHand < balance.reserved) insufficient()
            balance.copy(onHand = newOnHand)
        }
    }

    override fun reserve(
        listingId: UUID,
        quantity: Int,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
    ): StockMovement {
        requirePositive(quantity)
        val scope = scopeForListing(listingId)
        return mutate(
            scope = scope,
            operationScope = "stock-reserve",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(scope.organizationId, scope.outletId, listingId, quantity, StockReason.ORDER_RESERVE.name),
            reason = StockReason.ORDER_RESERVE,
            quantityDelta = 0,
            sourceType = StockReason.ORDER_RESERVE.name,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.onHand - balance.reserved < quantity) insufficient()
            balance.copy(reserved = safeAdd(balance.reserved, quantity))
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
        val scope = scopeForListing(listingId)
        return mutate(
            scope = scope,
            operationScope = "stock-release",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(scope.organizationId, scope.outletId, listingId, quantity, StockReason.ORDER_RELEASE.name),
            reason = StockReason.ORDER_RELEASE,
            quantityDelta = 0,
            sourceType = StockReason.ORDER_RELEASE.name,
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
        val scope = scopeForListing(listingId)
        return mutate(
            scope = scope,
            operationScope = "stock-fulfil",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(scope.organizationId, scope.outletId, listingId, quantity, StockReason.ORDER_FULFIL.name),
            reason = StockReason.ORDER_FULFIL,
            quantityDelta = -quantity,
            sourceType = StockReason.ORDER_FULFIL.name,
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
        val scope = scopeForListing(listingId)
        return mutate(
            scope = scope,
            operationScope = "stock-pos",
            idempotencyKey = sourceReference,
            fingerprint = fingerprint(scope.organizationId, scope.outletId, listingId, quantity, StockReason.POS_SALE.name),
            reason = StockReason.POS_SALE,
            quantityDelta = -quantity,
            sourceType = StockReason.POS_SALE.name,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.onHand - balance.reserved < quantity) insufficient()
            balance.copy(onHand = balance.onHand - quantity)
        }
    }

    // Server-internal customer/order lookups use globally unique listing IDs after the caller has
    // validated the listing. Merchant authorization boundaries use the tenant-scoped methods below.
    override fun available(listingId: UUID): Int = jdbc.query(
        """
        SELECT b.on_hand, b.reserved
        FROM mypet.inventory_balance b
        JOIN mypet.catalog_listing l
          ON l.id = b.listing_id
         AND l.organization_id = b.organization_id
         AND l.outlet_id = b.outlet_id
        WHERE b.listing_id = ?
        """.trimIndent(),
        { result, _ -> result.getInt("on_hand") - result.getInt("reserved") },
        listingId,
    ).singleOrNull() ?: 0

    override fun reserved(listingId: UUID): Int = jdbc.query(
        """
        SELECT b.reserved
        FROM mypet.inventory_balance b
        JOIN mypet.catalog_listing l
          ON l.id = b.listing_id
         AND l.organization_id = b.organization_id
         AND l.outlet_id = b.outlet_id
        WHERE b.listing_id = ?
        """.trimIndent(),
        { result, _ -> result.getInt("reserved") },
        listingId,
    ).singleOrNull() ?: 0

    override fun history(listingId: UUID): List<StockMovement> = jdbc.query(
        """
        SELECT id, organization_id, outlet_id, listing_id, reason, quantity_delta,
               resulting_on_hand, resulting_reserved, source_type, source_reference,
               actor_id, idempotency_key, occurred_at
        FROM mypet.inventory_movement
        WHERE listing_id = ?
        ORDER BY occurred_at, id
        LIMIT 1000
        """.trimIndent(),
        { result, _ -> movement(result) },
        listingId,
    )

    override fun balance(scope: InventoryScope): InventoryBalance = jdbc.query(
        """
        SELECT organization_id, outlet_id, listing_id, on_hand, reserved, version, updated_at
        FROM mypet.inventory_balance
        WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?
        """.trimIndent(),
        { result, _ -> balanceView(result) },
        scope.organizationId,
        scope.outletId,
        scope.listingId,
    ).singleOrNull() ?: resourceUnavailable()

    override fun history(scope: InventoryScope, page: Int, pageSize: Int): InventoryHistoryPage {
        val boundedPage = page.coerceAtLeast(0)
        val boundedSize = pageSize.coerceIn(1, 100)
        val offset = boundedPage.toLong() * boundedSize.toLong()
        val rows = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, listing_id, reason, quantity_delta,
                   resulting_on_hand, resulting_reserved, source_type, source_reference,
                   actor_id, idempotency_key, occurred_at
            FROM mypet.inventory_movement
            WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?
            ORDER BY occurred_at DESC, id DESC
            LIMIT ? OFFSET ?
            """.trimIndent(),
            { result, _ -> movement(result) },
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            boundedSize + 1,
            offset,
        )
        if (rows.isEmpty()) {
            requireListingScope(scope)
        }
        return InventoryHistoryPage(
            items = rows.take(boundedSize),
            page = boundedPage,
            pageSize = boundedSize,
            hasNext = rows.size > boundedSize,
        )
    }

    override fun requireReconciled(scope: InventoryScope): InventoryBalance {
        val current = balance(scope)
        val ledgerOnHand = jdbc.queryForObject(
            """
            SELECT COALESCE(SUM(quantity_delta), 0)
            FROM mypet.inventory_movement
            WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?
            """.trimIndent(),
            Long::class.java,
            scope.organizationId,
            scope.outletId,
            scope.listingId,
        ) ?: 0L
        if (ledgerOnHand != current.onHand.toLong()) {
            throw DomainException("INVENTORY_INTEGRITY_ERROR", "Inventory ledger and balance do not reconcile")
        }
        return current
    }

    private fun mutate(
        scope: InventoryScope,
        operationScope: String,
        idempotencyKey: String,
        fingerprint: String,
        reason: StockReason,
        quantityDelta: Int,
        sourceType: String,
        sourceReference: String,
        actorId: UUID,
        traceId: String,
        change: (Balance) -> Balance,
    ): StockMovement {
        validateCommand(idempotencyKey, traceId, sourceType, sourceReference)
        var lastDuplicate: DuplicateKeyException? = null
        repeat(3) {
            try {
                return requireNotNull(transactions.execute {
                    requireListingScope(scope)
                    ensureBalance(scope)
                    val before = lockBalance(scope)

                    existingReceipt(scope.organizationId, actorId, idempotencyKey)?.let {
                        return@execute replay(it, operationScope, fingerprint)
                    }
                    existingLegacyMovement(scope.outletId, actorId, idempotencyKey)?.let {
                        return@execute replay(it, operationScope, fingerprint)
                    }

                    val after = try {
                        change(before)
                    } catch (_: ArithmeticException) {
                        invalidQuantity()
                    }
                    validateBalance(after)
                    val updated = jdbc.update(
                        """
                        UPDATE mypet.inventory_balance
                        SET on_hand = ?, reserved = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
                        WHERE organization_id = ? AND outlet_id = ? AND listing_id = ? AND version = ?
                        """.trimIndent(),
                        after.onHand,
                        after.reserved,
                        scope.organizationId,
                        scope.outletId,
                        scope.listingId,
                        before.version,
                    )
                    if (updated != 1) {
                        throw DomainException("INVENTORY_CONFLICT", "Inventory changed concurrently; retry safely")
                    }

                    val movement = StockMovement(
                        id = UUID.randomUUID(),
                        listingId = scope.listingId,
                        reason = reason,
                        quantityDelta = quantityDelta,
                        resultingOnHand = after.onHand,
                        resultingReserved = after.reserved,
                        sourceReference = sourceReference,
                        occurredAt = Instant.now(),
                        organizationId = scope.organizationId,
                        outletId = scope.outletId,
                        actorId = actorId,
                        idempotencyKey = idempotencyKey,
                        sourceType = sourceType,
                    )
                    insertMovement(movement, operationScope, fingerprint, traceId)
                    insertReceipt(movement, operationScope, fingerprint)
                    insertPublication(movement, traceId)
                    movement
                })
            } catch (duplicate: DuplicateKeyException) {
                lastDuplicate = duplicate
                existingReceipt(scope.organizationId, actorId, idempotencyKey)?.let {
                    return replay(it, operationScope, fingerprint)
                }
                existingLegacyMovement(scope.outletId, actorId, idempotencyKey)?.let {
                    return replay(it, operationScope, fingerprint)
                }
            }
        }
        throw lastDuplicate ?: DomainException("INVENTORY_CONFLICT", "Inventory changed concurrently; retry safely")
    }

    private fun insertMovement(
        movement: StockMovement,
        operationScope: String,
        requestFingerprint: String,
        traceId: String,
    ) {
        jdbc.update(
            """
            INSERT INTO mypet.inventory_movement (
                id, organization_id, listing_id, outlet_id, reason, quantity_delta,
                resulting_on_hand, resulting_reserved, source_type, source_reference,
                actor_id, idempotency_key, trace_id, operation_scope, request_fingerprint, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            movement.id,
            movement.organizationId,
            movement.listingId,
            movement.outletId,
            movement.reason.name,
            movement.quantityDelta,
            movement.resultingOnHand,
            movement.resultingReserved,
            movement.sourceType,
            movement.sourceReference,
            movement.actorId,
            movement.idempotencyKey,
            traceId,
            operationScope,
            requestFingerprint,
            movement.occurredAt,
        )
    }

    private fun insertReceipt(
        movement: StockMovement,
        operationScope: String,
        requestFingerprint: String,
    ) {
        jdbc.update(
            """
            INSERT INTO mypet.inventory_command_receipt (
                id, organization_id, outlet_id, listing_id, actor_id, idempotency_key,
                operation_scope, request_fingerprint, movement_id,
                resulting_on_hand, resulting_reserved, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """.trimIndent(),
            UUID.randomUUID(),
            movement.organizationId,
            movement.outletId,
            movement.listingId,
            movement.actorId,
            movement.idempotencyKey,
            operationScope,
            requestFingerprint,
            movement.id,
            movement.resultingOnHand,
            movement.resultingReserved,
        )
    }

    private fun insertPublication(movement: StockMovement, traceId: String) {
        val payload = """{"movementId":"${movement.id}","organizationId":"${movement.organizationId}","outletId":"${movement.outletId}","listingId":"${movement.listingId}","reason":"${movement.reason.name}","quantityDelta":${movement.quantityDelta},"onHand":${movement.resultingOnHand},"reserved":${movement.resultingReserved}}"""
        jdbc.update(
            """
            INSERT INTO mypet.outbox_event (
                id, aggregate_type, aggregate_id, event_type, event_version, payload, status, trace_id
            ) VALUES (?, 'INVENTORY_MOVEMENT', ?, 'INVENTORY_BALANCE_CHANGED', 1, ?, 'PENDING', ?)
            """.trimIndent(),
            UUID.randomUUID(),
            movement.id,
            payload,
            traceId,
        )
    }

    private fun ensureBalance(scope: InventoryScope) {
        val existing = jdbc.query(
            "SELECT organization_id, outlet_id FROM mypet.inventory_balance WHERE listing_id = ?",
            { result, _ ->
                result.getObject("organization_id", UUID::class.java) to result.getObject("outlet_id", UUID::class.java)
            },
            scope.listingId,
        ).singleOrNull()
        if (existing != null) {
            if (existing.first != scope.organizationId || existing.second != scope.outletId) integrityFailure()
            return
        }
        jdbc.update(
            """
            INSERT INTO mypet.inventory_balance (
                listing_id, organization_id, outlet_id, on_hand, reserved, version, updated_at
            ) VALUES (?, ?, ?, 0, 0, 0, CURRENT_TIMESTAMP)
            """.trimIndent(),
            scope.listingId,
            scope.organizationId,
            scope.outletId,
        )
    }

    private fun lockBalance(scope: InventoryScope): Balance = jdbc.query(
        """
        SELECT on_hand, reserved, version
        FROM mypet.inventory_balance
        WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?
        FOR UPDATE
        """.trimIndent(),
        { result, _ -> Balance(result.getInt("on_hand"), result.getInt("reserved"), result.getLong("version")) },
        scope.organizationId,
        scope.outletId,
        scope.listingId,
    ).singleOrNull() ?: resourceUnavailable()

    private fun scopeForListing(listingId: UUID): InventoryScope = jdbc.query(
        "SELECT organization_id, outlet_id, id FROM mypet.catalog_listing WHERE id = ?",
        { result, _ ->
            InventoryScope(
                organizationId = result.getObject("organization_id", UUID::class.java),
                outletId = result.getObject("outlet_id", UUID::class.java),
                listingId = result.getObject("id", UUID::class.java),
            )
        },
        listingId,
    ).singleOrNull() ?: resourceUnavailable()

    private fun requireListingScope(scope: InventoryScope) {
        val count = jdbc.queryForObject(
            """
            SELECT COUNT(*) FROM mypet.catalog_listing
            WHERE organization_id = ? AND outlet_id = ? AND id = ?
            """.trimIndent(),
            Long::class.java,
            scope.organizationId,
            scope.outletId,
            scope.listingId,
        ) ?: 0L
        if (count != 1L) resourceUnavailable()
    }

    private fun existingReceipt(
        organizationId: UUID,
        actorId: UUID,
        idempotencyKey: String,
    ): StoredMovement? = jdbc.query(
        """
        SELECT m.id, m.organization_id, m.outlet_id, m.listing_id, m.reason, m.quantity_delta,
               m.resulting_on_hand, m.resulting_reserved, m.source_type, m.source_reference,
               m.actor_id, m.idempotency_key, m.occurred_at,
               r.operation_scope, r.request_fingerprint
        FROM mypet.inventory_command_receipt r
        JOIN mypet.inventory_movement m ON m.id = r.movement_id
        WHERE r.organization_id = ? AND r.actor_id = ? AND r.idempotency_key = ?
        """.trimIndent(),
        { result, _ -> storedMovement(result) },
        organizationId,
        actorId,
        idempotencyKey,
    ).singleOrNull()

    private fun existingLegacyMovement(
        outletId: UUID,
        actorId: UUID,
        idempotencyKey: String,
    ): StoredMovement? = jdbc.query(
        """
        SELECT id, organization_id, outlet_id, listing_id, reason, quantity_delta,
               resulting_on_hand, resulting_reserved, source_type, source_reference,
               actor_id, idempotency_key, occurred_at, operation_scope, request_fingerprint
        FROM mypet.inventory_movement
        WHERE outlet_id = ? AND actor_id = ? AND idempotency_key = ?
        """.trimIndent(),
        { result, _ -> storedMovement(result) },
        outletId,
        actorId,
        idempotencyKey,
    ).singleOrNull()

    private fun replay(existing: StoredMovement, operationScope: String, requestFingerprint: String): StockMovement {
        if (existing.operationScope != operationScope || existing.requestFingerprint != requestFingerprint) {
            throw DomainException(
                "IDEMPOTENCY_FINGERPRINT_MISMATCH",
                "The idempotency key was already used for another request",
            )
        }
        return existing.movement
    }

    private fun storedMovement(result: ResultSet): StoredMovement = StoredMovement(
        movement = movement(result),
        operationScope = result.getString("operation_scope"),
        requestFingerprint = result.getString("request_fingerprint"),
    )

    private fun movement(result: ResultSet): StockMovement = StockMovement(
        id = result.getObject("id", UUID::class.java),
        listingId = result.getObject("listing_id", UUID::class.java),
        reason = StockReason.valueOf(result.getString("reason")),
        quantityDelta = result.getInt("quantity_delta"),
        resultingOnHand = result.getInt("resulting_on_hand"),
        resultingReserved = result.getInt("resulting_reserved"),
        sourceReference = result.getString("source_reference"),
        occurredAt = result.getObject("occurred_at", OffsetDateTime::class.java).toInstant(),
        organizationId = result.getObject("organization_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        actorId = result.getObject("actor_id", UUID::class.java),
        idempotencyKey = result.getString("idempotency_key"),
        sourceType = result.getString("source_type"),
    )

    private fun balanceView(result: ResultSet): InventoryBalance = InventoryBalance(
        organizationId = result.getObject("organization_id", UUID::class.java),
        outletId = result.getObject("outlet_id", UUID::class.java),
        listingId = result.getObject("listing_id", UUID::class.java),
        onHand = result.getInt("on_hand"),
        reserved = result.getInt("reserved"),
        version = result.getLong("version"),
        updatedAt = result.getObject("updated_at", OffsetDateTime::class.java).toInstant(),
    )

    private fun validateCommand(
        idempotencyKey: String,
        traceId: String,
        sourceType: String,
        sourceReference: String,
    ) {
        if (!idempotencyKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
        if (!traceId.matches(Regex("[A-Za-z0-9._:-]{1,64}"))) {
            throw DomainException("TRACE_ID_INVALID", "The trace identifier is invalid")
        }
        if (sourceType.isBlank() || sourceType.length > 40 || sourceReference.isBlank() || sourceReference.length > 160) {
            throw DomainException("INVENTORY_REFERENCE_INVALID", "Inventory movement reference is invalid")
        }
    }

    private fun validateBalance(balance: Balance) {
        if (balance.onHand < 0 || balance.reserved < 0 || balance.reserved > balance.onHand) insufficient()
    }

    private fun requirePositive(quantity: Int) {
        if (quantity <= 0) throw DomainException("QUANTITY_INVALID", "Quantity must be positive")
    }

    private fun safeAdd(left: Int, right: Int): Int = try {
        Math.addExact(left, right)
    } catch (_: ArithmeticException) {
        invalidQuantity()
    }

    private fun fingerprint(vararg parts: Any?): String {
        val canonical = parts.joinToString("|") { part ->
            val value = part?.toString() ?: "<null>"
            "${value.length}:$value"
        }
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun invalidQuantity(): Nothing = throw DomainException(
        "INVENTORY_QUANTITY_INVALID",
        "Inventory quantity delta is invalid",
    )

    private fun insufficient(): Nothing = throw DomainException("INSUFFICIENT_STOCK", "Stock is unavailable")

    private fun resourceUnavailable(): Nothing = throw DomainException(
        "RESOURCE_NOT_FOUND",
        "The requested resource is unavailable",
    )

    private fun integrityFailure(): Nothing = throw DomainException(
        "INVENTORY_INTEGRITY_ERROR",
        "Inventory ledger and balance do not reconcile",
    )

    private data class Balance(val onHand: Int, val reserved: Int, val version: Long)
    private data class StoredMovement(
        val movement: StockMovement,
        val operationScope: String,
        val requestFingerprint: String,
    )
}
