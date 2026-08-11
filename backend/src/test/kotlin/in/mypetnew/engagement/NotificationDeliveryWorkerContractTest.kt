package `in`.mypetnew.engagement

import `in`.mypetnew.engagement.domain.NotificationAttemptRepository
import `in`.mypetnew.engagement.domain.NotificationDeliveryAttempt
import `in`.mypetnew.engagement.domain.NotificationDeliveryWorker
import `in`.mypetnew.engagement.domain.NotificationProvider
import `in`.mypetnew.engagement.domain.ProviderDeliveryResult
import `in`.mypetnew.engagement.domain.PushDeliveryCommand
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class NotificationDeliveryWorkerContractTest {
    private val clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)

    @Test
    fun `worker retries transient failures and dead letters only after the bounded attempt`() {
        val repository = RecordingAttemptRepository(attempt(attemptCount = 1))
        val provider = NotificationProvider { ProviderDeliveryResult.TransientFailure("FCM_HTTP_503") }
        val worker = NotificationDeliveryWorker(provider, repository, clock, maxAttempts = 3)

        worker.runBatch(10)
        assertEquals("RETRY", repository.outcome)
        assertEquals(clock.instant().plusSeconds(60), repository.nextAttemptAt)

        repository.next = attempt(attemptCount = 3)
        worker.runBatch(10)
        assertEquals("DEAD", repository.outcome)
        assertEquals("FCM_HTTP_503", repository.safeCode)
    }

    @Test
    fun `worker deactivates invalid tokens and records provider success without domain effects`() {
        val invalidRepository = RecordingAttemptRepository(attempt())
        NotificationDeliveryWorker(
            NotificationProvider { ProviderDeliveryResult.InvalidRegistration("FCM_UNREGISTERED") },
            invalidRepository,
            clock,
        ).runBatch(1)
        assertEquals("INVALID", invalidRepository.outcome)

        val deliveredRepository = RecordingAttemptRepository(attempt())
        NotificationDeliveryWorker(
            NotificationProvider { ProviderDeliveryResult.Delivered("projects/dev/messages/1") },
            deliveredRepository,
            clock,
        ).runBatch(1)
        assertEquals("DELIVERED", deliveredRepository.outcome)
        assertEquals("projects/dev/messages/1", deliveredRepository.providerReference)
    }

    @Test
    fun `unexpected provider failure releases the claim into bounded retry`() {
        val repository = RecordingAttemptRepository(attempt())
        val worker = NotificationDeliveryWorker(
            NotificationProvider { error("provider credential refresh failed") },
            repository,
            clock,
        )

        worker.runBatch(1)

        assertEquals("RETRY", repository.outcome)
        assertEquals("NOTIFICATION_PROVIDER_UNAVAILABLE", repository.safeCode)
    }

    private fun attempt(attemptCount: Int = 1): NotificationDeliveryAttempt {
        val notificationId = UUID.randomUUID()
        return NotificationDeliveryAttempt(
            id = UUID.randomUUID(),
            attemptCount = attemptCount,
            command = PushDeliveryCommand(
                registrationId = UUID.randomUUID(),
                environment = "development",
                nativeToken = "native-token",
                notificationId = notificationId,
                title = "New order",
                body = "Open the app to review it.",
                data = mapOf(
                    "notificationId" to notificationId.toString(),
                    "resourceId" to UUID.randomUUID().toString(),
                    "route" to "merchant/orders/detail",
                    "eventType" to "pickup-order-placed",
                ),
            ),
        )
    }

    private class RecordingAttemptRepository(var next: NotificationDeliveryAttempt) : NotificationAttemptRepository {
        var outcome: String? = null
        var safeCode: String? = null
        var providerReference: String? = null
        var nextAttemptAt: Instant? = null

        override fun claim(limit: Int, at: Instant): List<NotificationDeliveryAttempt> = listOf(next)

        override fun delivered(attempt: NotificationDeliveryAttempt, providerReference: String, at: Instant) {
            outcome = "DELIVERED"
            this.providerReference = providerReference
        }

        override fun invalid(attempt: NotificationDeliveryAttempt, safeCode: String, at: Instant) {
            outcome = "INVALID"
            this.safeCode = safeCode
        }

        override fun retry(
            attempt: NotificationDeliveryAttempt,
            safeCode: String,
            nextAttemptAt: Instant,
            at: Instant,
        ) {
            outcome = "RETRY"
            this.safeCode = safeCode
            this.nextAttemptAt = nextAttemptAt
        }

        override fun deadLetter(attempt: NotificationDeliveryAttempt, safeCode: String, at: Instant) {
            outcome = "DEAD"
            this.safeCode = safeCode
        }
    }
}
