package `in`.mypetnew.delivery.domain

import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

data class CaptainEarningProjection(
    val deliveryId: UUID,
    val orderReference: String,
    val earningPaise: Long,
    val incentivePaise: Long = 0,
    val adjustmentPaise: Long = 0,
    val totalPaise: Long,
    val status: String, // "SETTLED", "PENDING"
    val completedAt: Instant,
)

data class SettlementProjection(
    val settlementId: UUID,
    val amountPaise: Long,
    val status: String, // "PROCESSED", "PENDING", "FAILED"
    val periodStart: String,
    val periodEnd: String,
    val processedAt: Instant? = null,
)

data class CaptainEarningsSummary(
    val todayPaise: Long,
    val todayDeliveryCount: Int,
    val thisWeekPaise: Long,
    val thisMonthPaise: Long,
    val recentEarnings: List<CaptainEarningProjection>,
    val settlements: List<SettlementProjection>,
)

data class CaptainDeliveryHistoryItem(
    val deliveryId: UUID,
    val orderId: UUID,
    val orderReference: String,
    val merchantName: String,
    val deliveredAt: Instant,
    val earningPaise: Long,
    val status: String,
)

interface CaptainEarningsPersistence {
    fun getSummary(captainId: UUID, todayStart: Instant, weekStart: Instant, monthStart: Instant): CaptainEarningsSummary
    fun getDeliveryHistory(captainId: UUID): List<CaptainDeliveryHistoryItem>
}

class InMemoryCaptainEarningsPersistence(
    private val dispatchPersistence: DispatchPersistence,
    private val baseDeliveryFeePaise: Long = 2500,
) : CaptainEarningsPersistence {
    override fun getSummary(
        captainId: UUID,
        todayStart: Instant,
        weekStart: Instant,
        monthStart: Instant,
    ): CaptainEarningsSummary {
        val jobs = dispatchPersistence.activeJobs() + listOfNotNull()
        // Filter jobs by captain in in-memory persistence
        val delivered = (dispatchPersistence as? InMemoryDispatchPersistence)?.let {
            // Retrieve via history query
            getDeliveryHistory(captainId)
        } ?: emptyList()

        val todayJobs = delivered.filter { it.deliveredAt.isAfter(todayStart) || it.deliveredAt == todayStart }
        val weekJobs = delivered.filter { it.deliveredAt.isAfter(weekStart) || it.deliveredAt == weekStart }
        val monthJobs = delivered.filter { it.deliveredAt.isAfter(monthStart) || it.deliveredAt == monthStart }

        val todayPaise = todayJobs.sumOf { it.earningPaise }
        val weekPaise = weekJobs.sumOf { it.earningPaise }
        val monthPaise = monthJobs.sumOf { it.earningPaise }

        val recent = delivered.take(10).map {
            CaptainEarningProjection(
                deliveryId = it.deliveryId,
                orderReference = it.orderReference,
                earningPaise = it.earningPaise,
                totalPaise = it.earningPaise,
                status = "SETTLED",
                completedAt = it.deliveredAt,
            )
        }

        return CaptainEarningsSummary(
            todayPaise = todayPaise,
            todayDeliveryCount = todayJobs.size,
            thisWeekPaise = weekPaise,
            thisMonthPaise = monthPaise,
            recentEarnings = recent,
            settlements = emptyList(),
        )
    }

    override fun getDeliveryHistory(captainId: UUID): List<CaptainDeliveryHistoryItem> {
        return emptyList()
    }
}

class CaptainEarningsService(
    private val persistence: CaptainEarningsPersistence,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun getSummary(captainId: UUID): CaptainEarningsSummary {
        val now = clock.instant()
        val today = LocalDate.ofInstant(now, ZoneOffset.UTC)
        val todayStart = today.atStartOfDay().toInstant(ZoneOffset.UTC)
        val weekStart = today.minusDays(today.dayOfWeek.value.toLong() - 1).atStartOfDay().toInstant(ZoneOffset.UTC)
        val monthStart = today.withDayOfMonth(1).atStartOfDay().toInstant(ZoneOffset.UTC)

        return persistence.getSummary(captainId, todayStart, weekStart, monthStart)
    }

    fun getDeliveryHistory(captainId: UUID): List<CaptainDeliveryHistoryItem> {
        return persistence.getDeliveryHistory(captainId)
    }
}
