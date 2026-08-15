package `in`.mypetnew.identity.domain

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

data class RefreshSession(
    val sessionId: UUID,
    val accountId: UUID,
    val role: Role,
    val refreshToken: String,
    val expiresAt: Instant,
) {
    override fun toString(): String =
        "RefreshSession(sessionId=$sessionId, accountId=$accountId, role=$role, refreshToken=[REDACTED], expiresAt=$expiresAt)"
}

data class AccountIdentity(
    val accountId: UUID,
    val mobileE164: String,
    val status: String,
)

interface SessionStore {
    fun create(accountId: UUID, mobile: String, role: Role, deviceId: String): RefreshSession
    fun rotate(refreshToken: String): RefreshSession
    fun revoke(sessionId: UUID, accountId: UUID)
    fun revokeAll(accountId: UUID)
    fun disableAccount(accountId: UUID)
    fun isActive(sessionId: UUID): Boolean
    fun identityFor(accountId: UUID): AccountIdentity?
}

class InMemorySessionStore(
    private val clock: Clock = Clock.systemUTC(),
    private val refreshLifetime: Duration = Duration.ofDays(30),
    private val acceptUnknownAccessSessions: Boolean = false,
) : SessionStore {
    private data class StoredSession(
        val sessionId: UUID,
        val accountId: UUID,
        val role: Role,
        val mobile: String,
        val deviceId: String,
        val refreshTokenHash: String,
        val expiresAt: Instant,
        var revokedAt: Instant? = null,
    )

    private val random = SecureRandom()
    private val sessions = mutableMapOf<UUID, StoredSession>()
    private val byTokenHash = mutableMapOf<String, UUID>()
    private val disabledAccounts = mutableSetOf<UUID>()

    @Synchronized
    override fun create(accountId: UUID, mobile: String, role: Role, deviceId: String): RefreshSession {
        validateIdentity(mobile, role, deviceId)
        if (accountId in disabledAccounts) invalidRefresh()
        return newSession(accountId, role, mobile, deviceId)
    }

    @Synchronized
    override fun rotate(refreshToken: String): RefreshSession {
        val now = clock.instant()
        val stored = byTokenHash[hash(refreshToken)]?.let(sessions::get) ?: invalidRefresh()
        if (stored.revokedAt != null) {
            revokeAll(stored.accountId)
            invalidRefresh()
        }
        if (!now.isBefore(stored.expiresAt)) invalidRefresh()
        stored.revokedAt = now
        return newSession(stored.accountId, stored.role, stored.mobile, stored.deviceId)
    }

    @Synchronized
    override fun revoke(sessionId: UUID, accountId: UUID) {
        val stored = sessions[sessionId] ?: return
        if (stored.accountId != accountId) invalidRefresh()
        stored.revokedAt = clock.instant()
    }

    @Synchronized
    override fun revokeAll(accountId: UUID) {
        val now = clock.instant()
        sessions.values.filter { it.accountId == accountId }.forEach { it.revokedAt = now }
    }

    @Synchronized
    override fun disableAccount(accountId: UUID) {
        disabledAccounts += accountId
        revokeAll(accountId)
    }

    @Synchronized
    override fun isActive(sessionId: UUID): Boolean {
        val stored = sessions[sessionId] ?: return acceptUnknownAccessSessions
        return stored.revokedAt == null && clock.instant().isBefore(stored.expiresAt)
    }

    @Synchronized
    override fun identityFor(accountId: UUID): AccountIdentity? = sessions.values
        .firstOrNull { it.accountId == accountId && accountId !in disabledAccounts }
        ?.let { AccountIdentity(accountId, it.mobile, "ACTIVE") }

    private fun newSession(accountId: UUID, role: Role, mobile: String, deviceId: String): RefreshSession {
        val tokenBytes = ByteArray(32).also(random::nextBytes)
        val rawToken = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes)
        val session = StoredSession(
            sessionId = UUID.randomUUID(),
            accountId = accountId,
            role = role,
            mobile = mobile,
            deviceId = deviceId,
            refreshTokenHash = hash(rawToken),
            expiresAt = clock.instant().plus(refreshLifetime),
        )
        sessions[session.sessionId] = session
        byTokenHash[session.refreshTokenHash] = session.sessionId
        return RefreshSession(session.sessionId, accountId, role, rawToken, session.expiresAt)
    }

    private fun validateIdentity(mobile: String, role: Role, deviceId: String) {
        if (
            !mobile.matches(Regex("\\+91[6-9][0-9]{9}")) ||
            role != Role.CUSTOMER ||
            deviceId.isBlank() ||
            deviceId.length > 128
        ) {
            throw DomainException("SESSION_INVALID", "The session cannot be created")
        }
    }

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun invalidRefresh(): Nothing = throw DomainException(
        "REFRESH_TOKEN_INVALID",
        "The refresh token is invalid or expired",
    )
}
