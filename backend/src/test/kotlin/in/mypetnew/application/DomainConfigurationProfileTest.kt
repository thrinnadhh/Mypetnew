package `in`.mypetnew.application

import `in`.mypetnew.engagement.domain.InMemoryNotificationRepository
import `in`.mypetnew.engagement.domain.NotificationRepository
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.identity.infrastructure.ConsoleOtpProvider
import `in`.mypetnew.identity.infrastructure.StagingUnavailableOtpProvider
import `in`.mypetnew.privacy.domain.InMemoryPrivacyRepository
import `in`.mypetnew.privacy.domain.PrivacyRepository
import `in`.mypetnew.identity.domain.InMemorySessionStore
import `in`.mypetnew.identity.domain.SessionStore
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.NoSuchBeanDefinitionException
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile

class DomainConfigurationProfileTest {

    @Configuration
    open class TestStubsConfiguration {
        @Bean
        @ConditionalOnMissingBean(NotificationRepository::class)
        open fun fallbackNotificationRepository(): NotificationRepository = InMemoryNotificationRepository()

        @Bean
        @ConditionalOnMissingBean(PrivacyRepository::class)
        open fun fallbackPrivacyRepository(): PrivacyRepository = InMemoryPrivacyRepository()

        @Bean
        @ConditionalOnMissingBean(SessionStore::class)
        open fun fallbackSessionStore(): SessionStore = InMemorySessionStore()
    }

    private val contextRunner = ApplicationContextRunner()
        .withUserConfiguration(DomainConfiguration::class.java, TestStubsConfiguration::class.java)

    @Test
    fun `DomainConfiguration otpProvider has explicit allowlisted profiles matching security policy`() {
        val otpMethod = DomainConfiguration::class.java.getDeclaredMethod("otpProvider")
        val profileAnn = otpMethod.getAnnotation(Profile::class.java)
        assertThat(profileAnn).isNotNull
        assertThat(profileAnn.value).containsExactlyInAnyOrder("test", "development", "local-isolated")

        val deviceMethod = DomainConfiguration::class.java.getDeclaredMethod("deviceOtpProvider")
        val deviceAnn = deviceMethod.getAnnotation(Profile::class.java)
        assertThat(deviceAnn).isNotNull
        assertThat(deviceAnn.value).containsExactly("device")

        val stagingMethod = DomainConfiguration::class.java.getDeclaredMethod("stagingOtpProvider")
        val stagingAnn = stagingMethod.getAnnotation(Profile::class.java)
        assertThat(stagingAnn).isNotNull
        assertThat(stagingAnn.value).containsExactly("staging")
    }

    @Test
    fun `test profile activates InMemoryOtpProvider`() {
        contextRunner.withPropertyValues("spring.profiles.active=test").run { context ->
            assertThat(context).hasSingleBean(OtpProvider::class.java)
            assertThat(context.getBean(OtpProvider::class.java)).isInstanceOf(InMemoryOtpProvider::class.java)
        }
    }

    @Test
    fun `development profile activates InMemoryOtpProvider`() {
        contextRunner.withPropertyValues("spring.profiles.active=development").run { context ->
            assertThat(context).hasSingleBean(OtpProvider::class.java)
            assertThat(context.getBean(OtpProvider::class.java)).isInstanceOf(InMemoryOtpProvider::class.java)
        }
    }

    @Test
    fun `local-isolated profile activates InMemoryOtpProvider`() {
        contextRunner.withPropertyValues("spring.profiles.active=local-isolated").run { context ->
            assertThat(context).hasSingleBean(OtpProvider::class.java)
            assertThat(context.getBean(OtpProvider::class.java)).isInstanceOf(InMemoryOtpProvider::class.java)
        }
    }

    @Test
    fun `device profile activates ConsoleOtpProvider`() {
        contextRunner.withPropertyValues("spring.profiles.active=device").run { context ->
            assertThat(context).hasSingleBean(OtpProvider::class.java)
            assertThat(context.getBean(OtpProvider::class.java)).isInstanceOf(ConsoleOtpProvider::class.java)
        }
    }

    @Test
    fun `staging profile activates StagingUnavailableOtpProvider`() {
        contextRunner.withPropertyValues("spring.profiles.active=staging").run { context ->
            assertThat(context).hasSingleBean(OtpProvider::class.java)
            assertThat(context.getBean(OtpProvider::class.java)).isInstanceOf(StagingUnavailableOtpProvider::class.java)
        }
    }

    @Test
    fun `production profile does NOT activate InMemoryOtpProvider and refuses to boot without real provider`() {
        contextRunner.withPropertyValues("spring.profiles.active=production").run { context ->
            assertThat(context).hasFailed()
            assertThat(context.startupFailure).hasRootCauseInstanceOf(NoSuchBeanDefinitionException::class.java)
        }
    }

    @Test
    fun `prod profile does NOT activate InMemoryOtpProvider and refuses to boot without real provider`() {
        contextRunner.withPropertyValues("spring.profiles.active=prod").run { context ->
            assertThat(context).hasFailed()
            assertThat(context.startupFailure).hasRootCauseInstanceOf(NoSuchBeanDefinitionException::class.java)
        }
    }

    @Test
    fun `default unconfigured profile does NOT activate InMemoryOtpProvider and refuses to boot without real provider`() {
        contextRunner.run { context ->
            assertThat(context).hasFailed()
            assertThat(context.startupFailure).hasRootCauseInstanceOf(NoSuchBeanDefinitionException::class.java)
        }
    }

    @Test
    fun `unknown random profile does NOT activate InMemoryOtpProvider and refuses to boot without real provider`() {
        contextRunner.withPropertyValues("spring.profiles.active=unknown-random-profile").run { context ->
            assertThat(context).hasFailed()
            assertThat(context.startupFailure).hasRootCauseInstanceOf(NoSuchBeanDefinitionException::class.java)
        }
    }
}
