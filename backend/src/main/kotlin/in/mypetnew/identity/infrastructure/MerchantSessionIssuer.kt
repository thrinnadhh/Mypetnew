package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.RefreshSession
import `in`.mypetnew.identity.domain.SessionStore
import org.springframework.context.annotation.Primary
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

interface MerchantSessionIssuer {
    fun createMerchant(mobile: String, deviceId: String): RefreshSession
}

@Component
@Primary
@Profile("test", "development")
class InMemoryRoleSessionStore(
    private val clock: Clock = Clock.systemUTC(),
) : SessionStore, MerchantSessionIssuer {
    private data class Stored(
        val sessionId: UUID,
        val accountId: UUID,
        val role: Role,
        val deviceId: String,
        val tokenHash: String,
        val expiresAt: Instant,
        var revokedAt: Instant? = null,
    )

    private val random = SecureRandom()
    private val sessions = mutableMapOf<UUID, Stored>()
    private val byHash = mutableMapOf<String, UUID>()

    @Synchronized
    override fun create(accountId: UUID, mobile: String, role: Role, deviceId: String): RefreshSession {
        validate(mobile, role, deviceId)
        return insert(accountId, role, deviceId)
    }

    override fun createMerchant(mobile: String, deviceId: String): RefreshSession =
        create(UUID.nameUUIDFromBytes(mobile.toByteArray(StandardCharsets.UTF_8)), mobile, Role.MERCHANT, deviceId)

    @Synchronized
    override fun rotate(refreshToken: String): RefreshSession {
        val stored = byHash[hash(refreshToken)]?.let(sessions::get) ?: invalidRefresh()
        if (stored.revokedAt != null || !clock.instant().isBefore(stored.expiresAt)) invalidRefresh()
        stored.revokedAt = clock.instant()
        return insert(stored.accountId, stored.role, stored.deviceId)
    }

    @Synchronized
    override fun revoke(sessionId: UUID, accountId: UUID) {
        val stored = sessions[sessionId] ?: return
        if (stored.accountId != accountId) invalidRefresh()
        stored.revokedAt = clock.instant()
    }

    @Synchronized
    override fun isActive(sessionId: UUID): Boolean {
        val stored = sessions[sessionId] ?: return true
        return stored.revokedAt == null && clock.instant().isBefore(stored.expiresAt)
    }

    private fun insert(accountId: UUID, role: Role, deviceId: String): RefreshSession {
        val raw = ByteArray(32).also(random::nextBytes).let(Base64.getUrlEncoder().withoutPadding()::encodeToString)
        val stored = Stored(
            UUID.randomUUID(),
            accountId,
            role,
            deviceId,
            hash(raw),
            clock.instant().plus(Duration.ofDays(30)),
        )
        sessions[stored.sessionId] = stored
        byHash[stored.tokenHash] = stored.sessionId
        return RefreshSession(stored.sessionId, stored.accountId, stored.role, raw, stored.expiresAt)
    }

    private fun validate(mobile: String, role: Role, deviceId: String) {
        if (
            !mobile.matches(Regex("\\+91[6-9][0-9]{9}")) ||
            role !in setOf(Role.CUSTOMER, Role.MERCHANT) ||
            deviceId.isBlank() ||
            deviceId.length > 128
        ) throw DomainException("SESSION_INVALID", "The session cannot be created")
    }

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun invalidRefresh(): Nothing = throw DomainException("REFRESH_TOKEN_INVALID", "The refresh token is invalid or expired")
}
