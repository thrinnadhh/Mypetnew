package `in`.mypetnew.engagement.infrastructure

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner

class NotificationDeliveryConfigurationTest {
    private val contextRunner = ApplicationContextRunner()
        .withUserConfiguration(
            FirebasePropertiesConfiguration::class.java,
            FirebaseNotificationConfiguration::class.java,
            NotificationWorkerConfiguration::class.java,
            NotificationDeliveryScheduler::class.java,
        )
        .withPropertyValues(
            "spring.profiles.active=staging",
            "mypet.firebase.project-id=mypetnew-staging",
            "mypet.firebase.environment=staging",
        )

    @Test
    fun `disabled delivery does not load Google credentials or notification worker`() {
        contextRunner
            .withPropertyValues("mypet.notifications.delivery.enabled=false")
            .run { context ->
                assertThat(context).hasNotFailed()
                assertThat(context).doesNotHaveBean(FcmAccessTokenProvider::class.java)
                assertThat(context).doesNotHaveBean(NotificationDeliveryScheduler::class.java)
            }
    }
}
