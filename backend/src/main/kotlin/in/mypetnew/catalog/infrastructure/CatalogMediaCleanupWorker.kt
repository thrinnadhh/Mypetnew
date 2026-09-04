package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.CatalogMediaObjectStore
import `in`.mypetnew.common.scheduling.PostgresScheduledJobLock
import `in`.mypetnew.common.scheduling.ScheduledJobNames
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
@Profile("!test & !development")
class CatalogMediaCleanupWorker(
    private val jdbc: JdbcTemplate,
    private val objectStore: CatalogMediaObjectStore,
    private val schedulerLock: PostgresScheduledJobLock,
) {
    private data class CleanupRow(
        val objectKey: String,
        val attempts: Int,
    )

    @Scheduled(fixedDelayString = "\${mypet.supabase.catalog-media.cleanup-delay-ms:60000}")
    fun retryDueCleanup() {
        schedulerLock.runIfAcquired(ScheduledJobNames.CATALOG_MEDIA_CLEANUP) {
            val due = jdbc.query(
                """
                SELECT object_key, attempts
                FROM mypet.catalog_media_cleanup
                WHERE next_attempt_at <= CURRENT_TIMESTAMP
                ORDER BY next_attempt_at, created_at
                LIMIT 25
                """.trimIndent(),
            ) { rows, _ -> CleanupRow(rows.getString("object_key"), rows.getInt("attempts")) }

            due.forEach { row ->
                try {
                    // Object-store deletion is idempotent: a previously deleted object is success.
                    objectStore.delete(row.objectKey)
                    jdbc.update("DELETE FROM mypet.catalog_media_cleanup WHERE object_key = ?", row.objectKey)
                } catch (_: Exception) {
                    val delaySeconds = retryDelaySeconds(row.attempts + 1)
                    jdbc.update(
                        """
                        UPDATE mypet.catalog_media_cleanup
                        SET attempts = attempts + 1,
                            last_error = 'DELETE_FAILED',
                            next_attempt_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 second'),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE object_key = ?
                        """.trimIndent(),
                        delaySeconds,
                        row.objectKey,
                    )
                }
            }
        }
    }

    private fun retryDelaySeconds(attempt: Int): Int {
        val exponent = attempt.coerceIn(0, 7)
        return (30 * (1 shl exponent)).coerceAtMost(3600)
    }
}
