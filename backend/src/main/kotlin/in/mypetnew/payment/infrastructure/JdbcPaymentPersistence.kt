package `in`.mypetnew.payment.infrastructure

import `in`.mypetnew.catalog.domain.InventoryService
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.InMemoryPaymentPersistence
import `in`.mypetnew.payment.domain.Payment
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.PaymentPersistence
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentReferenceType
import `in`.mypetnew.payment.domain.PaymentRefund
import `in`.mypetnew.payment.domain.PaymentStatus
import `in`.mypetnew.payment.domain.PaymentWebhookEvent
import `in`.mypetnew.payment.domain.PreparePaymentResult
import `in`.mypetnew.payment.domain.ProviderCommandState
import `in`.mypetnew.payment.domain.ProviderCustomer
import `in`.mypetnew.payment.domain.ProviderPaymentSnapshot
import `in`.mypetnew.payment.domain.RefundExecutionState
import `in`.mypetnew.payment.domain.RefundProviderResult
import `in`.mypetnew.payment.domain.RefundStatus
import `in`.mypetnew.payment.domain.WebhookInboxItem
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID

class JdbcPaymentPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
    private val inventory: InventoryService,
) : PaymentPersistence {
    override fun prepare(
        customerId: UUID,
        referenceType: PaymentReferenceType,
        referenceId: UUID,
        provider: PaymentProvider,
        idempotencyKey: String,
        requestFingerprint: String,
        now: Instant,
    ): PreparePaymentResult = transaction {
        val order = lockOwnedOrder(referenceId, customerId)
        val providerCustomer = providerCustomer(customerId)

        command(customerId, idempotencyKey)?.let { existing ->
            if (existing.requestFingerprint != requestFingerprint) mismatch()
            val payment = lockPaymentById(existing.paymentId)
            return@transaction PreparePaymentResult(payment, shouldCall(payment), providerCustomer)
        }

        validatePayable(order, now)
        lockPayment(referenceType, referenceId, provider)?.let { existing ->
            bindCommand(customerId, idempotencyKey, requestFingerprint, existing.id, now)
            return@transaction PreparePaymentResult(existing, shouldCall(existing), providerCustomer)
        }

        val paymentId = UUID.randomUUID()
        val providerOrderReference = InMemoryPaymentPersistence.providerOrderReference(paymentId)
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment (
                    id, reference_type, reference_id, customer_id, provider, status,
                    amount_paise, currency, provider_order_reference, provider_idempotency_key,
                    provider_command_state, reconciliation_required, next_reconciliation_at, expires_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, 'INR', ?, ?, 'PREPARED', TRUE, ?, ?, ?, ?)
                """.trimIndent(),
                paymentId,
                referenceType.name,
                referenceId,
                customerId,
                provider.name,
                order.amountPaise,
                providerOrderReference,
                paymentId.toString(),
                now.jdbcTimestamp(),
                requireNotNull(order.expiresAt).jdbcTimestamp(),
                now.jdbcTimestamp(),
                now.jdbcTimestamp(),
            )
            bindCommand(customerId, idempotencyKey, requestFingerprint, paymentId, now)
            insertPaymentHistory(paymentId, null, PaymentStatus.PENDING, "PAYMENT_INITIATED", "initiate:$idempotencyKey", now)
        } catch (_: DuplicateKeyException) {
            val existing = lockPayment(referenceType, referenceId, provider)
                ?: throw DomainException("PAYMENT_CONFLICT", "Payment initiation raced; retry safely")
            bindCommand(customerId, idempotencyKey, requestFingerprint, existing.id, now)
            return@transaction PreparePaymentResult(existing, shouldCall(existing), providerCustomer)
        }
        PreparePaymentResult(requirePayment(paymentId), true, providerCustomer)
    }

    override fun completeProviderOrder(
        paymentId: UUID,
        result: CreateProviderOrderResult,
        now: Instant,
    ): Payment {
        val referenceId = referenceIdForPayment(paymentId)
        return transaction {
            lockOrder(referenceId)
            val payment = lockPaymentById(paymentId)
            when (result) {
                is CreateProviderOrderResult.Created -> jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET provider_session_id = ?, provider_command_state = 'CREATED',
                        reconciliation_required = TRUE, next_reconciliation_at = ?,
                        last_provider_error_code = NULL, version = version + 1, updated_at = ?
                    WHERE id = ? AND status <> 'CAPTURED'
                    """.trimIndent(),
                    result.paymentSessionId.take(512),
                    now.plusSeconds(30).jdbcTimestamp(),
                    now.jdbcTimestamp(),
                    paymentId,
                )
                is CreateProviderOrderResult.Rejected -> {
                    if (payment.status != PaymentStatus.CAPTURED) {
                        jdbc.update(
                            """
                            UPDATE mypet.payment
                            SET status = 'FAILED', provider_command_state = 'REJECTED',
                                last_provider_error_code = ?, reconciliation_required = FALSE,
                                next_reconciliation_at = NULL, version = version + 1, updated_at = ?
                            WHERE id = ? AND status <> 'CAPTURED'
                            """.trimIndent(),
                            result.safeErrorCode.take(64),
                            now.jdbcTimestamp(),
                            paymentId,
                        )
                        insertPaymentHistory(
                            paymentId,
                            payment.status,
                            PaymentStatus.FAILED,
                            "PROVIDER_ORDER_REJECTED",
                            "create-order:$paymentId",
                            now,
                        )
                    }
                }
                is CreateProviderOrderResult.Unknown -> jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET provider_command_state = 'UNKNOWN', reconciliation_required = TRUE,
                        next_reconciliation_at = ?, last_provider_error_code = ?,
                        version = version + 1, updated_at = ?
                    WHERE id = ? AND status <> 'CAPTURED'
                    """.trimIndent(),
                    now.plusSeconds(30).jdbcTimestamp(),
                    result.safeErrorCode.take(64),
                    now.jdbcTimestamp(),
                    paymentId,
                )
            }
            requirePayment(paymentId)
        }
    }

    override fun getOwned(paymentId: UUID, customerId: UUID): Payment = jdbc.query(
        """
        SELECT p.id, p.reference_type, p.reference_id, p.customer_id, p.provider, p.status,
               p.amount_paise, p.currency, p.provider_order_reference, p.provider_session_id,
               p.provider_idempotency_key, p.provider_command_state, p.expires_at,
               p.reconciliation_required, r.status AS refund_status
        FROM mypet.payment p
        LEFT JOIN mypet.payment_refund r ON r.payment_id = p.id
        WHERE p.id = ? AND p.customer_id = ?
        """.trimIndent(),
        { row, _ -> payment(row, row.getString("refund_status")) },
        paymentId,
        customerId,
    ).singleOrNull() ?: notFound()

    override fun saveWebhook(event: PaymentWebhookEvent, now: Instant): Boolean = try {
        jdbc.update(
            """
            INSERT INTO mypet.payment_webhook_inbox (
                id, provider, delivery_identity, webhook_version, event_type,
                provider_order_reference, provider_payment_id, attempt_status,
                order_amount_paise, order_currency, payment_amount_paise, payment_currency,
                provider_payment_time, provider_event_time, payload_sha256,
                safe_error_code, safe_error_reason, processing_status, retry_count,
                received_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 0, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            event.provider.name,
            event.deliveryIdentity.take(160),
            event.webhookVersion.take(24),
            event.eventType.take(80),
            event.providerOrderReference.take(45),
            event.providerPaymentId?.take(96),
            event.attemptOutcome?.name,
            event.orderAmountPaise,
            event.orderCurrency,
            event.paymentAmountPaise,
            event.paymentCurrency,
            event.providerPaymentTime?.jdbcTimestamp(),
            event.providerEventTime?.jdbcTimestamp(),
            event.payloadSha256,
            event.safeErrorCode?.take(64),
            event.safeErrorReason?.take(240),
            now.jdbcTimestamp(),
            now.jdbcTimestamp(),
        ) == 1
    } catch (_: DuplicateKeyException) {
        false
    }

    override fun claimWebhooks(limit: Int, now: Instant, lease: Duration): List<WebhookInboxItem> = transaction {
        val ids = jdbc.query(
            """
            SELECT id
            FROM mypet.payment_webhook_inbox
            WHERE processing_status IN ('RECEIVED', 'FAILED')
               OR (processing_status = 'PROCESSING' AND lease_expires_at < ?)
            ORDER BY received_at, id
            LIMIT ?
            FOR UPDATE SKIP LOCKED
            """.trimIndent(),
            { row, _ -> row.getObject("id", UUID::class.java) },
            now.jdbcTimestamp(),
            limit,
        )
        ids.mapNotNull { id ->
            val updated = jdbc.update(
                """
                UPDATE mypet.payment_webhook_inbox
                SET processing_status = 'PROCESSING', retry_count = retry_count + 1,
                    claim_started_at = ?, lease_expires_at = ?, last_safe_error = NULL, updated_at = ?
                WHERE id = ? AND processing_status <> 'PROCESSED'
                """.trimIndent(),
                now.jdbcTimestamp(),
                now.plus(lease).jdbcTimestamp(),
                now.jdbcTimestamp(),
                id,
            )
            if (updated != 1) null else webhookInbox(id)
        }
    }

    override fun applyProviderPayment(
        snapshot: ProviderPaymentSnapshot,
        sourceIdentity: String,
        now: Instant,
    ): Payment {
        val pointer = paymentPointer(snapshot.providerOrderReference)
        return transaction {
            val order = lockOrder(pointer.referenceId)
            val payment = lockPaymentById(pointer.paymentId)
            validateProviderSnapshot(payment, snapshot)

            if (snapshot.outcome != null) {
                insertOrValidateAttempt(payment, snapshot, now)
            }

            if (snapshot.outcome == PaymentAttemptOutcome.SUCCESS && payment.status != PaymentStatus.CAPTURED) {
                val liveOrder = order.status == "PLACED" && order.paymentStatus == "PENDING_ONLINE_PAYMENT" &&
                    order.paymentHoldExpiresAt != null && now.isBefore(order.paymentHoldExpiresAt)
                if (liveOrder) {
                    jdbc.update(
                        """
                        UPDATE mypet.payment
                        SET status = 'CAPTURED', captured_at = COALESCE(captured_at, ?),
                            reconciliation_required = FALSE, next_reconciliation_at = NULL,
                            last_provider_error_code = NULL, version = version + 1, updated_at = ?
                        WHERE id = ? AND status <> 'CAPTURED'
                        """.trimIndent(),
                        (snapshot.providerPaymentTime ?: now).jdbcTimestamp(),
                        now.jdbcTimestamp(),
                        payment.id,
                    )
                    jdbc.update(
                        "UPDATE mypet.product_order SET payment_status = 'PAID', version = version + 1, updated_at = ? WHERE id = ?",
                        now.jdbcTimestamp(),
                        order.id,
                    )
                    insertPaymentHistory(
                        payment.id,
                        payment.status,
                        PaymentStatus.CAPTURED,
                        "PROVIDER_PAYMENT_SUCCESS",
                        sourceIdentity,
                        now,
                    )
                } else {
                    val refundable = order.status in setOf("CANCELLED", "REJECTED") ||
                        (order.status == "PLACED" && order.paymentHoldExpiresAt != null && !now.isBefore(order.paymentHoldExpiresAt))
                    if (!refundable) {
                        throw DomainException("PAYMENT_ORDER_STATE_CONFLICT", "The payment cannot be projected onto this order state")
                    }
                    jdbc.update(
                        """
                        UPDATE mypet.payment
                        SET status = 'CAPTURED', captured_at = COALESCE(captured_at, ?),
                            reconciliation_required = FALSE, next_reconciliation_at = NULL,
                            last_provider_error_code = NULL, version = version + 1, updated_at = ?
                        WHERE id = ? AND status <> 'CAPTURED'
                        """.trimIndent(),
                        (snapshot.providerPaymentTime ?: now).jdbcTimestamp(),
                        now.jdbcTimestamp(),
                        payment.id,
                    )
                    insertPaymentHistory(
                        payment.id,
                        payment.status,
                        PaymentStatus.CAPTURED,
                        "LATE_PROVIDER_PAYMENT_SUCCESS",
                        sourceIdentity,
                        now,
                    )
                    ensureRefund(payment.copy(status = PaymentStatus.CAPTURED), now)
                    if (order.status == "PLACED") {
                        releaseExpiredOrder(order, now)
                    }
                    jdbc.update(
                        "UPDATE mypet.product_order SET payment_status = 'REFUND_PENDING', version = version + 1, updated_at = ? WHERE id = ?",
                        now.jdbcTimestamp(),
                        order.id,
                    )
                }
            }
            requirePayment(payment.id)
        }
    }

    override fun markWebhookProcessed(inboxId: UUID, now: Instant) {
        jdbc.update(
            """
            UPDATE mypet.payment_webhook_inbox
            SET processing_status = 'PROCESSED', processed_at = ?, lease_expires_at = NULL,
                last_safe_error = NULL, updated_at = ?
            WHERE id = ? AND processing_status = 'PROCESSING'
            """.trimIndent(),
            now.jdbcTimestamp(),
            now.jdbcTimestamp(),
            inboxId,
        )
    }

    override fun markWebhookFailed(inboxId: UUID, safeError: String, now: Instant) {
        jdbc.update(
            """
            UPDATE mypet.payment_webhook_inbox
            SET processing_status = 'FAILED', processed_at = NULL, lease_expires_at = NULL,
                last_safe_error = ?, updated_at = ?
            WHERE id = ? AND processing_status = 'PROCESSING'
            """.trimIndent(),
            safeError.take(240),
            now.jdbcTimestamp(),
            inboxId,
        )
    }

    override fun claimPaymentReconciliation(limit: Int, now: Instant, lease: Duration): List<Payment> {
        val candidates = jdbc.query(
            """
            SELECT id, reference_id
            FROM mypet.payment
            WHERE reconciliation_required = TRUE
              AND (next_reconciliation_at IS NULL OR next_reconciliation_at <= ?)
              AND status <> 'CAPTURED'
            ORDER BY COALESCE(next_reconciliation_at, created_at), id
            LIMIT ?
            """.trimIndent(),
            { row, _ -> row.getObject("id", UUID::class.java) to row.getObject("reference_id", UUID::class.java) },
            now.jdbcTimestamp(),
            limit,
        )
        return candidates.mapNotNull { candidate ->
            transaction {
                lockOrder(candidate.second)
                val payment = lockPaymentById(candidate.first)
                if (!payment.reconciliationRequired || payment.status == PaymentStatus.CAPTURED) return@transaction null
                val updated = jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET next_reconciliation_at = ?, reconciliation_attempts = reconciliation_attempts + 1,
                        updated_at = ?
                    WHERE id = ? AND reconciliation_required = TRUE
                      AND (next_reconciliation_at IS NULL OR next_reconciliation_at <= ?)
                    """.trimIndent(),
                    now.plus(lease).jdbcTimestamp(),
                    now.jdbcTimestamp(),
                    payment.id,
                    now.jdbcTimestamp(),
                )
                if (updated == 1) requirePayment(payment.id) else null
            }
        }
    }

    override fun schedulePaymentReconciliation(
        paymentId: UUID,
        safeErrorCode: String?,
        nextAttemptAt: Instant,
        now: Instant,
    ) {
        val referenceId = referenceIdForPayment(paymentId)
        transaction {
            lockOrder(referenceId)
            val payment = lockPaymentById(paymentId)
            if (payment.status != PaymentStatus.CAPTURED) {
                jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET reconciliation_required = TRUE, next_reconciliation_at = ?,
                        last_provider_error_code = ?, updated_at = ?
                    WHERE id = ?
                    """.trimIndent(),
                    nextAttemptAt.jdbcTimestamp(),
                    safeErrorCode?.take(64),
                    now.jdbcTimestamp(),
                    paymentId,
                )
            }
        }
    }

    override fun expiredOrderIds(limit: Int, now: Instant): List<UUID> = jdbc.query(
        """
        SELECT id
        FROM mypet.product_order
        WHERE payment_method = 'ONLINE_PAYMENT'
          AND status = 'PLACED'
          AND payment_status = 'PENDING_ONLINE_PAYMENT'
          AND payment_hold_expires_at IS NOT NULL
          AND payment_hold_expires_at <= ?
        ORDER BY payment_hold_expires_at, id
        LIMIT ?
        """.trimIndent(),
        { row, _ -> row.getObject("id", UUID::class.java) },
        now.jdbcTimestamp(),
        limit,
    )

    override fun claimRefunds(limit: Int, now: Instant, lease: Duration): List<PaymentRefund> {
        val candidates = jdbc.query(
            """
            SELECT r.id, p.id AS payment_id, p.reference_id
            FROM mypet.payment_refund r
            JOIN mypet.payment p ON p.id = r.payment_id
            WHERE r.status <> 'SUCCESS'
              AND (r.next_reconciliation_at IS NULL OR r.next_reconciliation_at <= ?)
              AND (r.lease_expires_at IS NULL OR r.lease_expires_at < ?)
            ORDER BY COALESCE(r.next_reconciliation_at, r.created_at), r.id
            LIMIT ?
            """.trimIndent(),
            { row, _ -> Triple(
                row.getObject("id", UUID::class.java),
                row.getObject("payment_id", UUID::class.java),
                row.getObject("reference_id", UUID::class.java),
            ) },
            now.jdbcTimestamp(),
            now.jdbcTimestamp(),
            limit,
        )
        return candidates.mapNotNull { candidate ->
            transaction {
                lockOrder(candidate.third)
                lockPaymentById(candidate.second)
                val refund = lockRefund(candidate.first)
                if (refund.status == RefundStatus.SUCCESS) return@transaction null
                val updated = jdbc.update(
                    """
                    UPDATE mypet.payment_refund
                    SET claim_started_at = ?, lease_expires_at = ?,
                        reconciliation_attempts = reconciliation_attempts + 1, updated_at = ?
                    WHERE id = ? AND status <> 'SUCCESS'
                      AND (lease_expires_at IS NULL OR lease_expires_at < ?)
                    """.trimIndent(),
                    now.jdbcTimestamp(),
                    now.plus(lease).jdbcTimestamp(),
                    now.jdbcTimestamp(),
                    refund.id,
                    now.jdbcTimestamp(),
                )
                if (updated == 1) requireRefund(refund.id) else null
            }
        }
    }

    override fun completeRefund(refundId: UUID, result: RefundProviderResult, now: Instant): PaymentRefund {
        val pointer = refundPointer(refundId)
        return transaction {
            val order = lockOrder(pointer.referenceId)
            val payment = lockPaymentById(pointer.paymentId)
            val refund = lockRefund(refundId)
            when (result) {
                is RefundProviderResult.Found -> {
                    validateRefundResult(refund, result)
                    val providerRefund = result.refund
                    val next = providerRefund.status
                    val execution = when (next) {
                        RefundStatus.SUCCESS, RefundStatus.FAILED -> RefundExecutionState.TERMINAL
                        RefundStatus.PENDING -> RefundExecutionState.SUBMITTED
                    }
                    val reconcile = next != RefundStatus.SUCCESS
                    val nextAt = when (next) {
                        RefundStatus.SUCCESS -> null
                        RefundStatus.PENDING -> now.plusSeconds(30)
                        RefundStatus.FAILED -> now.plus(Duration.ofMinutes(5))
                    }
                    jdbc.update(
                        """
                        UPDATE mypet.payment_refund
                        SET status = ?, execution_state = ?, reconciliation_required = ?,
                            next_reconciliation_at = ?, lease_expires_at = NULL, claim_started_at = NULL,
                            last_provider_status = ?, last_safe_error_code = NULL,
                            completed_at = CASE WHEN ? = 'SUCCESS' THEN ? ELSE completed_at END,
                            version = version + 1, updated_at = ?
                        WHERE id = ?
                        """.trimIndent(),
                        next.name,
                        execution.name,
                        reconcile,
                        nextAt?.jdbcTimestamp(),
                        providerRefund.providerStatus.take(24),
                        next.name,
                        now.jdbcTimestamp(),
                        now.jdbcTimestamp(),
                        refund.id,
                    )
                    insertRefundHistory(refund.id, refund.status, next, "PROVIDER_REFUND_${providerRefund.providerStatus.take(32)}", "refund-provider:$refundId", now)
                    if (next == RefundStatus.SUCCESS) {
                        jdbc.update(
                            "UPDATE mypet.product_order SET payment_status = 'REFUNDED', version = version + 1, updated_at = ? WHERE id = ? AND payment_status = 'REFUND_PENDING'",
                            now.jdbcTimestamp(),
                            order.id,
                        )
                    }
                }
                is RefundProviderResult.Unknown -> jdbc.update(
                    """
                    UPDATE mypet.payment_refund
                    SET execution_state = 'UNKNOWN', reconciliation_required = TRUE,
                        next_reconciliation_at = ?, lease_expires_at = NULL, claim_started_at = NULL,
                        last_safe_error_code = ?, version = version + 1, updated_at = ?
                    WHERE id = ?
                    """.trimIndent(),
                    now.plusSeconds(30).jdbcTimestamp(),
                    result.safeErrorCode.take(64),
                    now.jdbcTimestamp(),
                    refund.id,
                )
                RefundProviderResult.NotFound -> jdbc.update(
                    """
                    UPDATE mypet.payment_refund
                    SET execution_state = 'UNKNOWN', reconciliation_required = TRUE,
                        next_reconciliation_at = ?, lease_expires_at = NULL, claim_started_at = NULL,
                        last_safe_error_code = 'PROVIDER_REFUND_NOT_FOUND', version = version + 1, updated_at = ?
                    WHERE id = ?
                    """.trimIndent(),
                    now.plusSeconds(30).jdbcTimestamp(),
                    now.jdbcTimestamp(),
                    refund.id,
                )
            }
            // The Payment remains CAPTURED regardless of refund state.
            if (payment.status != PaymentStatus.CAPTURED) {
                throw DomainException("REFUND_PAYMENT_STATE_INVALID", "Refund requires a captured payment")
            }
            requireRefund(refundId)
        }
    }

    /**
     * Called by commerce persistence while ProductOrder is already locked in the
     * surrounding transaction. It never locks ProductOrder again, preserving the
     * global ProductOrder -> Payment -> Refund order.
     */
    fun projectTerminalOrder(orderId: UUID, reason: String?, now: Instant): String? {
        val payment = lockPayment(PaymentReferenceType.PRODUCT_ORDER, orderId, PaymentProvider.CASHFREE) ?: return null
        return when (payment.status) {
            PaymentStatus.CAPTURED -> {
                ensureRefund(payment, now)
                "REFUND_PENDING"
            }
            PaymentStatus.PENDING, PaymentStatus.AUTHORIZED -> {
                jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET status = 'EXPIRED', reconciliation_required = TRUE, next_reconciliation_at = ?,
                        version = version + 1, updated_at = ?
                    WHERE id = ? AND status IN ('PENDING', 'AUTHORIZED')
                    """.trimIndent(),
                    now.plusSeconds(30).jdbcTimestamp(),
                    now.jdbcTimestamp(),
                    payment.id,
                )
                insertPaymentHistory(
                    payment.id,
                    payment.status,
                    PaymentStatus.EXPIRED,
                    reason ?: "ORDER_TERMINATED",
                    "order-terminal:$orderId:${reason ?: "unspecified"}",
                    now,
                )
                null
            }
            PaymentStatus.FAILED, PaymentStatus.EXPIRED -> null
        }
    }

    private fun bindCommand(
        customerId: UUID,
        idempotencyKey: String,
        fingerprint: String,
        paymentId: UUID,
        now: Instant,
    ) {
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment_initiation_command (
                    customer_id, idempotency_key, request_fingerprint, payment_id, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """.trimIndent(),
                customerId,
                idempotencyKey,
                fingerprint,
                paymentId,
                now.jdbcTimestamp(),
            )
        } catch (_: DuplicateKeyException) {
            val existing = command(customerId, idempotencyKey) ?: throw DomainException("PAYMENT_CONFLICT", "Payment command raced; retry safely")
            if (existing.requestFingerprint != fingerprint || existing.paymentId != paymentId) mismatch()
        }
    }

    private fun command(customerId: UUID, key: String): StoredCommand? = jdbc.query(
        """
        SELECT request_fingerprint, payment_id
        FROM mypet.payment_initiation_command
        WHERE customer_id = ? AND idempotency_key = ?
        """.trimIndent(),
        { row, _ -> StoredCommand(row.getString("request_fingerprint"), row.getObject("payment_id", UUID::class.java)) },
        customerId,
        key,
    ).singleOrNull()

    private fun providerCustomer(customerId: UUID): ProviderCustomer {
        val mobile = jdbc.query(
            "SELECT mobile_e164 FROM mypet.identity_account WHERE id = ? AND status = 'ACTIVE'",
            { row, _ -> row.getString("mobile_e164") },
            customerId,
        ).singleOrNull() ?: notFound()
        return ProviderCustomer("mypet_${customerId.toString().replace("-", "")}", mobile)
    }

    private fun lockOwnedOrder(referenceId: UUID, customerId: UUID): LockedOrder = jdbc.query(
        """
        SELECT id, status, payment_method, payment_status, grand_total_paise, currency, payment_hold_expires_at
        FROM mypet.product_order
        WHERE id = ? AND customer_id = ?
        FOR UPDATE
        """.trimIndent(),
        { row, _ -> lockedOrder(row) },
        referenceId,
        customerId,
    ).singleOrNull() ?: notFound()

    private fun lockOrder(referenceId: UUID): LockedOrder = jdbc.query(
        """
        SELECT id, status, payment_method, payment_status, grand_total_paise, currency, payment_hold_expires_at
        FROM mypet.product_order
        WHERE id = ?
        FOR UPDATE
        """.trimIndent(),
        { row, _ -> lockedOrder(row) },
        referenceId,
    ).singleOrNull() ?: notFound()

    private fun lockPayment(
        referenceType: PaymentReferenceType,
        referenceId: UUID,
        provider: PaymentProvider,
    ): Payment? = jdbc.query(
        paymentSelect("WHERE reference_type = ? AND reference_id = ? AND provider = ? FOR UPDATE"),
        { row, _ -> payment(row) },
        referenceType.name,
        referenceId,
        provider.name,
    ).singleOrNull()

    private fun lockPaymentById(paymentId: UUID): Payment = jdbc.query(
        paymentSelect("WHERE id = ? FOR UPDATE"),
        { row, _ -> payment(row) },
        paymentId,
    ).singleOrNull() ?: notFound()

    private fun requirePayment(paymentId: UUID): Payment = jdbc.query(
        paymentSelect("WHERE id = ?"),
        { row, _ -> payment(row) },
        paymentId,
    ).singleOrNull() ?: notFound()

    private fun referenceIdForPayment(paymentId: UUID): UUID = jdbc.query(
        "SELECT reference_id FROM mypet.payment WHERE id = ?",
        { row, _ -> row.getObject("reference_id", UUID::class.java) },
        paymentId,
    ).singleOrNull() ?: notFound()

    private fun paymentPointer(providerOrderReference: String): PaymentPointer = jdbc.query(
        "SELECT id, reference_id FROM mypet.payment WHERE provider = 'CASHFREE' AND provider_order_reference = ?",
        { row, _ -> PaymentPointer(row.getObject("id", UUID::class.java), row.getObject("reference_id", UUID::class.java)) },
        providerOrderReference,
    ).singleOrNull() ?: notFound()

    private fun paymentSelect(suffix: String): String = """
        SELECT id, reference_type, reference_id, customer_id, provider, status, amount_paise, currency,
               provider_order_reference, provider_session_id, provider_idempotency_key,
               provider_command_state, expires_at, reconciliation_required
        FROM mypet.payment
        $suffix
    """.trimIndent()

    private fun payment(row: ResultSet, refundStatusValue: String? = null): Payment = Payment(
        id = row.getObject("id", UUID::class.java),
        referenceType = PaymentReferenceType.valueOf(row.getString("reference_type")),
        referenceId = row.getObject("reference_id", UUID::class.java),
        customerId = row.getObject("customer_id", UUID::class.java),
        provider = PaymentProvider.valueOf(row.getString("provider")),
        status = PaymentStatus.valueOf(row.getString("status")),
        amountPaise = row.getLong("amount_paise"),
        currency = row.getString("currency"),
        providerOrderReference = row.getString("provider_order_reference"),
        providerSessionId = row.getString("provider_session_id"),
        providerIdempotencyKey = row.getString("provider_idempotency_key"),
        commandState = ProviderCommandState.valueOf(row.getString("provider_command_state")),
        expiresAt = row.getTimestamp("expires_at").toInstant(),
        reconciliationRequired = row.getBoolean("reconciliation_required"),
        refundStatus = refundStatusValue?.let(RefundStatus::valueOf),
    )

    private fun lockedOrder(row: ResultSet): LockedOrder = LockedOrder(
        id = row.getObject("id", UUID::class.java),
        status = row.getString("status"),
        paymentMethod = row.getString("payment_method"),
        paymentStatus = row.getString("payment_status"),
        amountPaise = row.getLong("grand_total_paise"),
        currency = row.getString("currency"),
        paymentHoldExpiresAt = row.getTimestamp("payment_hold_expires_at")?.toInstant(),
    )

    private fun validatePayable(order: LockedOrder, now: Instant) {
        if (order.paymentMethod != "ONLINE_PAYMENT" || order.status != "PLACED" || order.paymentStatus != "PENDING_ONLINE_PAYMENT") {
            throw DomainException("ORDER_NOT_PAYABLE", "The order is not payable online")
        }
        if (order.currency != "INR") throw DomainException("PAYMENT_CURRENCY_INVALID", "The order currency is unsupported")
        if (order.amountPaise < 0) throw DomainException("PAYMENT_AMOUNT_INVALID", "The order amount is invalid")
        if (order.paymentHoldExpiresAt == null || !now.isBefore(order.paymentHoldExpiresAt)) {
            throw DomainException("ORDER_PAYMENT_EXPIRED", "The online payment hold expired")
        }
    }

    private fun validateProviderSnapshot(payment: Payment, snapshot: ProviderPaymentSnapshot) {
        if (snapshot.providerOrderReference != payment.providerOrderReference) {
            throw DomainException("PAYMENT_PROVIDER_ORDER_MISMATCH", "Provider order identity does not match")
        }
        if (snapshot.orderCurrency != "INR" || snapshot.orderCurrency != payment.currency || snapshot.orderAmountPaise != payment.amountPaise) {
            throw DomainException("PAYMENT_PROVIDER_ORDER_AMOUNT_MISMATCH", "Provider order amount does not match")
        }
        if (snapshot.paymentCurrency != "INR" || snapshot.paymentCurrency != payment.currency) {
            throw DomainException("PAYMENT_PROVIDER_CURRENCY_MISMATCH", "Provider payment currency does not match")
        }
        if (snapshot.paymentAmountPaise != payment.amountPaise) {
            throw DomainException("PAYMENT_PROVIDER_AMOUNT_MISMATCH", "Provider payment amount does not match")
        }
    }

    private fun insertOrValidateAttempt(payment: Payment, snapshot: ProviderPaymentSnapshot, now: Instant) {
        val outcome = requireNotNull(snapshot.outcome)
        val existing = jdbc.query(
            "SELECT payment_id, outcome FROM mypet.payment_attempt WHERE provider = 'CASHFREE' AND provider_payment_id = ? FOR UPDATE",
            { row, _ -> row.getObject("payment_id", UUID::class.java) to row.getString("outcome") },
            snapshot.providerPaymentId,
        ).singleOrNull()
        if (existing != null) {
            if (existing.first != payment.id || existing.second != outcome.name) {
                throw DomainException("PAYMENT_ATTEMPT_CONFLICT", "Provider payment identity conflicts with stored truth")
            }
            return
        }
        jdbc.update(
            """
            INSERT INTO mypet.payment_attempt (
                id, payment_id, provider, provider_payment_id, outcome,
                payment_amount_paise, payment_currency, provider_payment_time,
                safe_error_code, safe_error_reason, created_at, updated_at
            ) VALUES (?, ?, 'CASHFREE', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            payment.id,
            snapshot.providerPaymentId.take(96),
            outcome.name,
            snapshot.paymentAmountPaise,
            snapshot.paymentCurrency,
            snapshot.providerPaymentTime?.jdbcTimestamp(),
            snapshot.safeErrorCode?.take(64),
            snapshot.safeErrorReason?.take(240),
            now.jdbcTimestamp(),
            now.jdbcTimestamp(),
        )
    }

    private fun webhookInbox(id: UUID): WebhookInboxItem? = jdbc.query(
        """
        SELECT id, provider, delivery_identity, webhook_version, event_type, provider_order_reference,
               provider_payment_id, attempt_status, order_amount_paise, order_currency,
               payment_amount_paise, payment_currency, provider_payment_time, provider_event_time,
               payload_sha256, safe_error_code, safe_error_reason, retry_count
        FROM mypet.payment_webhook_inbox
        WHERE id = ? AND processing_status = 'PROCESSING'
        """.trimIndent(),
        { row, _ ->
            WebhookInboxItem(
                id = row.getObject("id", UUID::class.java),
                event = PaymentWebhookEvent(
                    provider = PaymentProvider.valueOf(row.getString("provider")),
                    deliveryIdentity = row.getString("delivery_identity"),
                    webhookVersion = row.getString("webhook_version"),
                    eventType = row.getString("event_type"),
                    providerOrderReference = row.getString("provider_order_reference"),
                    providerPaymentId = row.getString("provider_payment_id"),
                    attemptOutcome = row.getString("attempt_status")?.let(PaymentAttemptOutcome::valueOf),
                    orderAmountPaise = row.getLong("order_amount_paise"),
                    orderCurrency = row.getString("order_currency"),
                    paymentAmountPaise = row.getObject("payment_amount_paise")?.let { row.getLong("payment_amount_paise") },
                    paymentCurrency = row.getString("payment_currency"),
                    providerPaymentTime = row.getTimestamp("provider_payment_time")?.toInstant(),
                    providerEventTime = row.getTimestamp("provider_event_time")?.toInstant(),
                    payloadSha256 = row.getString("payload_sha256"),
                    safeErrorCode = row.getString("safe_error_code"),
                    safeErrorReason = row.getString("safe_error_reason"),
                ),
                retryCount = row.getInt("retry_count"),
            )
        },
        id,
    ).singleOrNull()

    private fun ensureRefund(payment: Payment, now: Instant): PaymentRefund {
        lockRefundForPayment(payment.id)?.let { return it }
        val refundId = deterministicUuid("payment-refund:${payment.id}")
        val providerRefundId = "mpr_${payment.id.toString().replace("-", "")}"
        val providerIdempotencyKey = deterministicUuid("payment-refund-idempotency:${payment.id}").toString()
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment_refund (
                    id, payment_id, status, amount_paise, currency, provider_refund_id,
                    provider_idempotency_key, execution_state, reconciliation_required,
                    next_reconciliation_at, created_at, updated_at
                ) VALUES (?, ?, 'PENDING', ?, ?, ?, ?, 'PREPARED', TRUE, ?, ?, ?)
                """.trimIndent(),
                refundId,
                payment.id,
                payment.amountPaise,
                payment.currency,
                providerRefundId,
                providerIdempotencyKey,
                now.jdbcTimestamp(),
                now.jdbcTimestamp(),
                now.jdbcTimestamp(),
            )
            insertRefundHistory(refundId, null, RefundStatus.PENDING, "REFUND_REQUIRED", "refund-intent:${payment.id}", now)
        } catch (_: DuplicateKeyException) {
            // Another transaction may have created the unique intent first. The
            // owning ProductOrder lock ensures same-order callers serialize.
        }
        return lockRefundForPayment(payment.id) ?: throw DomainException("REFUND_CONFLICT", "Refund intent could not be recovered")
    }

    private fun lockRefundForPayment(paymentId: UUID): PaymentRefund? = jdbc.query(
        refundSelect("WHERE r.payment_id = ? FOR UPDATE"),
        { row, _ -> refund(row) },
        paymentId,
    ).singleOrNull()

    private fun lockRefund(refundId: UUID): PaymentRefund = jdbc.query(
        refundSelect("WHERE r.id = ? FOR UPDATE"),
        { row, _ -> refund(row) },
        refundId,
    ).singleOrNull() ?: refundNotFound()

    private fun requireRefund(refundId: UUID): PaymentRefund = jdbc.query(
        refundSelect("WHERE r.id = ?"),
        { row, _ -> refund(row) },
        refundId,
    ).singleOrNull() ?: refundNotFound()

    private fun refundSelect(suffix: String): String = """
        SELECT r.id, r.payment_id, p.provider_order_reference, r.status, r.amount_paise, r.currency,
               r.provider_refund_id, r.provider_idempotency_key, r.execution_state, r.reconciliation_required
        FROM mypet.payment_refund r
        JOIN mypet.payment p ON p.id = r.payment_id
        $suffix
    """.trimIndent()

    private fun refund(row: ResultSet): PaymentRefund = PaymentRefund(
        id = row.getObject("id", UUID::class.java),
        paymentId = row.getObject("payment_id", UUID::class.java),
        providerOrderReference = row.getString("provider_order_reference"),
        status = RefundStatus.valueOf(row.getString("status")),
        amountPaise = row.getLong("amount_paise"),
        currency = row.getString("currency"),
        providerRefundId = row.getString("provider_refund_id"),
        providerIdempotencyKey = row.getString("provider_idempotency_key"),
        executionState = RefundExecutionState.valueOf(row.getString("execution_state")),
        reconciliationRequired = row.getBoolean("reconciliation_required"),
    )

    private fun refundPointer(refundId: UUID): RefundPointer = jdbc.query(
        """
        SELECT r.payment_id, p.reference_id
        FROM mypet.payment_refund r
        JOIN mypet.payment p ON p.id = r.payment_id
        WHERE r.id = ?
        """.trimIndent(),
        { row, _ -> RefundPointer(row.getObject("payment_id", UUID::class.java), row.getObject("reference_id", UUID::class.java)) },
        refundId,
    ).singleOrNull() ?: refundNotFound()

    private fun validateRefundResult(refund: PaymentRefund, result: RefundProviderResult.Found) {
        val provider = result.refund
        if (provider.providerRefundId != refund.providerRefundId) {
            throw DomainException("REFUND_PROVIDER_ID_MISMATCH", "Provider refund identity does not match")
        }
        if (provider.amountPaise != refund.amountPaise || provider.currency != refund.currency || provider.currency != "INR") {
            throw DomainException("REFUND_PROVIDER_AMOUNT_MISMATCH", "Provider refund amount does not match")
        }
    }

    private fun releaseExpiredOrder(order: LockedOrder, now: Instant) {
        val lines = jdbc.query(
            "SELECT listing_id, quantity FROM mypet.product_order_line WHERE order_id = ? ORDER BY listing_id",
            { row, _ -> row.getObject("listing_id", UUID::class.java) to row.getInt("quantity") },
            order.id,
        )
        lines.forEach { (listingId, quantity) ->
            inventory.release(
                listingId,
                quantity,
                "order:${order.id}:release:$listingId:CANCELLED",
                InventoryService.SYSTEM_ACTOR_ID,
                "payment-expiry",
            )
        }
        jdbc.update(
            "UPDATE mypet.inventory_reservation SET status = 'RELEASED', updated_at = ? WHERE order_id = ? AND status = 'RESERVED'",
            now.jdbcTimestamp(),
            order.id,
        )
        jdbc.update(
            "UPDATE mypet.product_order SET status = 'CANCELLED', version = version + 1, updated_at = ? WHERE id = ? AND status = 'PLACED'",
            now.jdbcTimestamp(),
            order.id,
        )
        try {
            jdbc.update(
                """
                INSERT INTO mypet.product_order_history (
                    id, order_id, from_status, to_status, actor_id, actor_role, reason,
                    idempotency_key, trace_id, occurred_at
                ) VALUES (?, ?, 'PLACED', 'CANCELLED', ?, ?, 'ORDER_PAYMENT_EXPIRED', ?, 'payment-expiry', ?)
                """.trimIndent(),
                UUID.randomUUID(),
                order.id,
                InventoryService.SYSTEM_ACTOR_ID,
                Role.ADMIN.name,
                "payment-expiry-${order.id}",
                now.jdbcTimestamp(),
            )
        } catch (_: DuplicateKeyException) {
            // Deterministic order-history command makes retry harmless.
        }
    }

    private fun insertPaymentHistory(
        paymentId: UUID,
        from: PaymentStatus?,
        to: PaymentStatus,
        reason: String,
        source: String,
        now: Instant,
    ) {
        if (from == to) return
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment_history (
                    id, payment_id, from_status, to_status, reason_code, source_identity, occurred_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                UUID.randomUUID(),
                paymentId,
                from?.name,
                to.name,
                reason.take(64),
                source.take(160),
                now.jdbcTimestamp(),
            )
        } catch (_: DuplicateKeyException) {
            // Immutable history is idempotent by payment/source identity.
        }
    }

    private fun insertRefundHistory(
        refundId: UUID,
        from: RefundStatus?,
        to: RefundStatus,
        reason: String,
        source: String,
        now: Instant,
    ) {
        if (from == to) return
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment_refund_history (
                    id, refund_id, from_status, to_status, reason_code, source_identity, occurred_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                UUID.randomUUID(),
                refundId,
                from?.name,
                to.name,
                reason.take(64),
                source.take(160),
                now.jdbcTimestamp(),
            )
        } catch (_: DuplicateKeyException) {
            // Immutable history is idempotent by refund/source identity.
        }
    }

    private fun shouldCall(payment: Payment): Boolean =
        payment.providerSessionId == null && payment.commandState != ProviderCommandState.REJECTED &&
            payment.status != PaymentStatus.CAPTURED

    private fun mismatch(): Nothing = throw DomainException(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        "The idempotency key was already used for another request",
    )

    private fun notFound(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    private fun refundNotFound(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested refund is unavailable")

    private fun <T> transaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("Payment transaction returned no result")

    private fun deterministicUuid(value: String): UUID = UUID.nameUUIDFromBytes(value.toByteArray(StandardCharsets.UTF_8))

    private data class StoredCommand(val requestFingerprint: String, val paymentId: UUID)
    private data class PaymentPointer(val paymentId: UUID, val referenceId: UUID)
    private data class RefundPointer(val paymentId: UUID, val referenceId: UUID)
    private data class LockedOrder(
        val id: UUID,
        val status: String,
        val paymentMethod: String,
        val paymentStatus: String,
        val amountPaise: Long,
        val currency: String,
        val paymentHoldExpiresAt: Instant?,
    )
}

private fun Instant.jdbcTimestamp(): Timestamp = Timestamp.from(this)
