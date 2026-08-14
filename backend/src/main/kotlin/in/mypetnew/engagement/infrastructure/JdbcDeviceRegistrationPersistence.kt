package `in`.mypetnew.engagement.infrastructure

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.engagement.domain.AppKind
import `in`.mypetnew.engagement.domain.DeviceRegistration
import `in`.mypetnew.engagement.domain.DeviceRegistrationPersistence
import `in`.mypetnew.engagement.domain.Platform
import `in`.mypetnew.engagement.domain.RegistrationStatus
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import org.springframework.transaction.support.TransactionTemplate

@ConfigurationProperties("mypet.notifications")
data class NotificationSecurityProperties(val deviceTokenEncryptionKey: String) {
    val decodedKey: ByteArray = runCatching { Base64.getDecoder().decode(deviceTokenEncryptionKey) }.getOrDefault(byteArrayOf())

    init {
        require(decodedKey.size == 32) { "MYPET_DEVICE_TOKEN_KEY must be a base64-encoded 256-bit key" }
    }

    override fun toString(): String = "NotificationSecurityProperties(deviceTokenEncryptionKey=[REDACTED])"
}

class DeviceTokenCipher(private val key: ByteArray, private val random: SecureRandom = SecureRandom()) {
    fun encrypt(token: String): String {
        val nonce = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        val encrypted = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
        return Base64.getEncoder().encodeToString(ByteBuffer.allocate(nonce.size + encrypted.size).put(nonce).put(encrypted).array())
    }

    fun decrypt(protectedToken: String): String {
        val combined = runCatching { Base64.getDecoder().decode(protectedToken) }.getOrElse { invalidCiphertext() }
        if (combined.size <= 28) invalidCiphertext()
        val nonce = combined.copyOfRange(0, 12)
        val encrypted = combined.copyOfRange(12, combined.size)
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
        }.getOrElse { invalidCiphertext() }
    }

    private fun invalidCiphertext(): Nothing = throw DomainException(
        "DEVICE_TOKEN_UNAVAILABLE",
        "The protected device token is unavailable",
    )
}

