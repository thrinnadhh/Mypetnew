package `in`.mypetnew.recurring.infrastructure

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
) {
    @Scheduled(fixedDelayString = "\${mypet.recurring.scheduler-delay-ms:60000}")
    fun processDueCycles() {
        recurringOrders.runScheduler()
    }
}
