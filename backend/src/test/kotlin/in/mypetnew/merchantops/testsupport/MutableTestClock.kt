package `in`.mypetnew.merchantops.testsupport

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

class MutableTestClock(
    private var current: Instant,
    private val zone: ZoneId = ZoneOffset.UTC,
) : Clock() {
    override fun getZone(): ZoneId = zone

    override fun withZone(zone: ZoneId): Clock = MutableTestClock(current, zone)

    override fun instant(): Instant = current

    fun advance(duration: Duration) {
        require(!duration.isNegative) { "duration must not be negative" }
        current = current.plus(duration)
    }
}
