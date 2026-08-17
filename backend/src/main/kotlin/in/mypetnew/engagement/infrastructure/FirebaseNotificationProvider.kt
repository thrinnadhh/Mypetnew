package `in`.mypetnew.engagement.infrastructure

import com.google.auth.oauth2.GoogleCredentials
import `in`.mypetnew.engagement.domain.NotificationProvider
import `in`.mypetnew.engagement.domain.ProviderDeliveryResult
import `in`.mypetnew.engagement.domain.PushDeliveryCommand
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import tools.jackson.databind.ObjectMapper

fun interface FcmAccessTokenProvider {
    fun accessToken(): String
}

class GoogleApplicationDefaultAccessTokenProvider(credentials: GoogleCredentials) : FcmAccessTokenProvider {
    private val scoped = credentials.createScoped("https://www.googleapis.com/auth/firebase.messaging")

    @Synchronized
    override fun accessToken(): String {
        scoped.refreshIfExpired()
        return scoped.accessToken?.tokenValue ?: error("Google application credentials did not issue an access token")
    }

    companion object {
        fun create(): GoogleApplicationDefaultAccessTokenProvider =
            GoogleApplicationDefaultAccessTokenProvider(GoogleCredentials.getApplicationDefault())
    }
}

data class FcmHttpResponse(val status: Int, val body: String)

fun interface FcmTransport {
    fun send(projectId: String, accessToken: String, body: String): FcmHttpResponse
}

class JavaFcmTransport(private val http: HttpClient = HttpClient.newHttpClient()) : FcmTransport {
    override fun send(projectId: String, accessToken: String, body: String): FcmHttpResponse {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("https://fcm.googleapis.com/v1/projects/$projectId/messages:send"))
            .header("Authorization", "Bearer $accessToken")
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build()
        val response = try {
            http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        } catch (interrupted: InterruptedException) {
            Thread.currentThread().interrupt()
            throw interrupted
        }
        return FcmHttpResponse(response.statusCode(), response.body())
    }
}

class FirebaseNotificationProvider(
    private val projectId: String,
    private val environment: String,
    private val accessTokens: FcmAccessTokenProvider,
    private val transport: FcmTransport,
    private val json: ObjectMapper,
) : NotificationProvider {
    override fun send(command: PushDeliveryCommand): ProviderDeliveryResult {
        if (command.environment != environment) {
            return ProviderDeliveryResult.PermanentFailure("FCM_ENVIRONMENT_MISMATCH")
        }
        val requestBody = json.writeValueAsString(
            mapOf(
                "message" to mapOf(
                    "token" to command.nativeToken,
                    "notification" to mapOf("title" to command.title, "body" to command.body),
                    "data" to command.data,
                    "android" to mapOf("priority" to "HIGH"),
                ),
            ),
        )
        val response = runCatching {
            transport.send(projectId, accessTokens.accessToken(), requestBody)
        }.getOrElse { return ProviderDeliveryResult.TransientFailure("FCM_TRANSPORT_FAILURE") }
        if (response.status in 200..299) {
            val reference = runCatching { json.readTree(response.body).path("name").asString() }.getOrDefault("")
            return ProviderDeliveryResult.Delivered(reference.take(160))
        }
        if (response.status == 404 && response.body.contains("UNREGISTERED")) {
            return ProviderDeliveryResult.InvalidRegistration("FCM_UNREGISTERED")
        }
        if (response.status == 429 || response.status >= 500) {
            return ProviderDeliveryResult.TransientFailure("FCM_HTTP_${response.status}")
        }
        return ProviderDeliveryResult.PermanentFailure("FCM_HTTP_${response.status}")
    }
}

@ConfigurationProperties("mypet.firebase")
data class FirebaseProperties(val projectId: String, val environment: String) {
    init {
        require(projectId.matches(Regex("[a-z][a-z0-9-]{4,62}"))) { "Firebase project ID is invalid" }
        require(environment in setOf("development", "staging", "production")) { "Firebase environment is invalid" }
    }
}

@Configuration
@Profile("!test & !development")
@EnableConfigurationProperties(FirebaseProperties::class)
class FirebasePropertiesConfiguration

@Configuration
@Profile("!test & !development")
@ConditionalOnProperty(
    prefix = "mypet.notifications.delivery",
    name = ["enabled"],
    havingValue = "true",
    matchIfMissing = true,
)
class FirebaseNotificationConfiguration {
    @Bean fun fcmAccessTokenProvider(): FcmAccessTokenProvider = GoogleApplicationDefaultAccessTokenProvider.create()
    @Bean fun fcmTransport(): FcmTransport = JavaFcmTransport()

    @Bean
    fun notificationProvider(
        properties: FirebaseProperties,
        accessTokens: FcmAccessTokenProvider,
        transport: FcmTransport,
        json: ObjectMapper,
    ): NotificationProvider = FirebaseNotificationProvider(
        properties.projectId,
        properties.environment,
        accessTokens,
        transport,
        json,
    )
}
