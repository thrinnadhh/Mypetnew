package `in`.mypetnew.merchantops.testsupport

import java.time.Duration
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class ConcurrentScenarioTimeoutException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

data class ConcurrentScenarioResult<T>(
    val outcomes: List<Result<T>>,
) {
    val successes: List<T> = outcomes.mapNotNull { it.getOrNull() }
    val failures: List<Throwable> = outcomes.mapNotNull { it.exceptionOrNull() }
}

object ConcurrentScenarioRunner {
    fun <T> run(
        contenders: Int,
        timeout: Duration = Duration.ofSeconds(10),
        action: (index: Int) -> T,
    ): ConcurrentScenarioResult<T> {
        require(contenders > 0) { "contenders must be positive" }
        require(!timeout.isNegative && !timeout.isZero) { "timeout must be positive" }
        val executor = Executors.newFixedThreadPool(contenders)
        val barrier = CyclicBarrier(contenders)
        val deadline = System.nanoTime() + timeout.toNanos()
        try {
            val futures = (0 until contenders).map { index ->
                executor.submit(Callable {
                    runCatching {
                        barrier.await(timeout.toMillis(), TimeUnit.MILLISECONDS)
                        action(index)
                    }
                })
            }
            val outcomes = futures.mapIndexed { index, future ->
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) throw ConcurrentScenarioTimeoutException("Concurrent scenario timed out before contender $index completed")
                try {
                    future.get(remaining, TimeUnit.NANOSECONDS)
                } catch (exception: TimeoutException) {
                    throw ConcurrentScenarioTimeoutException("Concurrent scenario timed out waiting for contender $index", exception)
                }
            }
            return ConcurrentScenarioResult(outcomes)
        } finally {
            executor.shutdownNow()
            executor.awaitTermination(5, TimeUnit.SECONDS)
        }
    }
}
