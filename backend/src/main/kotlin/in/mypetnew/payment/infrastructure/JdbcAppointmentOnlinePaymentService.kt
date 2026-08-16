package `in`.mypetnew.payment.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.payment.domain.CreateProviderOrderCommand
import `in`.mypetnew.payment.domain.CreateProviderOrderResult
import `in`.mypetnew.payment.domain.CreateRefundCommand
import `in`.mypetnew.payment.domain.Payment
import `in`.mypetnew.payment.domain.PaymentAttemptOutcome
import `in`.mypetnew.payment.domain.PaymentGateway
import `in`.mypetnew.payment.domain.PaymentProvider
import `in`.mypetnew.payment.domain.PaymentReferenceType
import `in`.mypetnew.payment.domain.PaymentStatus
import `in`.mypetnew.payment.domain.PaymentWebhookEvent
import `in`.mypetnew.payment.domain.ProviderCommandState
import `in`.mypetnew.payment.domain.ProviderCustomer
import `in`.mypetnew.payment.domain.ProviderPaymentSnapshot
import `in`.mypetnew.payment.domain.ProviderPaymentsResult
import `in`.mypetnew.payment.domain.RefundExecutionState
import `in`.mypetnew.payment.domain.RefundProviderResult
import `in`.mypetnew.payment.domain.RefundStatus
import `in`.mypetnew.payment.domain.TerminalAppointmentPaymentProjection
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * Cashfree lifecycle for ONLINE_PAYMENT appointments.
 *
 * Product payments remain owned by JdbcPaymentPersistence. Appointment payments
 * share the canonical mypet.payment identity/history tables, but use an `ma_`
 * provider-order namespace and a dedicated appointment refund table. That keeps
 * product order lock ordering and refund workers isolated from appointment IDs.
 */
