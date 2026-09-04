package `in`.mypetnew.merchantops

import `in`.mypetnew.common.scheduling.PostgresScheduledJobLock
import `in`.mypetnew.common.scheduling.ScheduledJobNames
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import `in`.mypetnew.merchantops.testsupport.MerchantOpsPostgres
import `in`.mypetnew.merchantops.testsupport.PostgresTestDatabase
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@MerchantOpsContract
@MerchantOpsPostgres
class MI4ScheduledInfrastructurePostgresContractTest {
    @Test
    fun `same scheduled job runs on only one replica at a time`() {
        PostgresTestDatabase.resetAndMigrate()
        val firstReplica = PostgresScheduledJobLock(PostgresTestDatabase.dataSource())
        val secondReplica = PostgresScheduledJobLock(PostgresTestDatabase.dataSource())
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val secondTaskRan = AtomicBoolean(false)
        val executor = Executors.newSingleThreadExecutor()

        try {
            val first = executor.submit<Boolean> {
                firstReplica.runIfAcquired(ScheduledJobNames.PAYMENT_WEBHOOK_INBOX) {
                    entered.countDown()
                    check(release.await(10, TimeUnit.SECONDS)) { "Timed out waiting to release scheduler lock" }
                }
            }

            assertTrue(entered.await(10, TimeUnit.SECONDS))
            assertFalse(
                secondReplica.runIfAcquired(ScheduledJobNames.PAYMENT_WEBHOOK_INBOX) {
                    secondTaskRan.set(true)
                },
            )
            assertFalse(secondTaskRan.get())

            release.countDown()
            assertTrue(first.get(10, TimeUnit.SECONDS))
            assertTrue(secondReplica.runIfAcquired(ScheduledJobNames.PAYMENT_WEBHOOK_INBOX) {})
        } finally {
            release.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `different scheduled jobs do not block each other`() {
        PostgresTestDatabase.resetAndMigrate()
        val firstReplica = PostgresScheduledJobLock(PostgresTestDatabase.dataSource())
        val secondReplica = PostgresScheduledJobLock(PostgresTestDatabase.dataSource())
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()

        try {
            val first = executor.submit<Boolean> {
                firstReplica.runIfAcquired(ScheduledJobNames.PAYMENT_RECONCILIATION) {
                    entered.countDown()
                    check(release.await(10, TimeUnit.SECONDS)) { "Timed out waiting to release scheduler lock" }
                }
            }

            assertTrue(entered.await(10, TimeUnit.SECONDS))
            assertTrue(secondReplica.runIfAcquired(ScheduledJobNames.NOTIFICATION_DELIVERY) {})
            release.countDown()
            assertTrue(first.get(10, TimeUnit.SECONDS))
        } finally {
            release.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `failed scheduled job releases advisory lock`() {
        PostgresTestDatabase.resetAndMigrate()
        val firstReplica = PostgresScheduledJobLock(PostgresTestDatabase.dataSource())
        val secondReplica = PostgresScheduledJobLock(PostgresTestDatabase.dataSource())

        assertThrows(IllegalStateException::class.java) {
            firstReplica.runIfAcquired(ScheduledJobNames.CATALOG_MEDIA_CLEANUP) {
                throw IllegalStateException("expected MI4 failure probe")
            }
        }
        assertTrue(secondReplica.runIfAcquired(ScheduledJobNames.CATALOG_MEDIA_CLEANUP) {})
    }

    @Test
    fun `scheduled job names map to distinct deterministic advisory keys`() {
        val lock = PostgresScheduledJobLock(PostgresTestDatabase.dataSource())
        val paymentKey = lock.advisoryKey(ScheduledJobNames.PAYMENT_RECONCILIATION)
        val notificationKey = lock.advisoryKey(ScheduledJobNames.NOTIFICATION_DELIVERY)

        assertNotEquals(paymentKey, notificationKey)
        assertTrue(paymentKey == lock.advisoryKey(ScheduledJobNames.PAYMENT_RECONCILIATION))
    }
}
