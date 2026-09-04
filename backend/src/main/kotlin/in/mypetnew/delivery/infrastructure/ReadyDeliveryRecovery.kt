package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.commerce.domain.OrderService
import `in`.mypetnew.common.scheduling.PostgresScheduledJobLock
import `in`.mypetnew.common.scheduling.ScheduledJobNames
import `in`.mypetnew.delivery.domain.DispatchService
import `in`.mypetnew.provider.domain.ProviderService
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.util.UUID

@Component
@Profile("!test & !development")
class ReadyDeliveryRecovery(
    private val jdbc: JdbcTemplate,
    private val orders: OrderService,
    private val providers: ProviderService,
    private val dispatch: DispatchService,
    private val schedulerLock: PostgresScheduledJobLock,
) {
    @Scheduled(fixedDelayString = "\${mypet.delivery.ready-recovery-millis:5000}")
    fun recover() {
        schedulerLock.runIfAcquired(ScheduledJobNames.DELIVERY_READY_RECOVERY) {
            val orphanOrderIds = jdbc.query(
                """
                SELECT o.id
                FROM mypet.product_order o
                LEFT JOIN mypet.dispatch_job d ON d.order_id = o.id
                WHERE o.fulfilment_mode = 'MYPET_CAPTAIN_DELIVERY'
                  AND o.status = 'READY_FOR_PICKUP'
                  AND d.id IS NULL
                ORDER BY o.updated_at, o.id
                LIMIT 100
                """.trimIndent(),
                { result, _ -> result.getObject("id", UUID::class.java) },
            )
            orphanOrderIds.forEach { orderId ->
                runCatching {
                    val order = orders.get(orderId)
                    val outlet = providers.getOutlet(order.outletId)
                    val latitude = requireNotNull(outlet.latitude) { "Delivery outlet is missing dispatch latitude" }
                    val longitude = requireNotNull(outlet.longitude) { "Delivery outlet is missing dispatch longitude" }
                    dispatch.start(order, latitude, longitude)
                }
            }
        }
    }
}
