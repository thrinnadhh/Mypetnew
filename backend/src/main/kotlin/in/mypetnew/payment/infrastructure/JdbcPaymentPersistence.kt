package `in`.mypetnew.payment.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.InMemoryPaymentPersistence
import `in`.mypetnew.payment.domain.Payment
import `in`.mypetnew.payment.domain.PaymentPersistence
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentReferenceType
import `in`.mypetnew.payment.domain.PaymentStatus
import `in`.mypetnew.payment.domain.PreparePaymentResult
import `in`.mypetnew.payment.domain.ProviderCommandState
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID

class JdbcPaymentPersistence(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
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
        commandPayment(customerId, idempotencyKey)?.let { existing ->
            if (existing.second != requestFingerprint) mismatch()
            return@transaction PreparePaymentResult(existing.first, shouldCall(existing.first))
        }
        validatePayable(order, now)
        lockPayment(referenceType, referenceId, provider)?.let { existing ->
            return@transaction PreparePaymentResult(existing, shouldCall(existing))
        }

        val paymentId = UUID.randomUUID()
        val providerOrderReference = InMemoryPaymentPersistence.providerOrderReference(paymentId)
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment (
                    id, reference_type, reference_id, customer_id, provider, status,
                    amount_paise, currency, provider_order_reference, provider_idempotency_key,
                    initiation_idempotency_key, initiation_request_fingerprint,
                    provider_command_state, expires_at
                ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, 'INR', ?, ?, ?, ?, 'PREPARED', ?)
                """.trimIndent(),
                paymentId,
                referenceType.name,
                referenceId,
                customerId,
                provider.name,
                order.amountPaise,
                providerOrderReference,
                paymentId.toString(),
                idempotencyKey,
                requestFingerprint,
                order.expiresAt,
            )
            jdbc.update(
                """
                INSERT INTO mypet.payment_history (
                    id, payment_id, from_status, to_status, reason_code, source_identity, occurred_at
                ) VALUES (?, ?, NULL, 'PENDING', 'PAYMENT_INITIATED', ?, ?)
                """.trimIndent(),
                UUID.randomUUID(),
                paymentId,
                "initiate:$idempotencyKey",
                now,
            )
        } catch (_: DuplicateKeyException) {
            lockPayment(referenceType, referenceId, provider)?.let { existing ->
                return@transaction PreparePaymentResult(existing, shouldCall(existing))
            }
            commandPayment(customerId, idempotencyKey)?.let { existing ->
                if (existing.second != requestFingerprint) mismatch()
                return@transaction PreparePaymentResult(existing.first, shouldCall(existing.first))
            }
            throw DomainException("PAYMENT_CONFLICT", "Payment initiation raced; retry safely")
        }
        PreparePaymentResult(requirePayment(paymentId), true)
    }

    override fun completeProviderOrder(
        paymentId: UUID,
        result: CreateProviderOrderResult,
        now: Instant,
    ): Payment = transaction {
        val referenceId = jdbc.query(
            "SELECT reference_id FROM mypet.payment WHERE id = ?",
            { row, _ -> row.getObject("reference_id", UUID::class.java) },
            paymentId,
        ).singleOrNull() ?: notFound()
        lockOrder(referenceId)
        val payment = lockPaymentById(paymentId)
        when (result) {
            is CreateProviderOrderResult.Created -> jdbc.update(
                """
                UPDATE mypet.payment
                SET provider_session_id = ?, provider_command_state = 'CREATED',
                    reconciliation_required = FALSE, last_provider_error_code = NULL,
                    version = version + 1, updated_at = ?
                WHERE id = ? AND provider_session_id IS NULL AND status = 'PENDING'
                """.trimIndent(),
                result.paymentSessionId,
                now,
                paymentId,
            )
            is CreateProviderOrderResult.Rejected -> {
                jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET status = 'FAILED', provider_command_state = 'REJECTED',
                        last_provider_error_code = ?, reconciliation_required = FALSE,
                        version = version + 1, updated_at = ?
                    WHERE id = ? AND status <> 'CAPTURED'
                    """.trimIndent(),
                    result.safeErrorCode.take(64),
                    now,
                    paymentId,
                )
                insertHistory(paymentId, payment.status, PaymentStatus.FAILED, "PROVIDER_ORDER_REJECTED", "create-order", now)
            }
            CreateProviderOrderResult.Unknown -> jdbc.update(
                """
                UPDATE mypet.payment
                SET provider_command_state = 'UNKNOWN', reconciliation_required = TRUE,
                    next_reconciliation_at = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND provider_session_id IS NULL AND status <> 'CAPTURED'
                """.trimIndent(),
                now,
                now,
                paymentId,
            )
        }
        requirePayment(paymentId)
    }

    override fun getOwned(paymentId: UUID, customerId: UUID): Payment = jdbc.query(
        """
        SELECT id, reference_type, reference_id, customer_id, provider, status, amount_paise, currency,
               provider_order_reference, provider_session_id, provider_idempotency_key,
               provider_command_state, expires_at, reconciliation_required
        FROM mypet.payment
        WHERE id = ? AND customer_id = ?
        """.trimIndent(),
        { row, _ -> payment(row) },
        paymentId,
        customerId,
    ).singleOrNull() ?: notFound()

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

    private fun lockOrder(referenceId: UUID) {
        val found = jdbc.query(
            "SELECT id FROM mypet.product_order WHERE id = ? FOR UPDATE",
            { row, _ -> row.getObject("id", UUID::class.java) },
            referenceId,
        ).singleOrNull()
        if (found == null) notFound()
    }

    private fun commandPayment(customerId: UUID, key: String): Pair<Payment, String>? = jdbc.query(
        """
        SELECT id, reference_type, reference_id, customer_id, provider, status, amount_paise, currency,
               provider_order_reference, provider_session_id, provider_idempotency_key,
               provider_command_state, expires_at, reconciliation_required, initiation_request_fingerprint
        FROM mypet.payment
        WHERE customer_id = ? AND initiation_idempotency_key = ?
        FOR UPDATE
        """.trimIndent(),
        { row, _ -> payment(row) to row.getString("initiation_request_fingerprint") },
        customerId,
        key,
    ).singleOrNull()

    private fun lockPayment(
        referenceType: PaymentReferenceType,
        referenceId: UUID,
        provider: PaymentProvider,
    ): Payment? = jdbc.query(
        """
        SELECT id, reference_type, reference_id, customer_id, provider, status, amount_paise, currency,
               provider_order_reference, provider_session_id, provider_idempotency_key,
               provider_command_state, expires_at, reconciliation_required
        FROM mypet.payment
        WHERE reference_type = ? AND reference_id = ? AND provider = ?
        FOR UPDATE
        """.trimIndent(),
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

    private fun paymentSelect(suffix: String): String = """
        SELECT id, reference_type, reference_id, customer_id, provider, status, amount_paise, currency,
               provider_order_reference, provider_session_id, provider_idempotency_key,
               provider_command_state, expires_at, reconciliation_required
        FROM mypet.payment
        $suffix
    """.trimIndent()

    private fun payment(row: ResultSet): Payment = Payment(
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
    )

    private fun lockedOrder(row: ResultSet): LockedOrder = LockedOrder(
        status = row.getString("status"),
        paymentMethod = row.getString("payment_method"),
        paymentStatus = row.getString("payment_status"),
        amountPaise = row.getLong("grand_total_paise"),
        currency = row.getString("currency"),
        expiresAt = row.getTimestamp("payment_hold_expires_at")?.toInstant(),
    )

    private fun validatePayable(order: LockedOrder, now: Instant) {
        if (order.paymentMethod != "ONLINE_PAYMENT" || order.status != "PLACED" || order.paymentStatus != "PENDING_ONLINE_PAYMENT") {
            throw DomainException("ORDER_NOT_PAYABLE", "The order is not payable online")
        }
        if (order.currency != "INR") {
            throw DomainException("PAYMENT_CURRENCY_INVALID", "The order currency is unsupported")
        }
        if (order.amountPaise < 0) {
            throw DomainException("PAYMENT_AMOUNT_INVALID", "The order amount is invalid")
        }
        if (order.expiresAt == null || !now.isBefore(order.expiresAt)) {
            throw DomainException("ORDER_PAYMENT_EXPIRED", "The online payment hold expired")
        }
    }

    private fun insertHistory(
        paymentId: UUID,
        from: PaymentStatus,
        to: PaymentStatus,
        reason: String,
        source: String,
        now: Instant,
    ) {
        if (from == to) return
        runCatching {
            jdbc.update(
                """
                INSERT INTO mypet.payment_history (
                    id, payment_id, from_status, to_status, reason_code, source_identity, occurred_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                UUID.randomUUID(), paymentId, from.name, to.name, reason, source, now,
            )
        }.getOrElse { error ->
            if (error !is DuplicateKeyException) throw error
        }
    }

    private fun shouldCall(payment: Payment): Boolean =
        payment.providerSessionId == null && payment.commandState != ProviderCommandState.REJECTED

    private fun mismatch(): Nothing = throw DomainException(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        "The idempotency key was already used for another request",
    )

    private fun notFound(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    private fun <T> transaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("Payment transaction returned no result")

    private data class LockedOrder(
        val status: String,
        val paymentMethod: String,
        val paymentStatus: String,
        val amountPaise: Long,
        val currency: String,
        val expiresAt: Instant?,
    )
}
