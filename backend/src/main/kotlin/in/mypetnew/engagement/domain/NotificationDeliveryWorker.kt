package `in`.mypetnew.engagement.domain

import `in`.mypetnew.common.error.DomainException
import java.time.Clock
import java.time.Instant
import kotlin.math.min

data class NotificationDeliveryAttempt(
    val id: java.util.UUID,
    val attemptCount: Int,
    val command: PushDeliveryCommand,
)

interface NotificationAttemptRepository {
    fun claim(limit: Int, at: Instant): List<NotificationDeliveryAttempt>
    fun delivered(attempt: NotificationDeliveryAttempt, providerReference: String, at: Instant)
    fun invalid(attempt: NotificationDeliveryAttempt, safeCode: String, at: Instant)
    fun retry(attempt: NotificationDeliveryAttempt, safeCode: String, nextAttemptAt: Instant, at: Instant)
    fun deadLetter(attempt: NotificationDeliveryAttempt, safeCode: String, at: Instant)
}

data class NotificationBatchResult(
    val claimed: Int,
    val delivered: Int,
    val invalid: Int,
    val retried: Int,
    val deadLettered: Int,
)

class NotificationDeliveryWorker(
    private val provider: NotificationProvider,
    private val attempts: NotificationAttemptRepository,
    private val clock: Clock = Clock.systemUTC(),
    private val maxAttempts: Int = 5,
) {
    init {
        require(maxAttempts in 1..20) { "Maximum notification attempts must be bounded" }
    }

    fun runBatch(limit: Int): NotificationBatchResult {
        if (limit !in 1..100) {
            throw DomainException("NOTIFICATION_BATCH_INVALID", "The notification batch size is invalid")
        }
        val now = clock.instant()
        var delivered = 0
        var invalid = 0
        var retried = 0
        var deadLettered = 0
        val claimed = attempts.claim(limit, now)
        claimed.forEach { attempt ->
            val result = runCatching { provider.send(attempt.command) }.getOrElse {
                ProviderDeliveryResult.TransientFailure("NOTIFICATION_PROVIDER_UNAVAILABLE")
            }
            when (result) {
                is ProviderDeliveryResult.Delivered -> {
                    attempts.delivered(attempt, result.providerReference, now)
                    delivered += 1
                }
                is ProviderDeliveryResult.InvalidRegistration -> {
                    attempts.invalid(attempt, result.safeCode, now)
                    invalid += 1
                }
                is ProviderDeliveryResult.PermanentFailure -> {
                    attempts.deadLetter(attempt, result.safeCode, now)
                    deadLettered += 1
                }
                is ProviderDeliveryResult.TransientFailure -> {
                    if (attempt.attemptCount >= maxAttempts) {
                        attempts.deadLetter(attempt, result.safeCode, now)
                        deadLettered += 1
                    } else {
                        val delaySeconds = min(3_600L, 30L shl attempt.attemptCount.coerceAtMost(6))
                        attempts.retry(attempt, result.safeCode, now.plusSeconds(delaySeconds), now)
                        retried += 1
                    }
                }
            }
        }
        return NotificationBatchResult(claimed.size, delivered, invalid, retried, deadLettered)
    }
}
