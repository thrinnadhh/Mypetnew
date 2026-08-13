package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.RefreshSession
import org.springframework.context.annotation.Primary
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.util.Base64
import java.util.UUID

/**
 * Production Merchant session authority.
 *
 * OTP verification only proves control of a mobile number. It must never mint MERCHANT authority.
 * This issuer therefore requires a pre-existing canonical ACTIVE MERCHANT identity before creating
 * a session. Being @Primary ensures MerchantIdentityController resolves this implementation in
 * production even while legacy session issuance remains available for compatibility cleanup.
 */
@Component
@Primary
@Profile("!test & !development")
class AuthorizedMerchantSessionIssuer(
    private val jdbc: JdbcClient,
    private val transaction: TransactionTemplate,
    private val clock: Clock = Clock.systemUTC(),
) : MerchantSessionIssuer {
    private val random = SecureRandom()

    override fun createMerchant(accountId: UUID, mobile: String, deviceId: String): RefreshSession = transaction.execute {
        validateInput(mobile, deviceId)
        val authorizedAccount = jdbc.sql(
            """
            SELECT id
            FROM mypet.identity_account
            WHERE mobile_e164 = :mobile
              AND role = 'MERCHANT'
              AND status = 'ACTIVE'
            """.trimIndent(),
        ).param("mobile", mobile)
            .query(UUID::class.java)
            .optional()
            .orElseThrow { DomainException("SESSION_INVALID", "The session cannot be created") }

        if (authorizedAccount != accountId) {
            throw DomainException("SESSION_INVALID", "The session cannot be created")
        }

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
            .param("account_id", accountId)
            .param("token_hash", hash(rawToken))
            .param("device_id", deviceId)
            .param("expires_at", expiresAt)
            .update()
        RefreshSession(sessionId, accountId, Role.MERCHANT, rawToken, expiresAt)
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
