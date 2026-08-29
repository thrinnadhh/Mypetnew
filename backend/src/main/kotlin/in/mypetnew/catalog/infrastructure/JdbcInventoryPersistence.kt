package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.CountLineInput
import `in`.mypetnew.catalog.domain.CountReconciliationLineResult
import `in`.mypetnew.catalog.domain.CountReconciliationResult
import `in`.mypetnew.catalog.domain.CountSessionStatus
import `in`.mypetnew.catalog.domain.InventoryBalance
import `in`.mypetnew.catalog.domain.InventoryCountLine
import `in`.mypetnew.catalog.domain.InventoryCountSession
import `in`.mypetnew.catalog.domain.InventoryHistoryPage
import `in`.mypetnew.catalog.domain.InventoryPersistence
import `in`.mypetnew.catalog.domain.InventoryScope
import `in`.mypetnew.catalog.domain.InventoryTransfer
import `in`.mypetnew.catalog.domain.MerchantSyncPublisher
import `in`.mypetnew.catalog.domain.ReturnType
import `in`.mypetnew.catalog.domain.StockMovement
import `in`.mypetnew.catalog.domain.StockReason
import `in`.mypetnew.catalog.domain.TransferResult
import `in`.mypetnew.catalog.domain.TransferStatus
import `in`.mypetnew.common.error.DomainException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.time.OffsetDateTime
import java.util.UUID

class JdbcInventoryPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
    private val syncPublisher: MerchantSyncPublisher? = null,
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

    override fun receive(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String?,
        referenceId: String?,
        batchNumber: String?,
        expiryDate: String?,
    ): StockMovement {
        if (quantity <= 0) invalidQuantity()
        val sourceType = referenceType ?: "RECEIVING"
        val sourceReference = referenceId ?: idempotencyKey
        val reqFingerprint = fingerprint(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.RECEIVING.name,
            referenceType,
            referenceId,
            batchNumber,
            expiryDate,
        )
        return mutate(
            scope = scope,
            operationScope = "inventory-receiving",
            idempotencyKey = idempotencyKey,
            fingerprint = reqFingerprint,
            reason = StockReason.RECEIVING,
            quantityDelta = quantity,
            sourceType = sourceType,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            val newOnHand = safeAdd(balance.onHand, quantity)
            balance.copy(onHand = newOnHand)
        }
    }

    override fun damage(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        reasonDetails: String?,
        referenceId: String?,
    ): StockMovement {
        if (quantity <= 0) invalidQuantity()
        val sourceType = "DAMAGE"
        val sourceReference = referenceId ?: idempotencyKey
        val reqFingerprint = fingerprint(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.DAMAGE.name,
            reasonDetails,
            referenceId,
        )
        return mutate(
            scope = scope,
            operationScope = "inventory-damage",
            idempotencyKey = idempotencyKey,
            fingerprint = reqFingerprint,
            reason = StockReason.DAMAGE,
            quantityDelta = -quantity,
            sourceType = sourceType,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.onHand - balance.reserved < quantity) insufficient()
            balance.copy(onHand = balance.onHand - quantity)
        }
    }

    override fun expire(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        batchReference: String?,
        expiryDate: String?,
    ): StockMovement {
        if (quantity <= 0) invalidQuantity()
        val sourceType = "EXPIRY"
        val sourceReference = batchReference ?: idempotencyKey
        val reqFingerprint = fingerprint(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.EXPIRY.name,
            batchReference,
            expiryDate,
        )
        return mutate(
            scope = scope,
            operationScope = "inventory-expiry",
            idempotencyKey = idempotencyKey,
            fingerprint = reqFingerprint,
            reason = StockReason.EXPIRY,
            quantityDelta = -quantity,
            sourceType = sourceType,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.onHand - balance.reserved < quantity) insufficient()
            balance.copy(onHand = balance.onHand - quantity)
        }
    }

    override fun shrink(
        scope: InventoryScope,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        notes: String?,
        referenceId: String?,
    ): StockMovement {
        if (quantity <= 0) invalidQuantity()
        val sourceType = "SHRINKAGE"
        val sourceReference = referenceId ?: idempotencyKey
        val reqFingerprint = fingerprint(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            StockReason.SHRINKAGE.name,
            notes,
            referenceId,
        )
        return mutate(
            scope = scope,
            operationScope = "inventory-shrinkage",
            idempotencyKey = idempotencyKey,
            fingerprint = reqFingerprint,
            reason = StockReason.SHRINKAGE,
            quantityDelta = -quantity,
            sourceType = sourceType,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (balance.onHand - balance.reserved < quantity) insufficient()
            balance.copy(onHand = balance.onHand - quantity)
        }
    }

    override fun returnStock(
        scope: InventoryScope,
        quantity: Int,
        returnType: ReturnType,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
        referenceType: String?,
        referenceId: String?,
    ): StockMovement {
        if (quantity <= 0) invalidQuantity()
        val reason = if (returnType == ReturnType.CUSTOMER_RETURN) StockReason.CUSTOMER_RETURN else StockReason.VENDOR_RETURN
        val delta = if (returnType == ReturnType.CUSTOMER_RETURN) quantity else -quantity
        val sourceType = referenceType ?: returnType.name
        val sourceReference = referenceId ?: idempotencyKey
        val reqFingerprint = fingerprint(
            scope.organizationId,
            scope.outletId,
            scope.listingId,
            quantity,
            returnType.name,
            referenceType,
            referenceId,
        )
        return mutate(
            scope = scope,
            operationScope = "inventory-return",
            idempotencyKey = idempotencyKey,
            fingerprint = reqFingerprint,
            reason = reason,
            quantityDelta = delta,
            sourceType = sourceType,
            sourceReference = sourceReference,
            actorId = actorId,
            traceId = traceId,
        ) { balance ->
            if (delta < 0 && (balance.onHand - balance.reserved < quantity)) insufficient()
            val newOnHand = safeAdd(balance.onHand, delta)
            balance.copy(onHand = newOnHand)
        }
    }

    override fun transfer(
        organizationId: UUID,
        sourceOutletId: UUID,
        destinationOutletId: UUID,
        sourceListingId: UUID,
        destinationListingId: UUID?,
        quantity: Int,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): TransferResult {
        if (quantity <= 0) invalidQuantity()
        if (sourceOutletId == destinationOutletId) {
            throw DomainException("INVALID_TRANSFER", "Source and destination outlet must be distinct")
        }
        validateCommand(idempotencyKey, traceId, "OUTLET_TRANSFER", idempotencyKey)

        val targetDestListingId = destinationListingId ?: resolveDestinationListing(organizationId, destinationOutletId, sourceListingId)
        val destScope = InventoryScope(organizationId, destinationOutletId, targetDestListingId)
        val sourceScope = InventoryScope(organizationId, sourceOutletId, sourceListingId)

        val reqFingerprint = fingerprint(
            organizationId,
            sourceOutletId,
            destinationOutletId,
            sourceListingId,
            targetDestListingId,
            quantity,
        )

        existingTransfer(organizationId, actorId, idempotencyKey)?.let { existing ->
            if (existing.requestFingerprint != reqFingerprint) {
                throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "The idempotency key was already used for another request")
            }
            val sourceMov = getMovementById(existing.sourceMovementId) ?: resourceUnavailable()
            val destMov = getMovementById(existing.destinationMovementId) ?: resourceUnavailable()
            return TransferResult(existing.transfer, sourceMov, destMov)
        }

        return requireNotNull(transactions.execute {
            requireListingScope(sourceScope)
            requireListingScope(destScope)
            ensureBalance(sourceScope)
            ensureBalance(destScope)

            // Lock balance rows in deterministic order to prevent deadlocks
            val (firstScope, secondScope) = if (sourceOutletId < destinationOutletId) {
                sourceScope to destScope
            } else {
                destScope to sourceScope
            }

            val firstBal = lockBalance(firstScope)
            val secondBal = lockBalance(secondScope)

            val sourceBefore = if (firstScope == sourceScope) firstBal else secondBal
            val destBefore = if (firstScope == destScope) firstBal else secondBal

            existingTransfer(organizationId, actorId, idempotencyKey)?.let { existing ->
                if (existing.requestFingerprint != reqFingerprint) {
                    throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "The idempotency key was already used for another request")
                }
                val sourceMov = getMovementById(existing.sourceMovementId) ?: resourceUnavailable()
                val destMov = getMovementById(existing.destinationMovementId) ?: resourceUnavailable()
                return@execute TransferResult(existing.transfer, sourceMov, destMov)
            }

            if (sourceBefore.onHand - sourceBefore.reserved < quantity) {
                insufficient()
            }

            val sourceNewOnHand = sourceBefore.onHand - quantity
            val destNewOnHand = safeAdd(destBefore.onHand, quantity)

            val updatedSource = jdbc.update(
                """
                UPDATE mypet.inventory_balance
                SET on_hand = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND outlet_id = ? AND listing_id = ? AND version = ?
                """.trimIndent(),
                sourceNewOnHand,
                sourceScope.organizationId,
                sourceScope.outletId,
                sourceScope.listingId,
                sourceBefore.version,
            )
            if (updatedSource != 1) {
                throw DomainException("INVENTORY_CONFLICT", "Inventory changed concurrently; retry safely")
            }

            val updatedDest = jdbc.update(
                """
                UPDATE mypet.inventory_balance
                SET on_hand = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND outlet_id = ? AND listing_id = ? AND version = ?
                """.trimIndent(),
                destNewOnHand,
                destScope.organizationId,
                destScope.outletId,
                destScope.listingId,
                destBefore.version,
            )
            if (updatedDest != 1) {
                throw DomainException("INVENTORY_CONFLICT", "Inventory changed concurrently; retry safely")
            }

            val transferId = UUID.randomUUID()
            val sourceMovement = StockMovement(
                id = UUID.randomUUID(),
                listingId = sourceListingId,
                reason = StockReason.TRANSFER_OUT,
                quantityDelta = -quantity,
                resultingOnHand = sourceNewOnHand,
                resultingReserved = sourceBefore.reserved,
                sourceReference = transferId.toString(),
                occurredAt = Instant.now(),
                organizationId = organizationId,
                outletId = sourceOutletId,
                actorId = actorId,
                idempotencyKey = "transfer-out:$idempotencyKey",
                sourceType = "OUTLET_TRANSFER",
            )
            val destMovement = StockMovement(
                id = UUID.randomUUID(),
                listingId = targetDestListingId,
                reason = StockReason.TRANSFER_IN,
                quantityDelta = quantity,
                resultingOnHand = destNewOnHand,
                resultingReserved = destBefore.reserved,
                sourceReference = transferId.toString(),
                occurredAt = Instant.now(),
                organizationId = organizationId,
                outletId = destinationOutletId,
                actorId = actorId,
                idempotencyKey = "transfer-in:$idempotencyKey",
                sourceType = "OUTLET_TRANSFER",
            )

            insertMovement(sourceMovement, "inventory-transfer-out", reqFingerprint, traceId)
            insertMovement(destMovement, "inventory-transfer-in", reqFingerprint, traceId)
            insertReceipt(sourceMovement, "inventory-transfer-out", reqFingerprint)
            insertReceipt(destMovement, "inventory-transfer-in", reqFingerprint)

            jdbc.update(
                """
                INSERT INTO mypet.inventory_transfer (
                    id, organization_id, source_outlet_id, destination_outlet_id,
                    source_listing_id, destination_listing_id, quantity, status,
                    actor_id, idempotency_key, request_fingerprint,
                    source_movement_id, destination_movement_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """.trimIndent(),
                transferId,
                organizationId,
                sourceOutletId,
                destinationOutletId,
                sourceListingId,
                targetDestListingId,
                quantity,
                actorId,
                idempotencyKey,
                reqFingerprint,
                sourceMovement.id,
                destMovement.id,
            )

            insertPublication(sourceMovement, traceId)
            insertPublication(destMovement, traceId)

            syncPublisher?.publishInventoryBalanceChange(
                InventoryBalance(
                    organizationId = organizationId,
                    outletId = sourceOutletId,
                    listingId = sourceListingId,
                    onHand = sourceNewOnHand,
                    reserved = sourceBefore.reserved,
                    version = sourceBefore.version + 1,
                    updatedAt = Instant.now(),
                ),
            )
            syncPublisher?.publishInventoryBalanceChange(
                InventoryBalance(
                    organizationId = organizationId,
                    outletId = destinationOutletId,
                    listingId = targetDestListingId,
                    onHand = destNewOnHand,
                    reserved = destBefore.reserved,
                    version = destBefore.version + 1,
                    updatedAt = Instant.now(),
                ),
            )

            val transferRecord = InventoryTransfer(
                id = transferId,
                organizationId = organizationId,
                sourceOutletId = sourceOutletId,
                destinationOutletId = destinationOutletId,
                sourceListingId = sourceListingId,
                destinationListingId = targetDestListingId,
                quantity = quantity,
                status = TransferStatus.COMPLETED,
                actorId = actorId,
                idempotencyKey = idempotencyKey,
                sourceMovementId = sourceMovement.id,
                destinationMovementId = destMovement.id,
                createdAt = Instant.now(),
            )

            TransferResult(transferRecord, sourceMovement, destMovement)
        })
    }

    override fun startCountSession(
        organizationId: UUID,
        outletId: UUID,
        actorId: UUID,
        traceId: String,
        initialCutoffSequence: Long?,
    ): InventoryCountSession {
        val sessionId = UUID.randomUUID()
        val cutoffSeq = initialCutoffSequence ?: (
            jdbc.queryForObject(
                """
                SELECT COALESCE(MAX(sequence_number), 0)
                FROM mypet.merchant_sync_change_log
                WHERE organization_id = ? AND outlet_id = ?
                """.trimIndent(),
                Long::class.java,
                organizationId,
                outletId,
            ) ?: 0L
        )

        jdbc.update(
            """
            INSERT INTO mypet.inventory_count_session (
                id, organization_id, outlet_id, status, cutoff_sequence_number,
                cutoff_timestamp, actor_id, created_at, updated_at
            ) VALUES (?, ?, ?, 'OPEN', ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """.trimIndent(),
            sessionId,
            organizationId,
            outletId,
            cutoffSeq,
            actorId,
        )

        return getCountSession(organizationId, outletId, sessionId)
    }

    override fun getCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
    ): InventoryCountSession {
        val session = jdbc.query(
            """
            SELECT id, organization_id, outlet_id, status, cutoff_sequence_number,
                   cutoff_timestamp, actor_id, submit_idempotency_key, reconciliation_summary,
                   created_at, updated_at, submitted_at
            FROM mypet.inventory_count_session
            WHERE id = ? AND organization_id = ? AND outlet_id = ?
            """.trimIndent(),
            { rs, _ ->
                InventoryCountSession(
                    id = rs.getObject("id", UUID::class.java),
                    organizationId = rs.getObject("organization_id", UUID::class.java),
                    outletId = rs.getObject("outlet_id", UUID::class.java),
                    status = CountSessionStatus.valueOf(rs.getString("status")),
                    cutoffSequenceNumber = rs.getLong("cutoff_sequence_number"),
                    cutoffTimestamp = rs.getObject("cutoff_timestamp", OffsetDateTime::class.java).toInstant(),
                    actorId = rs.getObject("actor_id", UUID::class.java),
                    submitIdempotencyKey = rs.getString("submit_idempotency_key"),
                    reconciliationSummary = rs.getString("reconciliation_summary"),
                    createdAt = rs.getObject("created_at", OffsetDateTime::class.java).toInstant(),
                    updatedAt = rs.getObject("updated_at", OffsetDateTime::class.java).toInstant(),
                    submittedAt = rs.getObject("submitted_at", OffsetDateTime::class.java)?.toInstant(),
                )
            },
            sessionId,
            organizationId,
            outletId,
        ).singleOrNull() ?: resourceUnavailable()

        val lines = jdbc.query(
            """
            SELECT listing_id, counted_quantity, cutoff_on_hand, reconciled_delta,
                   resulting_on_hand, created_at, updated_at
            FROM mypet.inventory_count_line
            WHERE session_id = ?
            ORDER BY created_at, listing_id
            """.trimIndent(),
            { rs, _ ->
                InventoryCountLine(
                    listingId = rs.getObject("listing_id", UUID::class.java),
                    countedQuantity = rs.getInt("counted_quantity"),
                    cutoffOnHand = rs.getInt("cutoff_on_hand"),
                    reconciledDelta = rs.getObject("reconciled_delta") as? Int,
                    resultingOnHand = rs.getObject("resulting_on_hand") as? Int,
                    createdAt = rs.getObject("created_at", OffsetDateTime::class.java).toInstant(),
                    updatedAt = rs.getObject("updated_at", OffsetDateTime::class.java).toInstant(),
                )
            },
            sessionId,
        )

        return session.copy(lines = lines)
    }

    override fun updateCountLines(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        lines: List<CountLineInput>,
    ): InventoryCountSession {
        return requireNotNull(transactions.execute {
            val session = getCountSession(organizationId, outletId, sessionId)
            if (session.status != CountSessionStatus.OPEN) {
                throw DomainException("INVALID_COUNT_STATE", "Count session is not open for modifications")
            }

            for (input in lines) {
                requireListingScope(InventoryScope(organizationId, outletId, input.listingId))
                val cutoffOnHand = jdbc.queryForObject(
                    """
                    SELECT on_hand FROM mypet.inventory_balance
                    WHERE organization_id = ? AND outlet_id = ? AND listing_id = ?
                    """.trimIndent(),
                    Int::class.java,
                    organizationId,
                    outletId,
                    input.listingId,
                ) ?: 0

                jdbc.update(
                    """
                    INSERT INTO mypet.inventory_count_line (
                        session_id, listing_id, counted_quantity, cutoff_on_hand, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (session_id, listing_id) DO UPDATE
                    SET counted_quantity = EXCLUDED.counted_quantity,
                        updated_at = CURRENT_TIMESTAMP
                    """.trimIndent(),
                    sessionId,
                    input.listingId,
                    input.countedQuantity,
                    cutoffOnHand,
                )
            }

            jdbc.update(
                "UPDATE mypet.inventory_count_session SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                sessionId,
            )

            getCountSession(organizationId, outletId, sessionId)
        })
    }

    override fun submitCountSession(
        organizationId: UUID,
        outletId: UUID,
        sessionId: UUID,
        idempotencyKey: String,
        actorId: UUID,
        traceId: String,
    ): CountReconciliationResult {
        validateCommand(idempotencyKey, traceId, "COUNT_SESSION", idempotencyKey)
        val initialSession = getCountSession(organizationId, outletId, sessionId)

        // Idempotency replay check
        if (initialSession.status == CountSessionStatus.SUBMITTED && initialSession.submitIdempotencyKey == idempotencyKey) {
            return reconstructCountResult(initialSession)
        }

        return requireNotNull(transactions.execute {
            val sessionRow = jdbc.query(
                """
                SELECT id, organization_id, outlet_id, status, cutoff_sequence_number,
                       cutoff_timestamp, actor_id, submit_idempotency_key
                FROM mypet.inventory_count_session
                WHERE id = ? AND organization_id = ? AND outlet_id = ?
                FOR UPDATE
                """.trimIndent(),
                { rs, _ ->
                    object {
                        val status = CountSessionStatus.valueOf(rs.getString("status"))
                        val submitKey = rs.getString("submit_idempotency_key")
                        val cutoffTs = rs.getObject("cutoff_timestamp", OffsetDateTime::class.java).toInstant()
                    }
                },
                sessionId,
                organizationId,
                outletId,
            ).singleOrNull() ?: resourceUnavailable()

            if (sessionRow.status == CountSessionStatus.SUBMITTED) {
                if (sessionRow.submitKey == idempotencyKey) {
                    val current = getCountSession(organizationId, outletId, sessionId)
                    return@execute reconstructCountResult(current)
                }
                throw DomainException("COUNT_ALREADY_SUBMITTED", "Count session is already submitted")
            }
            if (sessionRow.status != CountSessionStatus.OPEN) {
                throw DomainException("INVALID_COUNT_STATE", "Count session is not in OPEN status")
            }

            val lines = jdbc.query(
                """
                SELECT listing_id, counted_quantity, cutoff_on_hand
                FROM mypet.inventory_count_line
                WHERE session_id = ?
                ORDER BY listing_id
                """.trimIndent(),
                { rs, _ ->
                    object {
                        val listingId = rs.getObject("listing_id", UUID::class.java)
                        val countedQuantity = rs.getInt("counted_quantity")
                        val cutoffOnHand = rs.getInt("cutoff_on_hand")
                    }
                },
                sessionId,
            )

            val results = mutableListOf<CountReconciliationLineResult>()

            for (line in lines) {
                val scope = InventoryScope(organizationId, outletId, line.listingId)
                ensureBalance(scope)
                val before = lockBalance(scope)

                // Calculate movements occurring after cutoff
                val deltaAfterCutoff = jdbc.queryForObject(
                    """
                    SELECT COALESCE(SUM(quantity_delta), 0)
                    FROM mypet.inventory_movement
                    WHERE organization_id = ? AND outlet_id = ? AND listing_id = ? AND occurred_at > ?
                    """.trimIndent(),
                    Long::class.java,
                    organizationId,
                    outletId,
                    line.listingId,
                    Timestamp.from(sessionRow.cutoffTs),
                ) ?: 0L

                val targetCurrentOnHand = safeAdd(line.countedQuantity, deltaAfterCutoff.toInt())
                val currentOnHand = before.onHand
                val countAdjustmentDelta = targetCurrentOnHand - currentOnHand

                if (targetCurrentOnHand < before.reserved || targetCurrentOnHand < 0) {
                    jdbc.update(
                        "UPDATE mypet.inventory_count_session SET status = 'REVIEW_REQUIRED', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        sessionId,
                    )
                    throw DomainException("COUNT_CUTOFF_CONFLICT", "Count reconciliation violated negative-stock constraints; moved to review")
                }

                var movementId: UUID? = null
                if (countAdjustmentDelta != 0) {
                    val updated = jdbc.update(
                        """
                        UPDATE mypet.inventory_balance
                        SET on_hand = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
                        WHERE organization_id = ? AND outlet_id = ? AND listing_id = ? AND version = ?
                        """.trimIndent(),
                        targetCurrentOnHand,
                        organizationId,
                        outletId,
                        line.listingId,
                        before.version,
                    )
                    if (updated != 1) {
                        throw DomainException("INVENTORY_CONFLICT", "Inventory changed concurrently; retry safely")
                    }

                    val lineIdempotencyKey = "$idempotencyKey:${line.listingId}"
                    val lineFp = fingerprint(
                        organizationId,
                        outletId,
                        line.listingId,
                        countAdjustmentDelta,
                        StockReason.COUNT_ADJUSTMENT.name,
                    )

                    val movement = StockMovement(
                        id = UUID.randomUUID(),
                        listingId = line.listingId,
                        reason = StockReason.COUNT_ADJUSTMENT,
                        quantityDelta = countAdjustmentDelta,
                        resultingOnHand = targetCurrentOnHand,
                        resultingReserved = before.reserved,
                        sourceReference = sessionId.toString(),
                        occurredAt = Instant.now(),
                        organizationId = organizationId,
                        outletId = outletId,
                        actorId = actorId,
                        idempotencyKey = lineIdempotencyKey,
                        sourceType = "COUNT_SESSION",
                    )
                    insertMovement(movement, "count-adjustment", lineFp, traceId)
                    insertReceipt(movement, "count-adjustment", lineFp)
                    insertPublication(movement, traceId)

                    syncPublisher?.publishInventoryBalanceChange(
                        InventoryBalance(
                            organizationId = organizationId,
                            outletId = outletId,
                            listingId = line.listingId,
                            onHand = targetCurrentOnHand,
                            reserved = before.reserved,
                            version = before.version + 1,
                            updatedAt = Instant.now(),
                        ),
                    )
                    movementId = movement.id
                }

                jdbc.update(
                    """
                    UPDATE mypet.inventory_count_line
                    SET reconciled_delta = ?, resulting_on_hand = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE session_id = ? AND listing_id = ?
                    """.trimIndent(),
                    countAdjustmentDelta,
                    targetCurrentOnHand,
                    sessionId,
                    line.listingId,
                )

                results.add(
                    CountReconciliationLineResult(
                        listingId = line.listingId,
                        countedQuantity = line.countedQuantity,
                        cutoffOnHand = line.cutoffOnHand,
                        deltaAfterCutoff = deltaAfterCutoff.toInt(),
                        targetCurrentOnHand = targetCurrentOnHand,
                        currentOnHandBeforeAdjustment = currentOnHand,
                        countAdjustmentDelta = countAdjustmentDelta,
                        resultingOnHand = targetCurrentOnHand,
                        movementId = movementId,
                    ),
                )
            }

            jdbc.update(
                """
                UPDATE mypet.inventory_count_session
                SET status = 'SUBMITTED', submit_idempotency_key = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """.trimIndent(),
                idempotencyKey,
                sessionId,
            )

            CountReconciliationResult(
                sessionId = sessionId,
                status = CountSessionStatus.SUBMITTED,
                lines = results,
                submittedAt = Instant.now(),
            )
        })
    }

    private fun reconstructCountResult(session: InventoryCountSession): CountReconciliationResult {
        val lines = session.lines.map { line ->
            CountReconciliationLineResult(
                listingId = line.listingId,
                countedQuantity = line.countedQuantity,
                cutoffOnHand = line.cutoffOnHand,
                deltaAfterCutoff = (line.resultingOnHand ?: line.cutoffOnHand) - line.countedQuantity - (line.reconciledDelta ?: 0),
                targetCurrentOnHand = line.resultingOnHand ?: line.cutoffOnHand,
                currentOnHandBeforeAdjustment = (line.resultingOnHand ?: line.cutoffOnHand) - (line.reconciledDelta ?: 0),
                countAdjustmentDelta = line.reconciledDelta ?: 0,
                resultingOnHand = line.resultingOnHand ?: line.cutoffOnHand,
            )
        }
        return CountReconciliationResult(
            sessionId = session.id,
            status = session.status,
            lines = lines,
            submittedAt = session.submittedAt ?: session.updatedAt,
        )
    }

    private fun resolveDestinationListing(organizationId: UUID, destinationOutletId: UUID, sourceListingId: UUID): UUID {
        val sourceBarcode = jdbc.query(
            "SELECT barcode_type, normalized_barcode FROM mypet.catalog_listing WHERE id = ? AND organization_id = ?",
            { rs, _ -> rs.getString("barcode_type") to rs.getString("normalized_barcode") },
            sourceListingId,
            organizationId,
        ).singleOrNull() ?: resourceUnavailable()

        val destListing = jdbc.query(
            """
            SELECT id FROM mypet.catalog_listing
            WHERE organization_id = ? AND outlet_id = ? AND barcode_type = ? AND normalized_barcode = ?
            """.trimIndent(),
            { rs, _ -> rs.getObject("id", UUID::class.java) },
            organizationId,
            destinationOutletId,
            sourceBarcode.first,
            sourceBarcode.second,
        ).singleOrNull()

        return destListing ?: throw DomainException("INVALID_TRANSFER", "Destination outlet listing not found for item barcode")
    }

    private fun existingTransfer(
        organizationId: UUID,
        actorId: UUID,
        idempotencyKey: String,
    ): StoredTransfer? = jdbc.query(
        """
        SELECT id, organization_id, source_outlet_id, destination_outlet_id,
               source_listing_id, destination_listing_id, quantity, status,
               actor_id, idempotency_key, request_fingerprint,
               source_movement_id, destination_movement_id, created_at
        FROM mypet.inventory_transfer
        WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?
        """.trimIndent(),
        { rs, _ ->
            val transfer = InventoryTransfer(
                id = rs.getObject("id", UUID::class.java),
                organizationId = rs.getObject("organization_id", UUID::class.java),
                sourceOutletId = rs.getObject("source_outlet_id", UUID::class.java),
                destinationOutletId = rs.getObject("destination_outlet_id", UUID::class.java),
                sourceListingId = rs.getObject("source_listing_id", UUID::class.java),
                destinationListingId = rs.getObject("destination_listing_id", UUID::class.java),
                quantity = rs.getInt("quantity"),
                status = TransferStatus.valueOf(rs.getString("status")),
                actorId = rs.getObject("actor_id", UUID::class.java),
                idempotencyKey = rs.getString("idempotency_key"),
                sourceMovementId = rs.getObject("source_movement_id", UUID::class.java),
                destinationMovementId = rs.getObject("destination_movement_id", UUID::class.java),
                createdAt = rs.getObject("created_at", OffsetDateTime::class.java).toInstant(),
            )
            StoredTransfer(
                transfer = transfer,
                requestFingerprint = rs.getString("request_fingerprint"),
                sourceMovementId = transfer.sourceMovementId,
                destinationMovementId = transfer.destinationMovementId,
            )
        },
        organizationId,
        actorId,
        idempotencyKey,
    ).singleOrNull()

    private fun getMovementById(movementId: UUID): StockMovement? = jdbc.query(
        """
        SELECT id, organization_id, outlet_id, listing_id, reason, quantity_delta,
               resulting_on_hand, resulting_reserved, source_type, source_reference,
               actor_id, idempotency_key, occurred_at
        FROM mypet.inventory_movement
        WHERE id = ?
        """.trimIndent(),
        { rs, _ -> movement(rs) },
        movementId,
    ).singleOrNull()

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

    override fun findExistingMovementByReceipt(organizationId: UUID, actorId: UUID, idempotencyKey: String): StockMovement? {
        val movementId = jdbc.query(
            """
            SELECT movement_id FROM mypet.inventory_command_receipt
            WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?
            """.trimIndent(),
            { rs, _ -> rs.getObject("movement_id", UUID::class.java) },
            organizationId,
            actorId,
            idempotencyKey,
        ).firstOrNull() ?: return null

        return jdbc.query(
            """
            SELECT id, organization_id, outlet_id, listing_id, reason, quantity_delta,
                   resulting_on_hand, resulting_reserved, source_type, source_reference,
                   actor_id, idempotency_key, occurred_at
            FROM mypet.inventory_movement
            WHERE id = ?
            """.trimIndent(),
            { rs, _ -> movement(rs) },
            movementId,
        ).firstOrNull()
    }

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
                    syncPublisher?.publishInventoryBalanceChange(
                        InventoryBalance(
                            organizationId = scope.organizationId,
                            outletId = scope.outletId,
                            listingId = scope.listingId,
                            onHand = after.onHand,
                            reserved = after.reserved,
                            version = before.version + 1,
                            updatedAt = Instant.now(),
                        ),
                    )
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
            Timestamp.from(movement.occurredAt),
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
    private data class StoredTransfer(
        val transfer: InventoryTransfer,
        val requestFingerprint: String,
        val sourceMovementId: UUID,
        val destinationMovementId: UUID,
    )
}
