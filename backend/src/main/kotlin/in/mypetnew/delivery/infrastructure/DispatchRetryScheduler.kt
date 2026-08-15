package `in`.mypetnew.delivery.infrastructure

import `in`.mypetnew.delivery.domain.DispatchService
import org.springframework.context.annotation.Profile
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
@Profile("!test & !development")
class DispatchRetryScheduler(private val dispatch: DispatchService) {
    @Scheduled(fixedDelayString = "\${mypet.delivery.dispatch-retry-millis:5000}")
    fun retry() {
        dispatch.retryPendingDispatches()
    }
}
