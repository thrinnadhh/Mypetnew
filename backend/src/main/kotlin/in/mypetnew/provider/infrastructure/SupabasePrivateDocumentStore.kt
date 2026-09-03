package `in`.mypetnew.provider.infrastructure

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.provider.domain.DocumentPurpose
import `in`.mypetnew.provider.domain.DocumentStore
import `in`.mypetnew.provider.domain.PrivateObjectRef
import `in`.mypetnew.provider.domain.SignedDocumentAccess
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.ResultSet
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import tools.jackson.databind.ObjectMapper

data class PrivateDocumentMetadata(
    val id: UUID,
    val organizationId: UUID,
    val outletId: UUID,
    val purpose: DocumentPurpose,
    val objectKey: String,
    val contentType: String,
    val sizeBytes: Long,
    val checksum: String,
)

interface PrivateDocumentMetadataRepository {
    fun save(metadata: PrivateDocumentMetadata)
    fun find(ref: PrivateObjectRef): PrivateDocumentMetadata?
}

class InMemoryPrivateDocumentMetadataRepository : PrivateDocumentMetadataRepository {
    private val records = mutableMapOf<UUID, PrivateDocumentMetadata>()

    @Synchronized
    override fun save(metadata: PrivateDocumentMetadata) {
        check(records.putIfAbsent(metadata.id, metadata) == null) { "Document metadata already exists" }
    }

    @Synchronized
    override fun find(ref: PrivateObjectRef): PrivateDocumentMetadata? = records[ref.value]
}

@Repository
@Profile("!test & !development & !local-isolated")
class JdbcPrivateDocumentMetadataRepository(private val jdbc: JdbcClient) : PrivateDocumentMetadataRepository {
    override fun save(metadata: PrivateDocumentMetadata) {
        jdbc.sql(
            """
            INSERT INTO mypet.private_document(
                id, organization_id, outlet_id, purpose, object_key, content_type, size_bytes, checksum
            ) VALUES (
                :id, :organization_id, :outlet_id, :purpose, :object_key, :content_type, :size_bytes, :checksum
            )
            """.trimIndent(),
        ).param("id", metadata.id)
            .param("organization_id", metadata.organizationId)
            .param("outlet_id", metadata.outletId)
            .param("purpose", metadata.purpose.name)
            .param("object_key", metadata.objectKey)
            .param("content_type", metadata.contentType)
            .param("size_bytes", metadata.sizeBytes)
            .param("checksum", metadata.checksum)
            .update()
    }

    override fun find(ref: PrivateObjectRef): PrivateDocumentMetadata? = jdbc.sql(
        """
        SELECT id, organization_id, outlet_id, purpose, object_key, content_type, size_bytes, checksum
        FROM mypet.private_document WHERE id = :id
        """.trimIndent(),
    ).param("id", ref.value).query(::mapMetadata).optional().orElse(null)

    private fun mapMetadata(rows: ResultSet, rowNumber: Int): PrivateDocumentMetadata {
        require(rowNumber >= 0)
        return PrivateDocumentMetadata(
            id = rows.getObject("id", UUID::class.java),
            organizationId = rows.getObject("organization_id", UUID::class.java),
            outletId = rows.getObject("outlet_id", UUID::class.java),
            purpose = DocumentPurpose.valueOf(rows.getString("purpose")),
            objectKey = rows.getString("object_key"),
            contentType = rows.getString("content_type"),
            sizeBytes = rows.getLong("size_bytes"),
            checksum = rows.getString("checksum"),
        )
    }
}

interface PrivateObjectStorageClient {
    fun upload(objectKey: String, contentType: String, bytes: ByteArray)
    fun delete(objectKey: String)
    fun signRead(objectKey: String, expiresInSeconds: Long): String
}