class JdbcAppointmentOnlinePaymentService(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
    private val gateway: PaymentGateway,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun initiate(customerId: UUID, appointmentId: UUID, providerValue: String, idempotencyKey: String): Payment {
        validateIdempotencyKey(idempotencyKey)
        if (providerValue != PaymentProvider.CASHFREE.name) unsupportedProvider()
        if (!gateway.available) providerUnavailable()
        val now = clock.instant()
        val fingerprint = sha256("APPOINTMENT:$appointmentId:CASHFREE")
        val prepared = transaction { prepare(customerId, appointmentId, idempotencyKey, fingerprint, now) }
        if (!prepared.callProvider) return prepared.payment

        val payment = prepared.payment
        val providerResult = runCatching {
            gateway.createOrder(
                CreateProviderOrderCommand(
                    paymentId = payment.id,
                    providerOrderReference = payment.providerOrderReference,
                    providerIdempotencyKey = payment.providerIdempotencyKey,
                    amountPaise = payment.amountPaise,
                    currency = payment.currency,
                    expiresAt = payment.expiresAt,
                    customer = prepared.customer,
                ),
            )
        }.getOrElse { CreateProviderOrderResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
        return transaction { completeProviderOrder(payment.id, providerResult, clock.instant()) }
    }

    fun getOwnedOrNull(paymentId: UUID, customerId: UUID): Payment? = payment(
        """
        WHERE p.id = ? AND p.customer_id = ? AND p.reference_type = 'APPOINTMENT'
        """.trimIndent(),
        paymentId,
        customerId,
    )

    fun ownsPayment(paymentId: UUID): Boolean = jdbc.queryForObject(
        "SELECT COUNT(*) FROM mypet.payment WHERE id = ? AND reference_type = 'APPOINTMENT'",
        Int::class.java,
        paymentId,
    ) == 1

    fun isAppointmentProviderOrder(reference: String): Boolean = reference.startsWith(APPOINTMENT_PROVIDER_PREFIX)

    /**
     * Verified webhook events are durably recorded and projected in one DB
     * transaction. Duplicate deliveries are acknowledged idempotently.
     */
    fun ingestWebhook(event: PaymentWebhookEvent): Boolean {
        if (!isAppointmentProviderOrder(event.providerOrderReference)) return false
        return transaction {
            val existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM mypet.payment_webhook_inbox WHERE provider = ? AND delivery_identity = ?",
                Int::class.java,
                event.provider.name,
                event.deliveryIdentity,
            ) ?: 0
            if (existing > 0) return@transaction false

            val inboxId = UUID.randomUUID()
            try {
                jdbc.update(
                    """
                    INSERT INTO mypet.payment_webhook_inbox(
                        id, provider, delivery_identity, webhook_version, event_type,
                        provider_order_reference, provider_payment_id, attempt_status,
                        order_amount_paise, order_currency, payment_amount_paise,
                        payment_currency, provider_payment_time, provider_event_time,
                        payload_sha256, safe_error_code, safe_error_reason,
                        processing_status, retry_count, next_attempt_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                              'RECEIVED', 0, ?, ?, ?)
                    """.trimIndent(),
                    inboxId,
                    event.provider.name,
                    event.deliveryIdentity,
                    event.webhookVersion,
                    event.eventType.take(96),
                    event.providerOrderReference,
                    event.providerPaymentId,
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
                    clock.instant().jdbcTimestamp(),
                    clock.instant().jdbcTimestamp(),
                    clock.instant().jdbcTimestamp(),
                )
            } catch (_: DuplicateKeyException) {
                return@transaction false
            }

            val providerPaymentId = event.providerPaymentId
            val paymentAmount = event.paymentAmountPaise
            val paymentCurrency = event.paymentCurrency
            if (providerPaymentId != null && paymentAmount != null && paymentCurrency != null) {
                applyProviderSnapshot(
                    ProviderPaymentSnapshot(
                        providerOrderReference = event.providerOrderReference,
                        providerPaymentId = providerPaymentId,
                        outcome = event.attemptOutcome,
                        orderAmountPaise = event.orderAmountPaise,
                        orderCurrency = event.orderCurrency,
                        paymentAmountPaise = paymentAmount,
                        paymentCurrency = paymentCurrency,
                        providerPaymentTime = event.providerPaymentTime,
                        safeErrorCode = event.safeErrorCode,
                        safeErrorReason = event.safeErrorReason,
                    ),
                    "webhook:${event.deliveryIdentity}",
                    clock.instant(),
                )
            }
            jdbc.update(
                """
                UPDATE mypet.payment_webhook_inbox
                SET processing_status = 'PROCESSED', processed_at = ?, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                clock.instant().jdbcTimestamp(),
                clock.instant().jdbcTimestamp(),
                inboxId,
            )
            true
        }
    }

    fun reconcilePaymentBatch(limit: Int = 25): Int {
        val candidates = jdbc.query(
            """
            SELECT id, reference_type, reference_id, customer_id, provider, status,
                   amount_paise, currency, provider_order_reference, provider_session_id,
                   provider_idempotency_key, provider_command_state, expires_at,
                   reconciliation_required
            FROM mypet.payment
            WHERE reference_type = 'APPOINTMENT'
              AND status IN ('PENDING','AUTHORIZED')
            ORDER BY updated_at, id
            LIMIT ?
            """.trimIndent(),
            { row, _ -> mapPayment(row) },
            limit.coerceIn(1, 100),
        )
        candidates.forEach { candidate ->
            when (val result = runCatching { gateway.paymentsForOrder(candidate.providerOrderReference) }
                .getOrElse { ProviderPaymentsResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }) {
                is ProviderPaymentsResult.Found -> result.attempts.forEach { snapshot ->
                    runCatching {
                        transaction {
                            applyProviderSnapshot(
                                snapshot,
                                "appointment-reconcile:${candidate.id}:${snapshot.providerPaymentId}",
                                clock.instant(),
                            )
                        }
                    }
                }
                is ProviderPaymentsResult.Unknown -> Unit
            }
        }
        return candidates.size
    }

    fun expirePendingBatch(limit: Int = 50): Int {
        val ids = jdbc.query(
            """
            SELECT id FROM mypet.payment
            WHERE reference_type = 'APPOINTMENT'
              AND status IN ('PENDING','AUTHORIZED')
              AND expires_at <= ?
            ORDER BY expires_at, id
            LIMIT ?
            """.trimIndent(),
            { row, _ -> row.getObject("id", UUID::class.java) },
            clock.instant().jdbcTimestamp(),
            limit.coerceIn(1, 200),
        )
        ids.forEach { id -> runCatching { transaction { expirePayment(id, clock.instant()) } } }
        return ids.size
    }

    fun reconcileTerminalRefunds(limit: Int = 50): Int {
        val appointmentIds = jdbc.query(
            """
            SELECT a.id
            FROM mypet.appointment a
            JOIN mypet.payment p ON p.reference_type = 'APPOINTMENT' AND p.reference_id = a.id
            LEFT JOIN mypet.appointment_payment_refund r ON r.payment_id = p.id
            WHERE p.status = 'CAPTURED'
              AND a.status IN ('REJECTED','CANCELLED','HOLD_EXPIRED')
              AND r.id IS NULL
            ORDER BY a.updated_at, a.id
            LIMIT ?
            """.trimIndent(),
            { row, _ -> row.getObject("id", UUID::class.java) },
            limit.coerceIn(1, 200),
        )
        appointmentIds.forEach { id ->
            runCatching { projectTerminalAppointment(id, "TERMINAL_REPAIR", clock.instant()) }
        }
        return appointmentIds.size
    }

    fun projectTerminalAppointment(appointmentId: UUID, reason: String?, now: Instant): String? = transaction {
        lockAppointment(appointmentId) ?: return@transaction null
        val payment = lockPaymentForAppointment(appointmentId) ?: return@transaction null
        when (payment.status) {
            PaymentStatus.CAPTURED -> {
                ensureRefund(payment, appointmentId, now)
                jdbc.update(
                    "UPDATE mypet.appointment SET payment_state = 'REFUND_PENDING', updated_at = ? WHERE id = ?",
                    now.jdbcTimestamp(),
                    appointmentId,
                )
                "REFUND_PENDING"
            }
            PaymentStatus.PENDING, PaymentStatus.AUTHORIZED -> {
                jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET status = 'EXPIRED', version = version + 1, updated_at = ?
                    WHERE id = ? AND status IN ('PENDING','AUTHORIZED')
                    """.trimIndent(),
                    now.jdbcTimestamp(),
                    payment.id,
                )
                insertPaymentHistory(payment.id, payment.status, PaymentStatus.EXPIRED, reason ?: "APPOINTMENT_TERMINATED", now)
                jdbc.update(
                    "UPDATE mypet.appointment SET payment_state = 'EXPIRED', updated_at = ? WHERE id = ?",
                    now.jdbcTimestamp(),
                    appointmentId,
                )
                null
            }
            PaymentStatus.FAILED, PaymentStatus.EXPIRED -> null
        }
    }

    fun processRefundBatch(limit: Int = 25): Int {
        val refunds = jdbc.query(
            """
            SELECT r.id, r.payment_id, r.appointment_id, r.status, r.amount_paise,
                   r.currency, r.provider_refund_id, r.provider_idempotency_key,
                   r.execution_state, p.provider_order_reference
            FROM mypet.appointment_payment_refund r
            JOIN mypet.payment p ON p.id = r.payment_id
            WHERE r.status = 'PENDING' AND r.next_attempt_at <= ?
            ORDER BY r.next_attempt_at, r.created_at, r.id
            LIMIT ?
            """.trimIndent(),
            { row, _ -> mapRefund(row) },
            clock.instant().jdbcTimestamp(),
            limit.coerceIn(1, 100),
        )
        refunds.forEach { refund ->
            val result = if (refund.executionState == RefundExecutionState.PREPARED) {
                runCatching {
                    gateway.createRefund(
                        CreateRefundCommand(
                            refundId = refund.id,
                            providerOrderReference = refund.providerOrderReference,
                            providerRefundId = refund.providerRefundId,
                            providerIdempotencyKey = refund.providerIdempotencyKey,
                            amountPaise = refund.amountPaise,
                            currency = refund.currency,
                        ),
                    )
                }.getOrElse { RefundProviderResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
            } else {
                runCatching { gateway.getRefund(refund.providerOrderReference, refund.providerRefundId) }
                    .getOrElse { RefundProviderResult.Unknown("PROVIDER_TRANSPORT_UNKNOWN") }
            }
            transaction { completeRefund(refund, result, clock.instant()) }
        }
        return refunds.size
    }

    private fun prepare(
        customerId: UUID,
        appointmentId: UUID,
        idempotencyKey: String,
        fingerprint: String,
        now: Instant,
    ): Prepared {
        command(customerId, idempotencyKey)?.let { command ->
            if (command.fingerprint != fingerprint) idempotencyMismatch()
            val existing = paymentById(command.paymentId) ?: notFound()
            return Prepared(existing, shouldCallProvider(existing), providerCustomer(customerId))
        }

        val appointment = lockOwnedAppointment(appointmentId, customerId) ?: notFound()
        validatePayableAppointment(appointment, now)
        lockPaymentForAppointment(appointmentId)?.let { existing ->
            bindCommand(customerId, idempotencyKey, fingerprint, existing.id, now)
            return Prepared(existing, shouldCallProvider(existing), providerCustomer(customerId))
        }

        val paymentId = UUID.randomUUID()
        val providerOrderReference = APPOINTMENT_PROVIDER_PREFIX + paymentId.toString().replace("-", "")
        val providerIdempotencyKey = deterministicUuid("appointment-payment-provider:$paymentId").toString()
        jdbc.update(
            """
            INSERT INTO mypet.payment(
                id, reference_type, reference_id, customer_id, provider, status,
                amount_paise, currency, provider_order_reference, provider_session_id,
                provider_idempotency_key, provider_command_state, expires_at,
                reconciliation_required, next_reconciliation_at, created_at, updated_at
            ) VALUES (?, 'APPOINTMENT', ?, ?, 'CASHFREE', 'PENDING', ?, 'INR', ?, NULL,
                      ?, 'PREPARED', ?, FALSE, ?, ?, ?)
            """.trimIndent(),
            paymentId,
            appointmentId,
            customerId,
            appointment.pricePaise,
            providerOrderReference,
            providerIdempotencyKey,
            appointment.holdExpiresAt!!.jdbcTimestamp(),
            now.jdbcTimestamp(),
            now.jdbcTimestamp(),
            now.jdbcTimestamp(),
        )
        bindCommand(customerId, idempotencyKey, fingerprint, paymentId, now)
        insertPaymentHistory(paymentId, null, PaymentStatus.PENDING, "PAYMENT_CREATED", now)
        return Prepared(requireNotNull(paymentById(paymentId)), true, providerCustomer(customerId))
    }

    private fun completeProviderOrder(paymentId: UUID, result: CreateProviderOrderResult, now: Instant): Payment {
        val payment = lockPaymentById(paymentId)
        if (payment.referenceType != PaymentReferenceType.APPOINTMENT) notFound()
        lockAppointment(payment.referenceId) ?: notFound()
        when (result) {
            is CreateProviderOrderResult.Created -> jdbc.update(
                """
                UPDATE mypet.payment
                SET provider_session_id = ?, provider_command_state = 'CREATED', updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                result.paymentSessionId,
                now.jdbcTimestamp(),
                paymentId,
            )
            is CreateProviderOrderResult.Unknown -> jdbc.update(
                "UPDATE mypet.payment SET provider_command_state = 'UNKNOWN', updated_at = ? WHERE id = ?",
                now.jdbcTimestamp(),
                paymentId,
            )
            is CreateProviderOrderResult.Rejected -> {
                jdbc.update(
                    """
                    UPDATE mypet.payment
                    SET provider_command_state = 'REJECTED', status = 'FAILED', updated_at = ?
                    WHERE id = ?
                    """.trimIndent(),
                    now.jdbcTimestamp(),
                    paymentId,
                )
                insertPaymentHistory(paymentId, payment.status, PaymentStatus.FAILED, result.safeErrorCode, now)
                jdbc.update(
                    """
                    UPDATE mypet.appointment
                    SET status = CASE WHEN status = 'HOLD' THEN 'HOLD_EXPIRED' ELSE status END,
                        payment_state = 'FAILED', hold_expires_at = NULL, updated_at = ?
                    WHERE id = ?
                    """.trimIndent(),
                    now.jdbcTimestamp(),
                    payment.referenceId,
                )
                appendAppointmentHistory(payment.referenceId, "HOLD_EXPIRED", payment.customerId, "ONLINE_PAYMENT_CREATE_REJECTED", now)
            }
        }
        return paymentById(paymentId) ?: notFound()
    }

    private fun applyProviderSnapshot(snapshot: ProviderPaymentSnapshot, source: String, now: Instant): Payment {
        val payment = lockPaymentByProviderOrder(snapshot.providerOrderReference)
        if (payment.referenceType != PaymentReferenceType.APPOINTMENT) notFound()
        validateProviderSnapshot(payment, snapshot)
        if (snapshot.outcome != null) insertOrValidateAttempt(payment, snapshot, now)
        if (snapshot.outcome != PaymentAttemptOutcome.SUCCESS) return paymentById(payment.id) ?: payment
        if (payment.status == PaymentStatus.CAPTURED) return paymentById(payment.id) ?: payment

        val appointment = lockAppointment(payment.referenceId) ?: notFound()
        jdbc.update(
            "UPDATE mypet.payment SET status = 'CAPTURED', updated_at = ?, version = version + 1 WHERE id = ?",
            now.jdbcTimestamp(),
            payment.id,
        )
        insertPaymentHistory(payment.id, payment.status, PaymentStatus.CAPTURED, "PROVIDER_CAPTURED", now)

        val payableHold = appointment.status == "HOLD" &&
            appointment.paymentMode == "ONLINE_PAYMENT" &&
            appointment.paymentState == "PENDING" &&
            appointment.holdExpiresAt?.isAfter(now) == true
        if (payableHold) {
            jdbc.update(
                """
                UPDATE mypet.appointment
                SET status = 'BOOKED', payment_state = 'PAID', hold_expires_at = NULL, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                now.jdbcTimestamp(),
                appointment.id,
            )
            appendAppointmentHistory(appointment.id, "BOOKED", payment.customerId, "ONLINE_PAYMENT_CAPTURED_PENDING_PROVIDER", now)
        } else {
            ensureRefund(paymentById(payment.id) ?: payment.copy(status = PaymentStatus.CAPTURED), appointment.id, now)
            jdbc.update(
                """
                UPDATE mypet.appointment
                SET status = CASE WHEN status = 'HOLD' THEN 'HOLD_EXPIRED' ELSE status END,
                    payment_state = 'REFUND_PENDING', hold_expires_at = NULL, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                now.jdbcTimestamp(),
                appointment.id,
            )
            if (appointment.status == "HOLD") {
                appendAppointmentHistory(appointment.id, "HOLD_EXPIRED", payment.customerId, "LATE_PAYMENT_REFUND_PENDING", now)
            }
        }
        return paymentById(payment.id) ?: notFound()
    }

    private fun expirePayment(paymentId: UUID, now: Instant) {
        val payment = lockPaymentById(paymentId)
        if (payment.referenceType != PaymentReferenceType.APPOINTMENT || payment.status !in setOf(PaymentStatus.PENDING, PaymentStatus.AUTHORIZED)) return
        val appointment = lockAppointment(payment.referenceId) ?: return
        jdbc.update(
            "UPDATE mypet.payment SET status = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ?",
            now.jdbcTimestamp(),
            payment.id,
        )
        insertPaymentHistory(payment.id, payment.status, PaymentStatus.EXPIRED, "APPOINTMENT_PAYMENT_EXPIRED", now)
        if (appointment.status == "HOLD") {
            jdbc.update(
                """
                UPDATE mypet.appointment
                SET status = 'HOLD_EXPIRED', payment_state = 'EXPIRED', hold_expires_at = NULL, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                now.jdbcTimestamp(),
                appointment.id,
            )
            appendAppointmentHistory(appointment.id, "HOLD_EXPIRED", payment.customerId, "ONLINE_PAYMENT_EXPIRED", now)
        }
    }

    private fun ensureRefund(payment: Payment, appointmentId: UUID, now: Instant): AppointmentRefund {
        refundForPayment(payment.id)?.let { return it }
        val refundId = deterministicUuid("appointment-payment-refund:${payment.id}")
        val providerRefundId = "mar_${payment.id.toString().replace("-", "")}"
        val providerIdempotencyKey = deterministicUuid("appointment-refund-provider:${payment.id}").toString()
        try {
            jdbc.update(
                """
                INSERT INTO mypet.appointment_payment_refund(
                    id, payment_id, appointment_id, status, amount_paise, currency,
                    provider_refund_id, provider_idempotency_key, execution_state,
                    next_attempt_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, 'PREPARED', ?, ?, ?)
                """.trimIndent(),
                refundId,
                payment.id,
                appointmentId,
                payment.amountPaise,
                payment.currency,
                providerRefundId,
                providerIdempotencyKey,
                now.jdbcTimestamp(),
                now.jdbcTimestamp(),
                now.jdbcTimestamp(),
            )
        } catch (_: DuplicateKeyException) {
        }
        return refundForPayment(payment.id) ?: throw DomainException("REFUND_CONFLICT", "Appointment refund could not be recovered")
    }

    private fun completeRefund(refund: AppointmentRefund, result: RefundProviderResult, now: Instant) {
        lockAppointment(refund.appointmentId) ?: notFound()
        when (result) {
            is RefundProviderResult.Found -> {
                if (
                    result.refund.providerRefundId != refund.providerRefundId ||
                    result.refund.amountPaise != refund.amountPaise ||
                    result.refund.currency != refund.currency
                ) {
                    throw DomainException("REFUND_PROVIDER_MISMATCH", "Provider refund does not match the appointment refund")
                }
                when (result.refund.status) {
                    RefundStatus.SUCCESS -> {
                        jdbc.update(
                            """
                            UPDATE mypet.appointment_payment_refund
                            SET status = 'SUCCESS', execution_state = 'TERMINAL',
                                safe_error_code = NULL, updated_at = ? WHERE id = ?
                            """.trimIndent(),
                            now.jdbcTimestamp(),
                            refund.id,
                        )
                        jdbc.update(
                            "UPDATE mypet.appointment SET payment_state = 'REFUNDED', updated_at = ? WHERE id = ?",
                            now.jdbcTimestamp(),
                            refund.appointmentId,
                        )
                    }
                    RefundStatus.FAILED -> {
                        jdbc.update(
                            """
                            UPDATE mypet.appointment_payment_refund
                            SET status = 'FAILED', execution_state = 'TERMINAL', updated_at = ? WHERE id = ?
                            """.trimIndent(),
                            now.jdbcTimestamp(),
                            refund.id,
                        )
                        jdbc.update(
                            "UPDATE mypet.appointment SET payment_state = 'REFUND_FAILED', updated_at = ? WHERE id = ?",
                            now.jdbcTimestamp(),
                            refund.appointmentId,
                        )
                    }
                    RefundStatus.PENDING -> jdbc.update(
                        """
                        UPDATE mypet.appointment_payment_refund
                        SET execution_state = 'SUBMITTED', attempt_count = attempt_count + 1,
                            next_attempt_at = ?, updated_at = ? WHERE id = ?
                        """.trimIndent(),
                        now.plusSeconds(30).jdbcTimestamp(),
                        now.jdbcTimestamp(),
                        refund.id,
                    )
                }
            }
            RefundProviderResult.NotFound, is RefundProviderResult.Unknown -> jdbc.update(
                """
                UPDATE mypet.appointment_payment_refund
                SET execution_state = 'UNKNOWN', attempt_count = attempt_count + 1,
                    next_attempt_at = ?, safe_error_code = ?, updated_at = ? WHERE id = ?
                """.trimIndent(),
                now.plusSeconds(30).jdbcTimestamp(),
                if (result is RefundProviderResult.Unknown) result.safeErrorCode.take(64) else "REFUND_NOT_FOUND",
                now.jdbcTimestamp(),
                refund.id,
            )
        }
    }

    private fun lockOwnedAppointment(appointmentId: UUID, customerId: UUID): LockedAppointment? = jdbc.query(
        """
        SELECT id, customer_id, status, payment_mode, payment_state, price_paise,
               currency, hold_expires_at
        FROM mypet.appointment
        WHERE id = ? AND customer_id = ?
        FOR UPDATE
        """.trimIndent(),
        { row, _ -> lockedAppointment(row) },
        appointmentId,
        customerId,
    ).singleOrNull()

    private fun lockAppointment(appointmentId: UUID): LockedAppointment? = jdbc.query(
        """
        SELECT id, customer_id, status, payment_mode, payment_state, price_paise,
               currency, hold_expires_at
        FROM mypet.appointment
        WHERE id = ?
        FOR UPDATE
        """.trimIndent(),
        { row, _ -> lockedAppointment(row) },
        appointmentId,
    ).singleOrNull()

    private fun validatePayableAppointment(appointment: LockedAppointment, now: Instant) {
        if (
            appointment.status != "HOLD" ||
            appointment.paymentMode != "ONLINE_PAYMENT" ||
            appointment.paymentState != "PENDING"
        ) {
            throw DomainException("APPOINTMENT_NOT_PAYABLE", "The appointment is not payable online")
        }
        if (appointment.currency != "INR" || appointment.pricePaise < 0) {
            throw DomainException("PAYMENT_AMOUNT_INVALID", "The appointment price is invalid")
        }
        if (appointment.holdExpiresAt == null || !appointment.holdExpiresAt.isAfter(now)) {
            throw DomainException("APPOINTMENT_HOLD_EXPIRED", "The appointment payment hold expired")
        }
    }

    private fun providerCustomer(customerId: UUID): ProviderCustomer {
        val mobile = jdbc.query(
            "SELECT mobile_e164 FROM mypet.identity_account WHERE id = ? AND status = 'ACTIVE'",
            { row, _ -> row.getString("mobile_e164") },
            customerId,
        ).singleOrNull() ?: notFound()
        return ProviderCustomer("mypet_${customerId.toString().replace("-", "")}", mobile)
    }

    private fun paymentById(paymentId: UUID): Payment? = payment("WHERE p.id = ?", paymentId)

    private fun lockPaymentById(paymentId: UUID): Payment = jdbc.query(
        paymentSelect("WHERE p.id = ? FOR UPDATE"),
        { row, _ -> mapPayment(row) },
        paymentId,
    ).singleOrNull() ?: notFound()

    private fun lockPaymentForAppointment(appointmentId: UUID): Payment? = jdbc.query(
        paymentSelect("WHERE p.reference_type = 'APPOINTMENT' AND p.reference_id = ? AND p.provider = 'CASHFREE' FOR UPDATE"),
        { row, _ -> mapPayment(row) },
        appointmentId,
    ).singleOrNull()

    private fun lockPaymentByProviderOrder(providerOrderReference: String): Payment = jdbc.query(
        paymentSelect("WHERE p.reference_type = 'APPOINTMENT' AND p.provider_order_reference = ? FOR UPDATE"),
        { row, _ -> mapPayment(row) },
        providerOrderReference,
    ).singleOrNull() ?: notFound()

    private fun payment(suffix: String, vararg args: Any): Payment? = jdbc.query(
        paymentSelect(suffix),
        { row, _ -> mapPayment(row) },
        *args,
    ).singleOrNull()

    private fun paymentSelect(suffix: String): String = """
        SELECT p.id, p.reference_type, p.reference_id, p.customer_id, p.provider,
               p.status, p.amount_paise, p.currency, p.provider_order_reference,
               p.provider_session_id, p.provider_idempotency_key,
               p.provider_command_state, p.expires_at, p.reconciliation_required,
               r.status AS appointment_refund_status
        FROM mypet.payment p
        LEFT JOIN mypet.appointment_payment_refund r ON r.payment_id = p.id
        $suffix
    """.trimIndent()

    private fun mapPayment(row: ResultSet): Payment = Payment(
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
        refundStatus = row.getString("appointment_refund_status")?.let(RefundStatus::valueOf),
    )

    private fun bindCommand(customerId: UUID, key: String, fingerprint: String, paymentId: UUID, now: Instant) {
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment_initiation_command(customer_id, idempotency_key, request_fingerprint, payment_id, created_at)
                VALUES (?, ?, ?, ?, ?)
                """.trimIndent(),
                customerId,
                key,
                fingerprint,
                paymentId,
                now.jdbcTimestamp(),
            )
        } catch (_: DuplicateKeyException) {
            val existing = command(customerId, key) ?: throw DomainException("PAYMENT_CONFLICT", "Payment command raced; retry safely")
            if (existing.fingerprint != fingerprint || existing.paymentId != paymentId) idempotencyMismatch()
        }
    }

    private fun command(customerId: UUID, key: String): StoredCommand? = jdbc.query(
        "SELECT request_fingerprint, payment_id FROM mypet.payment_initiation_command WHERE customer_id = ? AND idempotency_key = ?",
        { row, _ -> StoredCommand(row.getString("request_fingerprint"), row.getObject("payment_id", UUID::class.java)) },
        customerId,
        key,
    ).singleOrNull()

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
            INSERT INTO mypet.payment_attempt(
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

    private fun validateProviderSnapshot(payment: Payment, snapshot: ProviderPaymentSnapshot) {
        if (snapshot.providerOrderReference != payment.providerOrderReference) {
            throw DomainException("PAYMENT_PROVIDER_ORDER_MISMATCH", "Provider order identity does not match")
        }
        if (
            snapshot.orderCurrency != "INR" || snapshot.orderCurrency != payment.currency ||
            snapshot.orderAmountPaise != payment.amountPaise ||
            snapshot.paymentCurrency != "INR" || snapshot.paymentCurrency != payment.currency ||
            snapshot.paymentAmountPaise != payment.amountPaise
        ) {
            throw DomainException("PAYMENT_PROVIDER_AMOUNT_MISMATCH", "Provider payment amount does not match")
        }
    }

    private fun refundForPayment(paymentId: UUID): AppointmentRefund? = jdbc.query(
        """
        SELECT r.id, r.payment_id, r.appointment_id, r.status, r.amount_paise,
               r.currency, r.provider_refund_id, r.provider_idempotency_key,
               r.execution_state, p.provider_order_reference
        FROM mypet.appointment_payment_refund r
        JOIN mypet.payment p ON p.id = r.payment_id
        WHERE r.payment_id = ?
        """.trimIndent(),
        { row, _ -> mapRefund(row) },
        paymentId,
    ).singleOrNull()

    private fun mapRefund(row: ResultSet): AppointmentRefund = AppointmentRefund(
        id = row.getObject("id", UUID::class.java),
        paymentId = row.getObject("payment_id", UUID::class.java),
        appointmentId = row.getObject("appointment_id", UUID::class.java),
        status = RefundStatus.valueOf(row.getString("status")),
        amountPaise = row.getLong("amount_paise"),
        currency = row.getString("currency"),
        providerRefundId = row.getString("provider_refund_id"),
        providerIdempotencyKey = row.getString("provider_idempotency_key"),
        executionState = RefundExecutionState.valueOf(row.getString("execution_state")),
        providerOrderReference = row.getString("provider_order_reference"),
    )

    private fun lockedAppointment(row: ResultSet) = LockedAppointment(
        id = row.getObject("id", UUID::class.java),
        customerId = row.getObject("customer_id", UUID::class.java),
        status = row.getString("status"),
        paymentMode = row.getString("payment_mode"),
        paymentState = row.getString("payment_state"),
        pricePaise = row.getLong("price_paise"),
        currency = row.getString("currency"),
        holdExpiresAt = row.getTimestamp("hold_expires_at")?.toInstant(),
    )

    private fun appendAppointmentHistory(appointmentId: UUID, status: String, actorId: UUID, note: String, now: Instant) {
        jdbc.update(
            """
            INSERT INTO mypet.appointment_history(id, appointment_id, status, actor_id, note, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID(),
            appointmentId,
            status,
            actorId,
            note.take(500),
            now.jdbcTimestamp(),
        )
    }

    private fun insertPaymentHistory(paymentId: UUID, from: PaymentStatus?, to: PaymentStatus, reason: String, now: Instant) {
        if (from == to) return
        try {
            jdbc.update(
                """
                INSERT INTO mypet.payment_history(id, payment_id, from_status, to_status, reason_code, source_identity, occurred_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                UUID.randomUUID(),
                paymentId,
                from?.name,
                to.name,
                reason.take(64),
                "appointment-payment:$paymentId:$reason".take(160),
                now.jdbcTimestamp(),
            )
        } catch (_: DuplicateKeyException) {
        }
    }

    private fun shouldCallProvider(payment: Payment): Boolean =
        payment.providerSessionId == null && payment.commandState != ProviderCommandState.REJECTED && payment.status != PaymentStatus.CAPTURED

    private fun validateIdempotencyKey(value: String) {
        if (!value.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) {
            throw DomainException("IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid")
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun deterministicUuid(value: String): UUID = UUID.nameUUIDFromBytes(value.toByteArray(StandardCharsets.UTF_8))
    private fun unsupportedProvider(): Nothing = throw DomainException("PAYMENT_PROVIDER_INVALID", "The payment provider is unsupported")
    private fun providerUnavailable(): Nothing = throw DomainException("PAYMENT_PROVIDER_UNAVAILABLE", "Online payment is temporarily unavailable")
    private fun idempotencyMismatch(): Nothing = throw DomainException("IDEMPOTENCY_FINGERPRINT_MISMATCH", "The idempotency key was already used for another request")
    private fun notFound(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")

    private fun <T> transaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("Appointment payment transaction returned no result")

    private data class Prepared(val payment: Payment, val callProvider: Boolean, val customer: ProviderCustomer)
    private data class StoredCommand(val fingerprint: String, val paymentId: UUID)
    private data class LockedAppointment(
        val id: UUID,
        val customerId: UUID,
        val status: String,
        val paymentMode: String,
        val paymentState: String,
        val pricePaise: Long,
        val currency: String,
        val holdExpiresAt: Instant?,
    )
    private data class AppointmentRefund(
        val id: UUID,
        val paymentId: UUID,
        val appointmentId: UUID,
        val status: RefundStatus,
        val amountPaise: Long,
        val currency: String,
        val providerRefundId: String,
        val providerIdempotencyKey: String,
        val executionState: RefundExecutionState,
        val providerOrderReference: String,
    )

    companion object {
        private const val APPOINTMENT_PROVIDER_PREFIX = "ma_"
    }
}

private fun Instant.jdbcTimestamp(): Timestamp = Timestamp.from(this)
