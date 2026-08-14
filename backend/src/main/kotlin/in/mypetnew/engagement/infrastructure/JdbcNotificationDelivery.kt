package `in`.mypetnew.engagement.infrastructure

import `in`.mypetnew.engagement.domain.Notification
import `in`.mypetnew.engagement.domain.NotificationAttemptRepository
import `in`.mypetnew.engagement.domain.NotificationDeliveryAttempt
import `in`.mypetnew.engagement.domain.NotificationDeliveryWorker
import `in`.mypetnew.engagement.domain.NotificationProvider
import `in`.mypetnew.engagement.domain.NotificationRepository
import `in`.mypetnew.engagement.domain.PushDeliveryCommand
import java.sql.ResultSet
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.stereotype.Repository
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper

@Repository
@Profile("!test & !development")
class JdbcNotificationDeliveryRepository(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
    private val tokenCipher: DeviceTokenCipher,
    private val firebase: FirebaseProperties,
    private val json: ObjectMapper,
) : NotificationRepository, NotificationAttemptRepository {
    private data class ClaimedRow(
        val attemptId: UUID,
        val attemptCount: Int,
        val registrationId: UUID,
        val environment: String,
        val protectedToken: String,
        val notificationId: UUID,
        val title: String,
        val body: String,
        val eventType: String,
        val route: String,
        val resourceId: UUID,
    )

    override fun putIfAbsent(notification: Notification): Notification = transaction.execute {
        val inserted = jdbc.sql(
            """
            INSERT INTO mypet.notification_item(
                id, source_event_id, recipient_id, event_type, template_version,
                safe_route, resource_id, title, body, created_at
            ) VALUES (
                :id, :source_event_id, :recipient_id, :event_type, :template_version,
                :safe_route, :resource_id, :title, :body, :created_at
            )
            ON CONFLICT DO NOTHING
            """.trimIndent(),
        ).param("id", notification.id)
            .param("source_event_id", notification.sourceEventId)
            .param("recipient_id", notification.recipientId)
            .param("event_type", notification.payload.getValue("eventType"))
            .param("template_version", notification.templateVersion)
            .param("safe_route", notification.payload.getValue("route"))
            .param("resource_id", notification.resourceId)
            .param("title", notification.title)
            .param("body", notification.body)
            .param("created_at", notification.createdAt)
            .update()
        if (inserted == 0) return@execute findByDedupe(notification)

        val outboxId = UUID.randomUUID()
        jdbc.sql(
            """
            INSERT INTO mypet.outbox_event(
                id, aggregate_type, aggregate_id, event_type, event_version, payload, status, trace_id
            ) VALUES (:id, 'NOTIFICATION', :aggregate_id, :event_type, 1, :payload, 'PENDING', :trace_id)
            """.trimIndent(),
        ).param("id", outboxId)
            .param("aggregate_id", notification.id)
            .param("event_type", notification.payload.getValue("eventType"))
            .param(
                "payload",
                json.writeValueAsString(
                    mapOf(
                        "notificationId" to notification.id.toString(),
                        "recipientId" to notification.recipientId.toString(),
                    ),
                ),
            )
            .param("trace_id", "notification-${notification.id}")
            .update()
        val registrationIds = jdbc.sql(
            """
            SELECT d.id FROM mypet.device_registration d
            JOIN mypet.user_session s ON s.id = d.session_id
            JOIN mypet.identity_account a ON a.id = d.user_id
            WHERE d.user_id = :recipient_id AND d.environment = :environment
              AND d.status = 'ACTIVE' AND d.permission_state = 'GRANTED'
              AND s.revoked_at IS NULL AND s.expires_at > :now AND a.status = 'ACTIVE'
            """.trimIndent(),
        ).param("recipient_id", notification.recipientId)
            .param("environment", firebase.environment)
            .param("now", notification.createdAt)
            .query(UUID::class.java)
            .list()
        registrationIds.forEach { registrationId ->
            jdbc.sql(
                """
                INSERT INTO mypet.notification_attempt(
                    id, notification_id, registration_id, channel, status, attempt_count, next_attempt_at
                ) VALUES (:id, :notification_id, :registration_id, 'PUSH', 'PENDING', 0, :next_attempt_at)
                ON CONFLICT DO NOTHING
                """.trimIndent(),
            ).param("id", UUID.randomUUID())
                .param("notification_id", notification.id)
                .param("registration_id", registrationId)
                .param("next_attempt_at", notification.createdAt)
                .update()
        }
        if (registrationIds.isEmpty()) completeOutbox(notification.id, notification.createdAt)
        notification
    }

    override fun forRecipient(recipientId: UUID): List<Notification> = jdbc.sql(
        """
        SELECT id, source_event_id, recipient_id, event_type, template_version,
               safe_route, resource_id, title, body, created_at
        FROM mypet.notification_item WHERE recipient_id = :recipient_id
        ORDER BY created_at DESC, id DESC
        """.trimIndent(),
    ).param("recipient_id", recipientId).query(::mapNotification).list()

    override fun claim(limit: Int, at: Instant): List<NotificationDeliveryAttempt> = transaction.execute {
        val rows = jdbc.sql(
            """
            SELECT a.id AS attempt_id, a.attempt_count, d.id AS registration_id, d.environment,
                   d.protected_token, n.id AS notification_id, n.title, n.body, n.event_type,
                   n.safe_route, n.resource_id
            FROM mypet.notification_attempt a
            JOIN mypet.device_registration d ON d.id = a.registration_id
            JOIN mypet.notification_item n ON n.id = a.notification_id
            JOIN mypet.user_session s ON s.id = d.session_id
            JOIN mypet.identity_account i ON i.id = d.user_id
            WHERE (
                    (a.status IN ('PENDING', 'RETRY') AND COALESCE(a.next_attempt_at, a.created_at) <= :now)
                    OR (a.status = 'PROCESSING' AND a.claimed_at < :stale_before)
                  )
              AND d.environment = :environment
              AND d.status = 'ACTIVE' AND d.permission_state = 'GRANTED'
              AND s.revoked_at IS NULL AND s.expires_at > :now AND i.status = 'ACTIVE'
            ORDER BY COALESCE(a.next_attempt_at, a.created_at), a.id
            LIMIT :batch_limit
            FOR UPDATE OF a SKIP LOCKED
            """.trimIndent(),
        ).param("now", at)
            .param("stale_before", at.minus(Duration.ofMinutes(5)))
            .param("environment", firebase.environment)
            .param("batch_limit", limit)
            .query(::mapClaimedRow)
            .list()
        rows.mapNotNull { row ->
            val attemptCount = row.attemptCount + 1
            jdbc.sql(
                """
                UPDATE mypet.notification_attempt
                SET status = 'PROCESSING', attempt_count = :attempt_count, claimed_at = :claimed_at,
                    updated_at = :claimed_at
                WHERE id = :id
                """.trimIndent(),
            ).param("attempt_count", attemptCount).param("claimed_at", at).param("id", row.attemptId).update()
            val nativeToken = runCatching { tokenCipher.decrypt(row.protectedToken) }.getOrElse {
                deadLetterUndeliverable(row, attemptCount, at, "DEVICE_TOKEN_DECRYPT_FAILED", true)
                return@mapNotNull null
            }
            val command = runCatching {
                PushDeliveryCommand(
                    registrationId = row.registrationId,
                    environment = row.environment,
                    nativeToken = nativeToken,
                    notificationId = row.notificationId,
                    title = row.title,
                    body = row.body,
                    data = mapOf(
                        "notificationId" to row.notificationId.toString(),
                        "resourceId" to row.resourceId.toString(),
                        "route" to row.route,
                        "eventType" to row.eventType,
                    ),
                )
            }.getOrElse {
                deadLetterUndeliverable(row, attemptCount, at, "NOTIFICATION_PAYLOAD_INVALID", false)
                return@mapNotNull null
            }
            NotificationDeliveryAttempt(
                id = row.attemptId,
                attemptCount = attemptCount,
                command = command,
            )
        }
    }

    private fun deadLetterUndeliverable(
        row: ClaimedRow,
        attemptCount: Int,
        at: Instant,
        safeCode: String,
        invalidateRegistration: Boolean,
    ) {
        jdbc.sql(
            """
            UPDATE mypet.notification_attempt
            SET status = 'DEAD_LETTER', safe_provider_code = :safe_code,
                next_attempt_at = NULL, updated_at = :now
            WHERE id = :id AND status = 'PROCESSING'
            """.trimIndent(),
        ).param("safe_code", safeCode).param("now", at).param("id", row.attemptId).update()
        if (invalidateRegistration) {
            jdbc.sql(
                "UPDATE mypet.device_registration SET status = 'INVALID', updated_at = :now WHERE id = :id",
            ).param("now", at).param("id", row.registrationId).update()
        }
        jdbc.sql(
            """
            INSERT INTO mypet.dead_letter(
                id, source_event_id, consumer_name, safe_error_code, attempt_count, payload
            ) SELECT :id, source_event_id, 'firebase-notification-worker', :safe_code, :attempt_count, :payload
              FROM mypet.notification_item WHERE id = :notification_id
            """.trimIndent(),
        ).param("id", UUID.randomUUID())
            .param("safe_code", safeCode)
            .param("attempt_count", attemptCount)
            .param("payload", json.writeValueAsString(mapOf("notificationId" to row.notificationId.toString())))
            .param("notification_id", row.notificationId)
            .update()
        completeOutbox(row.notificationId, at)
    }

    override fun delivered(attempt: NotificationDeliveryAttempt, providerReference: String, at: Instant) {
        transaction.executeWithoutResult {
            jdbc.sql(
                """
                UPDATE mypet.notification_attempt
                SET status = 'DELIVERED', provider_reference = :provider_reference,
                    safe_provider_code = 'FCM_OK', next_attempt_at = NULL, updated_at = :now
                WHERE id = :id AND status = 'PROCESSING'
                """.trimIndent(),
            ).param("provider_reference", providerReference.take(160))
                .param("now", at)
                .param("id", attempt.id)
                .update()
            completeOutbox(attempt.command.notificationId, at)
        }
    }

    override fun invalid(attempt: NotificationDeliveryAttempt, safeCode: String, at: Instant) {
        transaction.executeWithoutResult {
            jdbc.sql(
                """
                UPDATE mypet.notification_attempt
                SET status = 'INVALID', safe_provider_code = :safe_code,
                    next_attempt_at = NULL, updated_at = :now
                WHERE id = :id AND status = 'PROCESSING'
                """.trimIndent(),
            ).param("safe_code", safeCode.take(80)).param("now", at).param("id", attempt.id).update()
            jdbc.sql(
                "UPDATE mypet.device_registration SET status = 'INVALID', updated_at = :now WHERE id = :id",
            ).param("now", at).param("id", attempt.command.registrationId).update()
            completeOutbox(attempt.command.notificationId, at)
        }
    }

    override fun retry(
        attempt: NotificationDeliveryAttempt,
        safeCode: String,
        nextAttemptAt: Instant,
        at: Instant,
    ) {
        jdbc.sql(
            """
            UPDATE mypet.notification_attempt
            SET status = 'RETRY', safe_provider_code = :safe_code,
                next_attempt_at = :next_attempt_at, claimed_at = NULL, updated_at = :now
            WHERE id = :id AND status = 'PROCESSING'
            """.trimIndent(),
        ).param("safe_code", safeCode.take(80))
            .param("next_attempt_at", nextAttemptAt)
            .param("now", at)
            .param("id", attempt.id)
            .update()
    }

    override fun deadLetter(attempt: NotificationDeliveryAttempt, safeCode: String, at: Instant) {
        transaction.executeWithoutResult {
            jdbc.sql(
                """
                UPDATE mypet.notification_attempt
                SET status = 'DEAD_LETTER', safe_provider_code = :safe_code,
                    next_attempt_at = NULL, updated_at = :now
                WHERE id = :id AND status = 'PROCESSING'
                """.trimIndent(),
            ).param("safe_code", safeCode.take(80)).param("now", at).param("id", attempt.id).update()
            jdbc.sql(
                """
                INSERT INTO mypet.dead_letter(
                    id, source_event_id, consumer_name, safe_error_code, attempt_count, payload
                ) SELECT :id, source_event_id, 'firebase-notification-worker', :safe_code, :attempt_count, :payload
                  FROM mypet.notification_item WHERE id = :notification_id
                """.trimIndent(),
            ).param("id", UUID.randomUUID())
                .param("safe_code", safeCode.take(80))
                .param("attempt_count", attempt.attemptCount)
                .param(
                    "payload",
                    json.writeValueAsString(mapOf("notificationId" to attempt.command.notificationId.toString())),
                )
                .param("notification_id", attempt.command.notificationId)
                .update()
            completeOutbox(attempt.command.notificationId, at)
        }
    }

    private fun findByDedupe(candidate: Notification): Notification = jdbc.sql(
        """
        SELECT id, source_event_id, recipient_id, event_type, template_version,
               safe_route, resource_id, title, body, created_at
        FROM mypet.notification_item
        WHERE source_event_id = :source_event_id AND recipient_id = :recipient_id
          AND template_version = :template_version
        """.trimIndent(),
    ).param("source_event_id", candidate.sourceEventId)
        .param("recipient_id", candidate.recipientId)
        .param("template_version", candidate.templateVersion)
        .query(::mapNotification)
        .single()

    private fun completeOutbox(notificationId: UUID, at: Instant) {
        jdbc.sql(
            """
            UPDATE mypet.outbox_event o
            SET status = CASE
                    WHEN EXISTS (
                        SELECT 1 FROM mypet.notification_attempt failed
                        WHERE failed.notification_id = :notification_id AND failed.status = 'DEAD_LETTER'
                    ) THEN 'DEAD_LETTER'
                    ELSE 'DELIVERED'
                END,
                delivered_at = :now
            WHERE o.aggregate_type = 'NOTIFICATION' AND o.aggregate_id = :notification_id
              AND NOT EXISTS (
                SELECT 1 FROM mypet.notification_attempt a
                WHERE a.notification_id = :notification_id AND a.status IN ('PENDING', 'RETRY', 'PROCESSING')
              )
            """.trimIndent(),
        ).param("now", at).param("notification_id", notificationId).update()
    }

    private fun mapNotification(rows: ResultSet, rowNumber: Int): Notification {
        require(rowNumber >= 0)
        val id = rows.getObject("id", UUID::class.java)
        val route = rows.getString("safe_route")
        val resourceId = rows.getObject("resource_id", UUID::class.java)
        val eventType = rows.getString("event_type")
        return Notification(
            id = id,
            sourceEventId = rows.getObject("source_event_id", UUID::class.java),
            recipientId = rows.getObject("recipient_id", UUID::class.java),
            templateVersion = rows.getString("template_version"),
            resourceId = resourceId,
            title = rows.getString("title"),
            body = rows.getString("body"),
            payload = mapOf(
                "notificationId" to id.toString(),
                "resourceId" to resourceId.toString(),
                "route" to route,
                "eventType" to eventType,
            ),
            createdAt = rows.getTimestamp("created_at").toInstant(),
        )
    }

    private fun mapClaimedRow(rows: ResultSet, rowNumber: Int): ClaimedRow {
        require(rowNumber >= 0)
        return ClaimedRow(
            attemptId = rows.getObject("attempt_id", UUID::class.java),
            attemptCount = rows.getInt("attempt_count"),
            registrationId = rows.getObject("registration_id", UUID::class.java),
            environment = rows.getString("environment"),
            protectedToken = rows.getString("protected_token"),
            notificationId = rows.getObject("notification_id", UUID::class.java),
            title = rows.getString("title"),
            body = rows.getString("body"),
            eventType = rows.getString("event_type"),
            route = rows.getString("safe_route"),
            resourceId = rows.getObject("resource_id", UUID::class.java),
        )
    }
}

@ConfigurationProperties("mypet.notifications.worker")
data class NotificationWorkerProperties(val batchSize: Int = 50, val maxAttempts: Int = 5) {
    init {
        require(batchSize in 1..100) { "Notification worker batch size is invalid" }
        require(maxAttempts in 1..20) { "Notification worker retry count is invalid" }
    }
}

@Configuration
@Profile("!test & !development")
@EnableScheduling
@EnableConfigurationProperties(NotificationWorkerProperties::class)
class NotificationWorkerConfiguration {
    @Bean
    fun notificationDeliveryWorker(
        provider: NotificationProvider,
        attempts: NotificationAttemptRepository,
        properties: NotificationWorkerProperties,
    ) = NotificationDeliveryWorker(provider, attempts, maxAttempts = properties.maxAttempts)
}

@Component
@Profile("!test & !development")
class NotificationDeliveryScheduler(
    private val worker: NotificationDeliveryWorker,
    private val properties: NotificationWorkerProperties,
) {
    @Scheduled(fixedDelayString = "\${mypet.notifications.worker.fixed-delay-millis:1000}")
    fun deliver() {
        worker.runBatch(properties.batchSize)
    }
}
