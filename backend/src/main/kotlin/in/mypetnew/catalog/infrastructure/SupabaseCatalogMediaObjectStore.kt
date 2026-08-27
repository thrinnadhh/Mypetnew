package `in`.mypetnew.catalog.infrastructure

import `in`.mypetnew.catalog.domain.CatalogMediaObjectStore
import `in`.mypetnew.common.error.DomainException
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import tools.jackson.databind.ObjectMapper

@ConfigurationProperties("mypet.supabase.catalog-media")
data class CatalogMediaStorageProperties(
    val url: String,
    val serviceKey: String,
    val bucket: String = "catalog-media",
) {
    init {
        require(url.startsWith("https://")) { "Supabase catalog media URL must use HTTPS" }
        require(serviceKey.length >= 32) { "Supabase server credential is missing" }
        require(bucket.matches(Regex("[a-z0-9][a-z0-9-]{2,62}"))) { "Catalog media bucket name is invalid" }
    }

    override fun toString(): String =
        "CatalogMediaStorageProperties(url=$url, serviceKey=[REDACTED], bucket=$bucket)"
}

class SupabaseCatalogMediaObjectStore(
    private val properties: CatalogMediaStorageProperties,
    private val json: ObjectMapper,
    private val http: HttpClient = HttpClient.newHttpClient(),
) : CatalogMediaObjectStore {
    override fun upload(objectKey: String, contentType: String, bytes: ByteArray): String {
        val request = request("/storage/v1/object/${path(properties.bucket)}/${path(objectKey)}")
            .header("Content-Type", contentType)
            .header("x-upsert", "false")
            .POST(HttpRequest.BodyPublishers.ofByteArray(bytes))
            .build()
        requireSuccess(send(request))
        return properties.url.trimEnd('/') +
            "/storage/v1/object/public/${path(properties.bucket)}/${path(objectKey)}"
    }

    override fun delete(objectKey: String) {
        val body = json.writeValueAsBytes(mapOf("prefixes" to listOf(objectKey)))
        val request = request("/storage/v1/object/${path(properties.bucket)}")
            .header("Content-Type", "application/json")
            .method("DELETE", HttpRequest.BodyPublishers.ofByteArray(body))
            .build()
        val response = send(request)
        if (response.statusCode() !in 200..299 && response.statusCode() != 404) unavailable()
    }

    private fun request(relativePath: String): HttpRequest.Builder = HttpRequest.newBuilder()
        .uri(URI.create(properties.url.trimEnd('/') + relativePath))
        .header("Authorization", "Bearer ${properties.serviceKey}")
        .header("apikey", properties.serviceKey)
        .header("Accept", "application/json")

    private fun send(request: HttpRequest): HttpResponse<ByteArray> = try {
        http.send(request, HttpResponse.BodyHandlers.ofByteArray())
    } catch (interrupted: InterruptedException) {
        Thread.currentThread().interrupt()
        unavailable()
    } catch (error: Exception) {
        unavailable()
    }

    private fun requireSuccess(response: HttpResponse<ByteArray>) {
        if (response.statusCode() !in 200..299) unavailable()
    }

    private fun path(value: String): String = value.split('/').joinToString("/") {
        URLEncoder.encode(it, StandardCharsets.UTF_8).replace("+", "%20")
    }

    private fun unavailable(): Nothing = throw DomainException(
        "CATALOG_MEDIA_STORE_UNAVAILABLE",
        "Catalog media storage is temporarily unavailable",
    )
}

@Configuration
@Profile("!test & !development")
@EnableConfigurationProperties(CatalogMediaStorageProperties::class)
class CatalogMediaStorageConfiguration {
    @Bean
    fun catalogMediaObjectStore(
        properties: CatalogMediaStorageProperties,
        json: ObjectMapper,
    ): CatalogMediaObjectStore = SupabaseCatalogMediaObjectStore(properties, json)
}
