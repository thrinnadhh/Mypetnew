package `in`.mypetnew.recurring.infrastructure

import `in`.mypetnew.common.scheduling.PostgresScheduledJobLock
import `in`.mypetnew.common.scheduling.ScheduledJobNames
import `in`.mypetnew.recurring.domain.RecurringOrderService
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Configuration
@Profile("!test & !development")
@EnableScheduling
class RecurringOrderSchedulingConfiguration

@Component
@Profile("!test & !development")
class RecurringOrderScheduler(
    private val recurringOrders: RecurringOrderService,
    private val schedulerLock: PostgresScheduledJobLock,
) {
    @Scheduled(fixedDelayString = "\${mypet.recurring.scheduler-delay-ms:60000}")
    fun processDueCycles() {
        schedulerLock.runIfAcquired(ScheduledJobNames.RECURRING_ORDERS) {
            recurringOrders.runScheduler()
        }
    }
}
