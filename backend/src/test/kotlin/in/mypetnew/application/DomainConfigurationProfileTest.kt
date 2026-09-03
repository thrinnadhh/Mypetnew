package `in`.mypetnew.application

import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.identity.infrastructure.ConsoleOtpProvider
import `in`.mypetnew.identity.infrastructure.StagingUnavailableOtpProvider
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile

class DomainConfigurationProfileTest {

    @Configuration
    open class OtpProfileTestConfiguration {
        @Bean
        @Profile("test", "development", "local-isolated")
        open fun otpProvider(): OtpProvider = InMemoryOtpProvider()

        @Bean
        @Profile("device")
        open fun deviceOtpProvider(): OtpProvider = ConsoleOtpProvider()

        @Bean
        @Profile("staging")
        open fun stagingOtpProvider(): OtpProvider = StagingUnavailableOtpProvider()
    }

    private val contextRunner = ApplicationContextRunner()
        .withUserConfiguration(OtpProfileTestConfiguration::class.java)

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
    fun `production profile does NOT activate InMemoryOtpProvider`() {
        contextRunner.withPropertyValues("spring.profiles.active=production").run { context ->
            assertThat(context).doesNotHaveBean(InMemoryOtpProvider::class.java)
        }
    }

    @Test
    fun `prod profile does NOT activate InMemoryOtpProvider`() {
        contextRunner.withPropertyValues("spring.profiles.active=prod").run { context ->
            assertThat(context).doesNotHaveBean(InMemoryOtpProvider::class.java)
        }
    }

    @Test
    fun `default unconfigured profile does NOT activate InMemoryOtpProvider`() {
        contextRunner.run { context ->
            assertThat(context).doesNotHaveBean(InMemoryOtpProvider::class.java)
        }
    }
}
