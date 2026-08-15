package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.RefreshSession
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.util.Base64
import java.util.UUID

interface CaptainSessionIssuer {
    fun createCaptain(mobile: String, deviceId: String): RefreshSession
}

@Component
@Profile("!test & !development")
class AuthorizedCaptainSessionIssuer(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
    private val clock: Clock = Clock.systemUTC(),
) : CaptainSessionIssuer {
    private val random = SecureRandom()

    override fun createCaptain(mobile: String, deviceId: String): RefreshSession = transaction.execute {
        validateInput(mobile, deviceId)
        val authorizedAccount = jdbc.sql(
            """
            SELECT id
            FROM mypet.identity_account
            WHERE mobile_e164 = :mobile
              AND role = 'CAPTAIN'
              AND status = 'ACTIVE'
            """.trimIndent(),
        ).param("mobile", mobile)
            .query(UUID::class.java)
            .optional()
            .orElseThrow { DomainException("SESSION_INVALID", "The session cannot be created") }

        val rawToken = ByteArray(32).also(random::nextBytes).let {
            Base64.getUrlEncoder().withoutPadding().encodeToString(it)
        }
        val sessionId = UUID.randomUUID()
        val expiresAt = clock.instant().plus(Duration.ofDays(30))
        jdbc.sql(
            """
            INSERT INTO mypet.user_session(id, account_id, refresh_token_hash, device_id, expires_at)
            VALUES (:id, :account_id, :token_hash, :device_id, :expires_at)
            """.trimIndent(),
        ).param("id", sessionId)
            .param("account_id", authorizedAccount)
            .param("token_hash", hash(rawToken))
            .param("device_id", deviceId)
            .param("expires_at", Timestamp.from(expiresAt))
            .update()
        RefreshSession(sessionId, authorizedAccount, Role.CAPTAIN, rawToken, expiresAt)
    }

    private fun validateInput(mobile: String, deviceId: String) {
        if (!mobile.matches(Regex("\\+91[6-9][0-9]{9}")) || deviceId.isBlank() || deviceId.length > 128) {
            throw DomainException("SESSION_INVALID", "The session cannot be created")
        }
    }

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
