package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.RefreshSession
import `in`.mypetnew.identity.domain.SessionStore
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

@Repository
@Profile("!test & !development")
class JdbcSessionStore(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
    private val clock: Clock = Clock.systemUTC(),
) : SessionStore {
    private data class StoredSession(
        val sessionId: UUID,
        val accountId: UUID,
        val role: Role,
        val deviceId: String,
        val expiresAt: Instant,
        val revokedAt: Instant?,
    )

    private val random = SecureRandom()
    private val refreshLifetime = Duration.ofDays(30)

    override fun create(accountId: UUID, mobile: String, role: Role, deviceId: String): RefreshSession =
        transaction.execute {
            validateIdentity(mobile, role, deviceId)
            jdbc.sql(
                """
                INSERT INTO mypet.identity_account(id, mobile_e164, role, status)
                VALUES (:id, :mobile, :role, 'ACTIVE')
                ON CONFLICT (mobile_e164) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                """.trimIndent(),
            ).param("id", accountId).param("mobile", mobile).param("role", role.name).update()
            val persistedAccountId = jdbc.sql(
                "SELECT id FROM mypet.identity_account WHERE mobile_e164 = :mobile AND role = :role AND status = 'ACTIVE'",
            ).param("mobile", mobile).param("role", role.name).query(UUID::class.java).optional().orElseThrow {
                DomainException("SESSION_INVALID", "The session cannot be created")
            }
            if (persistedAccountId != accountId) invalidRefresh()
            insertSession(accountId, role, deviceId, null)
        }

    override fun rotate(refreshToken: String): RefreshSession = transaction.execute {
        val now = clock.instant()
        val stored = jdbc.sql(
            """
            SELECT s.id, s.account_id, a.role, s.device_id, s.expires_at, s.revoked_at
            FROM mypet.user_session s
            JOIN mypet.identity_account a ON a.id = s.account_id
            WHERE s.refresh_token_hash = :token_hash
            FOR UPDATE OF s
            """.trimIndent(),
        ).param("token_hash", hash(refreshToken)).query(::mapSession).optional().orElse(null) ?: invalidRefresh()
        if (stored.revokedAt != null || !now.isBefore(stored.expiresAt)) invalidRefresh()
        jdbc.sql("UPDATE mypet.user_session SET revoked_at = :now WHERE id = :id")
            .param("now", now.jdbcTimestamp()).param("id", stored.sessionId).update()
        val rotated = insertSession(stored.accountId, stored.role, stored.deviceId, stored.sessionId)
        jdbc.sql(
            """
            UPDATE mypet.device_registration
            SET session_id = :new_session_id, updated_at = :now
            WHERE session_id = :old_session_id AND status = 'ACTIVE'
            """.trimIndent(),
        ).param("new_session_id", rotated.sessionId)
            .param("old_session_id", stored.sessionId)
            .param("now", now.jdbcTimestamp())
            .update()
        rotated
    }

    override fun revoke(sessionId: UUID, accountId: UUID) {
        transaction.executeWithoutResult {
            val now = clock.instant()
            jdbc.sql(
                """
                UPDATE mypet.user_session
                SET revoked_at = COALESCE(revoked_at, :now)
                WHERE id = :session_id AND account_id = :account_id
                """.trimIndent(),
            ).param("now", now.jdbcTimestamp()).param("session_id", sessionId).param("account_id", accountId).update()
            jdbc.sql(
                """
                UPDATE mypet.device_registration
                SET status = 'REVOKED', updated_at = :now
                WHERE session_id IN (
                    SELECT id FROM mypet.user_session WHERE id = :session_id AND account_id = :account_id
                ) AND status = 'ACTIVE'
                """.trimIndent(),
            ).param("now", now.jdbcTimestamp()).param("session_id", sessionId).param("account_id", accountId).update()
        }
    }

    override fun isActive(sessionId: UUID): Boolean = jdbc.sql(
        """
        SELECT COUNT(*) FROM mypet.user_session
        WHERE id = :session_id AND revoked_at IS NULL AND expires_at > :now
        """.trimIndent(),
    ).param("session_id", sessionId)
        .param("now", clock.instant().jdbcTimestamp())
        .query(Int::class.java)
        .single() == 1

    private fun insertSession(
        accountId: UUID,
        role: Role,
        deviceId: String,
        rotatedFrom: UUID?,
    ): RefreshSession {
        val rawToken = ByteArray(32).also(random::nextBytes).let {
            Base64.getUrlEncoder().withoutPadding().encodeToString(it)
        }
        val id = UUID.randomUUID()
        val expiresAt = clock.instant().plus(refreshLifetime)
        jdbc.sql(
            """
            INSERT INTO mypet.user_session(
                id, account_id, refresh_token_hash, device_id, expires_at, rotated_from_session_id
            ) VALUES (:id, :account_id, :token_hash, :device_id, :expires_at, :rotated_from)
            """.trimIndent(),
        ).param("id", id)
            .param("account_id", accountId)
            .param("token_hash", hash(rawToken))
            .param("device_id", deviceId)
            .param("expires_at", expiresAt.jdbcTimestamp())
            .param("rotated_from", rotatedFrom)
            .update()
        return RefreshSession(id, accountId, role, rawToken, expiresAt)
    }

    private fun mapSession(rows: ResultSet, rowNumber: Int): StoredSession {
        require(rowNumber >= 0)
        return StoredSession(
            sessionId = rows.getObject("id", UUID::class.java),
            accountId = rows.getObject("account_id", UUID::class.java),
            role = Role.valueOf(rows.getString("role")),
            deviceId = rows.getString("device_id"),
            expiresAt = rows.getTimestamp("expires_at").toInstant(),
            revokedAt = rows.getTimestamp("revoked_at")?.toInstant(),
        )
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

private fun Instant.jdbcTimestamp(): Timestamp = Timestamp.from(this)
