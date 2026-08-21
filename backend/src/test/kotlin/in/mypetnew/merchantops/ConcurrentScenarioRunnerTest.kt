package `in`.mypetnew.merchantops

import `in`.mypetnew.merchantops.testsupport.ConcurrentScenarioRunner
import `in`.mypetnew.merchantops.testsupport.ConcurrentScenarioTimeoutException
import `in`.mypetnew.merchantops.testsupport.MerchantOpsConcurrency
import `in`.mypetnew.merchantops.testsupport.MerchantOpsContract
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean

@MerchantOpsContract
@MerchantOpsConcurrency
class ConcurrentScenarioRunnerTest {
    @Test
    fun `runner starts contenders together and captures exactly one winner`() {
        val claimed = AtomicBoolean(false)
        val result = ConcurrentScenarioRunner.run(contenders = 12) {
            claimed.compareAndSet(false, true)
        }

        assertEquals(1, result.successes.count { it })
        assertEquals(11, result.successes.count { !it })
        assertTrueNoFailures(result.failures)
    }

    @Test
    fun `runner times out with a diagnostic and interrupts blocked contenders`() {
        val neverReleased = CountDownLatch(1)
        val error = assertThrows(ConcurrentScenarioTimeoutException::class.java) {
            ConcurrentScenarioRunner.run(contenders = 2, timeout = Duration.ofMillis(100)) {
                neverReleased.await()
            }
        }
        org.junit.jupiter.api.Assertions.assertTrue(error.message.orEmpty().contains("timed out"))
    }

    private fun assertTrueNoFailures(failures: List<Throwable>) {
        assertEquals(emptyList<Throwable>(), failures)
    }
}