@Repository
@Profile("!test & !development")
class JdbcDeviceRegistrationPersistence(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
    private val tokens: DeviceTokenCipher,
    private val clock: Clock = Clock.systemUTC(),
) : DeviceRegistrationPersistence {
    override fun register(
        userId: UUID,
        role: Role,
        sessionId: UUID,
        appKind: AppKind,
        platform: Platform,
        installationId: UUID,
        token: String,
        environment: String,
    ): DeviceRegistration = transaction.execute {
        lockBinding(environment, appKind, installationId)
        requireOwner(userId, environment, appKind, installationId)
        val now = clock.instant()
        val fingerprint = fingerprint(token)
        jdbc.sql(
            """
            UPDATE mypet.device_registration SET status = 'ROTATED', updated_at = :now
            WHERE environment = :environment AND app_kind = :app_kind
              AND installation_id = :installation_id AND status = 'ACTIVE'
            """.trimIndent(),
        ).params(bindingParameters(environment, appKind, installationId)).param("now", now).update()
        val existing = findExact(userId, environment, appKind, installationId, fingerprint)
        if (existing != null) {
            jdbc.sql(
                """
                UPDATE mypet.device_registration
                SET platform = :platform, role = :role, session_id = :session_id,
                    protected_token = :protected_token, permission_state = 'GRANTED', status = 'ACTIVE',
                    last_seen_at = :now, updated_at = :now
                WHERE id = :id
                """.trimIndent(),
            ).param("platform", platform.name)
                .param("role", role.name)
                .param("session_id", sessionId)
                .param("protected_token", tokens.encrypt(token))
                .param("now", now)
                .param("id", existing.id)
                .update()
            return@execute existing.copy(platform = platform, status = RegistrationStatus.ACTIVE, lastSeenAt = now)
        }
        val registration = DeviceRegistration(
            UUID.randomUUID(),
            userId,
            appKind,
            platform,
            installationId,
            environment,
            fingerprint,
            RegistrationStatus.ACTIVE,
            now,
        )
        insert(registration, role, sessionId, tokens.encrypt(token), "GRANTED")
        registration
    }

    override fun recordPermissionDenied(
        userId: UUID,
        role: Role,
        sessionId: UUID,
        appKind: AppKind,
        platform: Platform,
        installationId: UUID,
        environment: String,
    ): DeviceRegistration = transaction.execute {
        lockBinding(environment, appKind, installationId)
        requireOwner(userId, environment, appKind, installationId)
        val now = clock.instant()
        jdbc.sql(
            """
            UPDATE mypet.device_registration SET status = 'DISABLED', permission_state = 'DENIED', updated_at = :now
            WHERE environment = :environment AND app_kind = :app_kind AND installation_id = :installation_id
            """.trimIndent(),
        ).params(bindingParameters(environment, appKind, installationId)).param("now", now).update()
        val existing = findExact(userId, environment, appKind, installationId, "permission-denied")
        if (existing != null) {
            jdbc.sql(
                "UPDATE mypet.device_registration SET last_seen_at = :now, updated_at = :now WHERE id = :id",
            ).param("now", now).param("id", existing.id).update()
            return@execute existing.copy(status = RegistrationStatus.DISABLED, lastSeenAt = now)
        }
        val registration = DeviceRegistration(
            UUID.randomUUID(),
            userId,
            appKind,
            platform,
            installationId,
            environment,
            "permission-denied",
            RegistrationStatus.DISABLED,
            now,
        )
        insert(registration, role, sessionId, "", "DENIED")
        registration
    }

    override fun activeFor(userId: UUID): List<DeviceRegistration> = jdbc.sql(
        """
        SELECT id, user_id, app_kind, platform, installation_id, environment,
               token_fingerprint, status, last_seen_at
        FROM mypet.device_registration WHERE user_id = :user_id AND status = 'ACTIVE'
        """.trimIndent(),
    ).param("user_id", userId).query(::mapRegistration).list()

    override fun revoke(
        userId: UUID,
        appKind: AppKind,
        installationId: UUID,
        environment: String,
    ): Boolean = transaction.execute {
        lockBinding(environment, appKind, installationId)
        requireOwner(userId, environment, appKind, installationId)
        val now = clock.instant()
        val updated = jdbc.sql(
            """
            UPDATE mypet.device_registration
            SET status = 'REVOKED', updated_at = :now
            WHERE user_id = :user_id AND environment = :environment
              AND app_kind = :app_kind AND installation_id = :installation_id
              AND status <> 'REVOKED'
            """.trimIndent(),
        ).param("user_id", userId)
            .params(bindingParameters(environment, appKind, installationId))
            .param("now", now)
            .update()
        updated > 0
    }

    private fun findExact(
        userId: UUID,
        environment: String,
        appKind: AppKind,
        installationId: UUID,
        fingerprint: String,
    ): DeviceRegistration? = jdbc.sql(
        """
        SELECT id, user_id, app_kind, platform, installation_id, environment,
               token_fingerprint, status, last_seen_at
        FROM mypet.device_registration
        WHERE user_id = :user_id AND environment = :environment AND app_kind = :app_kind
          AND installation_id = :installation_id AND token_fingerprint = :fingerprint
        """.trimIndent(),
    ).param("user_id", userId)
        .params(bindingParameters(environment, appKind, installationId))
        .param("fingerprint", fingerprint)
        .query(::mapRegistration)
        .optional()
        .orElse(null)

    private fun insert(
        registration: DeviceRegistration,
        role: Role,
        sessionId: UUID,
        protectedToken: String,
        permissionState: String,
    ) {
        jdbc.sql(
            """
            INSERT INTO mypet.device_registration(
                id, environment, app_kind, installation_id, platform, user_id, role, session_id,
                protected_token, token_fingerprint, permission_state, status, last_seen_at
            ) VALUES (
                :id, :environment, :app_kind, :installation_id, :platform, :user_id, :role, :session_id,
                :protected_token, :token_fingerprint, :permission_state, :status, :last_seen_at
            )
            """.trimIndent(),
        ).param("id", registration.id)
            .param("environment", registration.environment)
            .param("app_kind", registration.appKind.name)
            .param("installation_id", registration.installationId)
            .param("platform", registration.platform.name)
            .param("user_id", registration.userId)
            .param("role", role.name)
            .param("session_id", sessionId)
            .param("protected_token", protectedToken)
            .param("token_fingerprint", registration.tokenFingerprint)
            .param("permission_state", permissionState)
            .param("status", registration.status.name)
            .param("last_seen_at", registration.lastSeenAt)
            .update()
    }

    private fun requireOwner(userId: UUID, environment: String, appKind: AppKind, installationId: UUID) {
        val foreign = jdbc.sql(
            """
            SELECT COUNT(*) FROM mypet.device_registration
            WHERE environment = :environment AND app_kind = :app_kind
              AND installation_id = :installation_id AND user_id <> :user_id
            """.trimIndent(),
        ).params(bindingParameters(environment, appKind, installationId))
            .param("user_id", userId)
            .query(Int::class.java)
            .single()
        if (foreign > 0) invalidRegistration()
    }

    private fun lockBinding(environment: String, appKind: AppKind, installationId: UUID) {
        val binding = "$environment:${appKind.name}:$installationId"
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtextextended(:binding, 0))")
            .param("binding", binding)
            .query { _, _ -> true }
            .single()
    }

    private fun bindingParameters(
        environment: String,
        appKind: AppKind,
        installationId: UUID,
    ): Map<String, Any> = mapOf(
        "environment" to environment,
        "app_kind" to appKind.name,
        "installation_id" to installationId,
    )

    private fun mapRegistration(rows: ResultSet, rowNumber: Int): DeviceRegistration {
        require(rowNumber >= 0)
        return DeviceRegistration(
            id = rows.getObject("id", UUID::class.java),
            userId = rows.getObject("user_id", UUID::class.java),
            appKind = AppKind.valueOf(rows.getString("app_kind")),
            platform = Platform.valueOf(rows.getString("platform")),
            installationId = rows.getObject("installation_id", UUID::class.java),
            environment = rows.getString("environment"),
            tokenFingerprint = rows.getString("token_fingerprint"),
            status = RegistrationStatus.valueOf(rows.getString("status")),
            lastSeenAt = rows.getTimestamp("last_seen_at").toInstant(),
        )
    }

    private fun fingerprint(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray(StandardCharsets.UTF_8))
        .take(8)
        .joinToString("") { "%02x".format(it) }

    private fun invalidRegistration(): Nothing = throw DomainException(
        "DEVICE_REGISTRATION_INVALID",
        "The device registration is invalid",
    )
}

@Configuration
@Profile("!test & !development")
@EnableConfigurationProperties(NotificationSecurityProperties::class)
class NotificationSecurityConfiguration {
    @Bean fun deviceTokenCipher(properties: NotificationSecurityProperties) = DeviceTokenCipher(properties.decodedKey)
}