class SupabasePrivateDocumentStore(
    private val metadata: PrivateDocumentMetadataRepository,
    private val storage: PrivateObjectStorageClient,
    private val clock: Clock = Clock.systemUTC(),
    private val accessLifetime: Duration = Duration.ofMinutes(5),
) : DocumentStore {
    override fun put(
        actor: Principal,
        outletId: UUID,
        filename: String,
        contentType: String,
        bytes: ByteArray,
        purpose: DocumentPurpose,
    ): PrivateObjectRef {
        val organizationId = requireMerchantUpload(actor, outletId)
        validateDocument(filename, contentType, bytes)
        val ref = PrivateObjectRef(UUID.randomUUID())
        val objectKey = "provider-verification/$organizationId/$outletId/${ref.value}"
        storage.upload(objectKey, contentType, bytes)
        try {
            metadata.save(
                PrivateDocumentMetadata(
                    id = ref.value,
                    organizationId = organizationId,
                    outletId = outletId,
                    purpose = purpose,
                    objectKey = objectKey,
                    contentType = contentType,
                    sizeBytes = bytes.size.toLong(),
                    checksum = sha256(bytes),
                ),
            )
        } catch (error: Exception) {
            runCatching { storage.delete(objectKey) }
            throw DomainException("DOCUMENT_STORE_UNAVAILABLE", "The document could not be stored")
        }
        return ref
    }

    override fun authorizeRead(
        actor: Principal,
        ref: PrivateObjectRef,
        purpose: DocumentPurpose,
    ): SignedDocumentAccess {
        val record = metadata.find(ref) ?: deny()
        if (record.purpose != purpose) deny()
        val merchantAllowed = actor.role == Role.MERCHANT &&
            actor.organizationId == record.organizationId &&
            record.outletId in actor.outletIds
        val adminAllowed = actor.role == Role.ADMIN && AdminPermission.PROVIDER_REVIEW in actor.permissions
        if (!merchantAllowed && !adminAllowed) deny()
        val expiresAt = clock.instant().plus(accessLifetime)
        return SignedDocumentAccess(storage.signRead(record.objectKey, accessLifetime.seconds), expiresAt)
    }

    private fun requireMerchantUpload(actor: Principal, outletId: UUID): UUID {
        val organizationId = actor.organizationId
        if (actor.role != Role.MERCHANT || organizationId == null || outletId !in actor.outletIds) deny()
        return organizationId
    }

    private fun validateDocument(filename: String, contentType: String, bytes: ByteArray) {
        if (
            filename.length !in 1..180 ||
            filename.contains("..") ||
            filename.contains('/') ||
            filename.contains('\\') ||
            contentType !in setOf("application/pdf", "image/jpeg", "image/png") ||
            bytes.isEmpty() ||
            bytes.size > 10 * 1024 * 1024
        ) {
            throw DomainException("DOCUMENT_INVALID", "The document cannot be accepted")
        }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun deny(): Nothing = throw DomainException("RESOURCE_NOT_FOUND", "The requested resource is unavailable")
}

@ConfigurationProperties("mypet.supabase.storage")
data class SupabaseStorageProperties(
    val url: String,
    val serviceKey: String,
    val privateBucket: String,
) {
    init {
        require(url.startsWith("https://")) { "Supabase Storage URL must use HTTPS" }
        require(serviceKey.length >= 32) { "Supabase server credential is missing" }
        require(privateBucket.matches(Regex("[a-z0-9][a-z0-9-]{2,62}"))) { "Private bucket name is invalid" }
    }

    override fun toString(): String =
        "SupabaseStorageProperties(url=$url, serviceKey=[REDACTED], privateBucket=$privateBucket)"
}

class SupabaseStorageHttpClient(
    private val properties: SupabaseStorageProperties,
    private val json: ObjectMapper,
    private val http: HttpClient = HttpClient.newHttpClient(),
) : PrivateObjectStorageClient {
    override fun upload(objectKey: String, contentType: String, bytes: ByteArray) {
        val request = request("/storage/v1/object/${path(properties.privateBucket)}/${path(objectKey)}")
            .header("Content-Type", contentType)
            .header("x-upsert", "false")
            .POST(HttpRequest.BodyPublishers.ofByteArray(bytes))
            .build()
        requireSuccess(send(request))
    }

    override fun delete(objectKey: String) {
        val body = json.writeValueAsBytes(mapOf("prefixes" to listOf(objectKey)))
        val request = request("/storage/v1/object/${path(properties.privateBucket)}")
            .header("Content-Type", "application/json")
            .method("DELETE", HttpRequest.BodyPublishers.ofByteArray(body))
            .build()
        requireSuccess(send(request))
    }

    override fun signRead(objectKey: String, expiresInSeconds: Long): String {
        val body = json.writeValueAsBytes(mapOf("expiresIn" to expiresInSeconds))
        val request = request("/storage/v1/object/sign/${path(properties.privateBucket)}/${path(objectKey)}")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofByteArray(body))
            .build()
        val response = send(request)
        requireSuccess(response)
        val signedUrl = runCatching { json.readTree(response.body()).path("signedURL").asString() }
            .getOrDefault("")
        if (!signedUrl.startsWith('/')) unavailable()
        val prefix = if (signedUrl.startsWith("/storage/v1/")) "" else "/storage/v1"
        return properties.url.trimEnd('/') + prefix + signedUrl
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
        "DOCUMENT_STORE_UNAVAILABLE",
        "The document store is temporarily unavailable",
    )
}

@Configuration
@Profile("!test & !development & !local-isolated")
@EnableConfigurationProperties(SupabaseStorageProperties::class)
class SupabaseStorageConfiguration {
    @Bean
    fun privateObjectStorageClient(properties: SupabaseStorageProperties, json: ObjectMapper): PrivateObjectStorageClient =
        SupabaseStorageHttpClient(properties, json)

    @Bean
    fun documentStore(
        metadata: PrivateDocumentMetadataRepository,
        storage: PrivateObjectStorageClient,
    ): DocumentStore = SupabasePrivateDocumentStore(metadata, storage)
}
