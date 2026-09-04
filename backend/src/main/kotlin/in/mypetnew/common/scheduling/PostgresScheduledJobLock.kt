package `in`.mypetnew.common.scheduling

import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Connection
import javax.sql.DataSource

@Component
class PostgresScheduledJobLock(
    private val dataSource: DataSource,
) {
    private val logger = LoggerFactory.getLogger(PostgresScheduledJobLock::class.java)

    fun runIfAcquired(jobName: String, task: () -> Unit): Boolean {
        require(jobName.isNotBlank()) { "Scheduled job name must not be blank" }
        val key = advisoryKey(jobName)

        dataSource.connection.use { connection ->
            if (!tryLock(connection, key)) {
                logger.debug("Scheduled job skipped because another replica owns lock: {}", jobName)
                return false
            }

            var taskFailure: Throwable? = null
            try {
                task()
                return true
            } catch (failure: Throwable) {
                taskFailure = failure
                throw failure
            } finally {
                try {
                    check(unlock(connection, key)) {
                        "Scheduled job advisory lock was not held during release: $jobName"
                    }
                } catch (unlockFailure: Throwable) {
                    taskFailure?.addSuppressed(unlockFailure) ?: throw unlockFailure
                }
            }
        }
    }

    private fun tryLock(connection: Connection, key: Long): Boolean =
        booleanQuery(connection, "SELECT pg_catalog.pg_try_advisory_lock(?)", key)

    private fun unlock(connection: Connection, key: Long): Boolean =
        booleanQuery(connection, "SELECT pg_catalog.pg_advisory_unlock(?)", key)

    private fun booleanQuery(connection: Connection, sql: String, key: Long): Boolean =
        connection.prepareStatement(sql).use { statement ->
            statement.setLong(1, key)
            statement.executeQuery().use { rows ->
                check(rows.next()) { "PostgreSQL advisory-lock query returned no row" }
                rows.getBoolean(1)
            }
        }

    internal fun advisoryKey(jobName: String): Long {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("mypet:scheduler:$jobName".toByteArray(StandardCharsets.UTF_8))
        return ByteBuffer.wrap(digest, 0, Long.SIZE_BYTES).long
    }
}

object ScheduledJobNames {
    const val DELIVERY_READY_RECOVERY = "delivery-ready-recovery"
    const val DELIVERY_DISPATCH_RETRY = "delivery-dispatch-retry"
    const val PAYMENT_WEBHOOK_INBOX = "payments-webhook-inbox"
    const val PAYMENT_RECONCILIATION = "payments-reconciliation"
    const val PAYMENT_EXPIRY = "payments-expiry"
    const val PAYMENT_REFUNDS = "payments-refunds"
    const val RECURRING_ORDERS = "recurring-orders"
    const val CATALOG_MEDIA_CLEANUP = "catalog-media-cleanup"
    const val NOTIFICATION_DELIVERY = "notification-delivery"
}
