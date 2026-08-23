package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.delivery.domain.CaptainDeliveryHistoryItem
import `in`.mypetnew.delivery.domain.CaptainEarningProjection
import `in`.mypetnew.delivery.domain.CaptainEarningsPersistence
import `in`.mypetnew.delivery.domain.CaptainEarningsSummary
import org.springframework.jdbc.core.JdbcTemplate
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

class JdbcCaptainEarningsPersistence(
    private val jdbc: JdbcTemplate,
    private val defaultDeliveryFeePaise: Long = 2500,
) : CaptainEarningsPersistence {
    override fun getSummary(
        captainId: UUID,
        todayStart: Instant,
        weekStart: Instant,
        monthStart: Instant,
    ): CaptainEarningsSummary {
        val history = getDeliveryHistory(captainId)
        val todayJobs = history.filter { it.deliveredAt.isAfter(todayStart) || it.deliveredAt == todayStart }
        val weekJobs = history.filter { it.deliveredAt.isAfter(weekStart) || it.deliveredAt == weekStart }
        val monthJobs = history.filter { it.deliveredAt.isAfter(monthStart) || it.deliveredAt == monthStart }

        val todayPaise = todayJobs.sumOf { it.earningPaise }
        val weekPaise = weekJobs.sumOf { it.earningPaise }
        val monthPaise = monthJobs.sumOf { it.earningPaise }

        val recentEarnings = history.take(20).map {
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
            recentEarnings = recentEarnings,
            settlements = emptyList(),
        )
    }

    override fun getDeliveryHistory(captainId: UUID): List<CaptainDeliveryHistoryItem> = jdbc.query(
        """
        SELECT j.id AS delivery_id,
               j.order_id,
               o.order_number,
               p.name AS merchant_name,
               j.delivered_at,
               COALESCE(q.delivery_fee_paise, ?) AS earning_paise,
               j.status
        FROM mypet.dispatch_job j
        JOIN mypet.product_order o ON o.id = j.order_id
        JOIN mypet.provider_outlet p ON p.id = j.outlet_id
        LEFT JOIN mypet.commerce_quote q ON q.id = o.quote_id
        WHERE j.assigned_captain_id = ?
          AND j.status = 'DELIVERED'
          AND j.delivered_at IS NOT NULL
        ORDER BY j.delivered_at DESC
        """.trimIndent(),
        { rs, _ ->
            CaptainDeliveryHistoryItem(
                deliveryId = rs.getObject("delivery_id", UUID::class.java),
                orderId = rs.getObject("order_id", UUID::class.java),
                orderReference = rs.getString("order_number") ?: "MP-${rs.getObject("order_id", UUID::class.java).toString().take(8).uppercase()}",
                merchantName = rs.getString("merchant_name") ?: "Merchant Store",
                deliveredAt = rs.getTimestamp("delivered_at").toInstant(),
                earningPaise = rs.getLong("earning_paise"),
                status = rs.getString("status"),
            )
        },
        defaultDeliveryFeePaise,
        captainId,
    )
}
