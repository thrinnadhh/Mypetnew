package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.common.scheduling.PostgresScheduledJobLock
import `in`.mypetnew.common.scheduling.ScheduledJobNames
import `in`.mypetnew.delivery.domain.DispatchService
import org.springframework.context.annotation.Profile
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
@Profile("!test & !development")
class DispatchRetryScheduler(
    private val dispatch: DispatchService,
    private val schedulerLock: PostgresScheduledJobLock,
) {
    @Scheduled(fixedDelayString = "\${mypet.delivery.dispatch-retry-millis:5000}")
    fun retry() {
        schedulerLock.runIfAcquired(ScheduledJobNames.DELIVERY_DISPATCH_RETRY) {
            dispatch.retryPendingDispatches()
        }
    }
}
