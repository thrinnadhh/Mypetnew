package `in`.mypetnew.identity.domain

import `in`.mypetnew.common.error.DomainException
import java.security.SecureRandom
import java.security.MessageDigest
import java.nio.charset.StandardCharsets
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

enum class OtpPurpose {
    LOGIN,
    CUSTOMER_ASSOCIATION,
    LOYALTY_ONBOARDING,
}

interface OtpProvider {
    fun send(challengeId: UUID, mobile: String, code: String, purpose: OtpPurpose)
}

class InMemoryOtpProvider : OtpProvider {
    private val codes = mutableMapOf<UUID, String>()

    @Synchronized
    override fun send(challengeId: UUID, mobile: String, code: String, purpose: OtpPurpose) {
        codes[challengeId] = code
    }

    @Synchronized
    fun codeFor(challengeId: UUID): String = codes[challengeId]
        ?: error("No sandbox code exists for this challenge")
}

data class OtpChallengeResponse(
    val challengeId: UUID,
    val message: String,
    val expiresAt: Instant,
    val resendAfterSeconds: Long = 30L,
)

data class VerifiedMobile(
    val subjectId: UUID,
    val mobile: String,
    val deviceId: String,
    val verifiedAt: Instant,
)

class OtpService(
    private val provider: OtpProvider,
    private val clock: Clock = Clock.systemUTC(),
    private val ttl: Duration = Duration.ofMinutes(5),
    private val resendCooldown: Duration = Duration.ofSeconds(30),
) {
    private data class Challenge(
        val id: UUID,
        val mobileHash: String,
        val purpose: OtpPurpose,
        val deviceId: String,
        val codeHash: ByteArray,
        val salt: ByteArray,
        val expiresAt: Instant,
        var consumedAt: Instant? = null,
        var attemptCount: Int = 0,
    )

    private val random = SecureRandom()
    private val challenges = mutableMapOf<UUID, Challenge>()
    private val requestWindows = mutableMapOf<String, MutableList<Instant>>()
    private val lastRequests = mutableMapOf<String, Instant>()

    @Synchronized
    fun request(mobile: String, purpose: OtpPurpose, deviceId: String, ipAddress: String): OtpChallengeResponse {
        validateMobile(mobile)
        if (deviceId.isBlank() || deviceId.length > 128 || ipAddress.isBlank() || ipAddress.length > 64) {
            throw DomainException("OTP_REQUEST_INVALID", "Unable to send a verification code")
        }
        val now = clock.instant()
        val mobileHash = hashText(mobile)
        val resendKey = "$mobileHash:${purpose.name}:$deviceId"
        val lastRequest = lastRequests[resendKey]
        if (lastRequest != null && now.isBefore(lastRequest.plus(resendCooldown))) {
            throw DomainException("OTP_RATE_LIMITED", "Too many attempts. Try again later.")
        }
        enforceRateLimit("mobile:$mobileHash", now)
        enforceRateLimit("device:$deviceId", now)
        enforceRateLimit("ip:$ipAddress", now)
        val id = UUID.randomUUID()
        val code = random.nextInt(1_000_000).toString().padStart(6, '0')
        val salt = ByteArray(32).also(random::nextBytes)
        val challenge = Challenge(id, mobileHash, purpose, deviceId, hashCode(salt, code), salt, now.plus(ttl))
        challenges[id] = challenge
        lastRequests[resendKey] = now
        provider.send(id, mobile, code, purpose)
        return OtpChallengeResponse(
            challengeId = id,
            message = "If the mobile number can receive messages, a verification code has been sent.",
            expiresAt = challenge.expiresAt,
            resendAfterSeconds = 30L,
        )
    }

    @Synchronized
    fun verify(
        challengeId: UUID,
        mobile: String,
        purpose: OtpPurpose,
        code: String,
        at: Instant = clock.instant(),
    ): VerifiedMobile {
        val challenge = challenges[challengeId] ?: invalidOtp()
        challenge.attemptCount += 1
        if (
            challenge.consumedAt != null ||
            challenge.attemptCount > MAX_VERIFY_ATTEMPTS ||
            challenge.mobileHash != hashText(mobile) ||
            challenge.purpose != purpose ||
            code.length != 6 ||
            !MessageDigest.isEqual(challenge.codeHash, hashCode(challenge.salt, code)) ||
            !at.isBefore(challenge.expiresAt)
        ) {
            invalidOtp()
        }
        challenge.consumedAt = at
        return VerifiedMobile(UUID.nameUUIDFromBytes(mobile.toByteArray()), mobile, challenge.deviceId, at)
    }

    private fun enforceRateLimit(key: String, now: Instant) {
        val window = requestWindows.getOrPut(key) { mutableListOf() }
        window.removeIf { it.isBefore(now.minus(Duration.ofMinutes(15))) }
        if (window.size >= 5) {
            throw DomainException("OTP_RATE_LIMITED", "Too many attempts. Try again later.")
        }
        window += now
    }

    private fun validateMobile(mobile: String) {
        if (!mobile.matches(Regex("\\+91[6-9][0-9]{9}"))) {
            throw DomainException("MOBILE_INVALID", "Enter a valid Indian mobile number")
        }
    }

    private fun hashText(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun hashCode(salt: ByteArray, code: String): ByteArray = MessageDigest.getInstance("SHA-256")
        .digest(salt + code.toByteArray(StandardCharsets.UTF_8))

    private fun invalidOtp(): Nothing = throw DomainException(
        "OTP_INVALID",
        "The verification code is invalid or expired",
    )

    companion object {
        private const val MAX_VERIFY_ATTEMPTS = 5
    }
}
