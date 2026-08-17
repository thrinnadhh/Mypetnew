package `in`.mypetnew.application

import org.springframework.beans.factory.SmartInitializingSingleton
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.core.env.Environment
import java.net.URI

@Configuration
@Profile("staging")
class StagingRuntimeConfiguration {
    @Bean
    fun stagingRuntimeGuard(environment: Environment): SmartInitializingSingleton =
        SmartInitializingSingleton {
            validateStagingRuntime(
                StagingRuntimeSettings(
                    activeProfiles = environment.activeProfiles.toSet(),
                    datasourceUrl = environment.getProperty("spring.datasource.url").orEmpty(),
                    supabaseUrl = environment.getProperty("mypet.supabase.storage.url").orEmpty(),
                    runtimeEnvironment = environment.getProperty("mypet.firebase.environment").orEmpty(),
                    cashfreeEnabled = environment.getProperty("mypet.cashfree.enabled", Boolean::class.java, false),
                    cashfreeBaseUrl = environment.getProperty("mypet.cashfree.base-url").orEmpty(),
                    cashfreeReturnUrl = environment.getProperty("mypet.cashfree.return-url").orEmpty(),
                    cashfreeNotifyUrl = environment.getProperty("mypet.cashfree.notify-url").orEmpty(),
                ),
            )
        }
}

internal data class StagingRuntimeSettings(
    val activeProfiles: Set<String>,
    val datasourceUrl: String,
    val supabaseUrl: String,
    val runtimeEnvironment: String,
    val cashfreeEnabled: Boolean,
    val cashfreeBaseUrl: String,
    val cashfreeReturnUrl: String,
    val cashfreeNotifyUrl: String,
)

internal fun validateStagingRuntime(settings: StagingRuntimeSettings) {
    require("staging" in settings.activeProfiles) { "The staging runtime guard requires the staging profile" }
    val incompatibleProfiles = settings.activeProfiles.intersect(setOf("test", "development", "device"))
    require(incompatibleProfiles.isEmpty()) {
        "The staging profile cannot be combined with ${incompatibleProfiles.sorted().joinToString(", ")}"
    }

    require(settings.datasourceUrl.startsWith("jdbc:postgresql://") && !settings.datasourceUrl.contains("example", true)) {
        "Staging requires a non-placeholder PostgreSQL JDBC DATABASE_URL"
    }
    require(settings.supabaseUrl.startsWith("https://") && !settings.supabaseUrl.contains("replace", true)) {
        "Staging requires a non-placeholder HTTPS SUPABASE_URL"
    }
    require(settings.runtimeEnvironment == "staging") {
        "MYPET_ENVIRONMENT must be staging when SPRING_PROFILES_ACTIVE=staging"
    }

    require(settings.cashfreeBaseUrl.trimEnd('/') == CASHFREE_SANDBOX_BASE_URL) {
        "Staging must use the Cashfree sandbox endpoint"
    }

    if (settings.cashfreeEnabled) {
        requirePublicHttps("CASHFREE_RETURN_URL", settings.cashfreeReturnUrl)
        val notify = requirePublicHttps("CASHFREE_NOTIFY_URL", settings.cashfreeNotifyUrl)
        require(notify.path == CASHFREE_WEBHOOK_PATH && notify.query == null && notify.fragment == null) {
            "CASHFREE_NOTIFY_URL must end at $CASHFREE_WEBHOOK_PATH without query or fragment"
        }
    }
}

private fun requirePublicHttps(name: String, value: String): URI {
    val uri = runCatching { URI.create(value) }
        .getOrElse { throw IllegalArgumentException("$name is invalid") }
    require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) {
        "$name must be an absolute HTTPS URL in staging"
    }
    val host = uri.host.lowercase()
    require(host !in setOf("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]") && !host.endsWith(".example.com")) {
        "$name must use a public non-placeholder HTTPS host in staging"
    }
    require(uri.userInfo == null) { "$name must not contain user-info credentials" }
    return uri
}

private const val CASHFREE_SANDBOX_BASE_URL = "https://sandbox.cashfree.com/pg"
private const val CASHFREE_WEBHOOK_PATH = "/api/v1/webhooks/cashfree/payments"
