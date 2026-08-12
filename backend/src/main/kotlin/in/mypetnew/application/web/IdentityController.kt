package `in`.mypetnew.application.web

import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.OtpPurpose
import `in`.mypetnew.identity.domain.OtpChallengeResponse
import `in`.mypetnew.identity.domain.OtpService
import `in`.mypetnew.identity.domain.SessionStore
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import jakarta.servlet.http.HttpServletRequest
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class OtpRequestBody(val mobile: String, val purpose: OtpPurpose, val deviceId: String)
data class OtpVerifyBody(val challengeId: UUID, val mobile: String, val purpose: OtpPurpose, val code: String)
data class OtpSessionResponse(
    val accountId: UUID,
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String = "Bearer",
    val accessTokenExpiresAt: Instant,
    val refreshTokenExpiresAt: Instant,
    val role: Role,
)

data class RefreshSessionBody(val refreshToken: String)

@RestController
@RequestMapping("/api/v1/auth")
class IdentityController(
    private val otp: OtpService,
    private val tokens: BearerTokenService,
    private val sessions: SessionStore,
) {
    @PostMapping("/otp/request")
    fun request(@RequestBody body: OtpRequestBody, request: HttpServletRequest): OtpChallengeResponse {
        requireLoginPurpose(body.purpose)
        return otp.request(body.mobile, body.purpose, body.deviceId, request.remoteAddr ?: "unknown")
    }

    @PostMapping("/otp/verify")
    fun verify(@RequestBody body: OtpVerifyBody): OtpSessionResponse {
        requireLoginPurpose(body.purpose)
        val verified = otp.verify(body.challengeId, body.mobile, body.purpose, body.code)
        val session = sessions.create(verified.subjectId, verified.mobile, Role.CUSTOMER, verified.deviceId)
        val principal = Principal(verified.subjectId, Role.CUSTOMER, sessionId = session.sessionId)
        return OtpSessionResponse(
            accountId = session.accountId,
            accessToken = tokens.issue(principal),
            refreshToken = session.refreshToken,
            accessTokenExpiresAt = verified.verifiedAt.plusSeconds(3_600),
            refreshTokenExpiresAt = session.expiresAt,
            role = Role.CUSTOMER,
        )
    }

    @PostMapping("/sessions/refresh")
    fun refresh(@RequestBody body: RefreshSessionBody): OtpSessionResponse {
        val session = sessions.rotate(body.refreshToken)
        val now = Instant.now()
        return OtpSessionResponse(
            accountId = session.accountId,
            accessToken = tokens.issue(Principal(session.accountId, session.role, sessionId = session.sessionId)),
            refreshToken = session.refreshToken,
            accessTokenExpiresAt = now.plusSeconds(3_600),
            refreshTokenExpiresAt = session.expiresAt,
            role = session.role,
        )
    }

    @DeleteMapping("/sessions/current")
    fun logout(authentication: Authentication) {
        val principal = authentication.domainPrincipal()
        sessions.revoke(principal.sessionId, principal.actorId)
    }

    private fun requireLoginPurpose(purpose: OtpPurpose) {
        if (purpose != OtpPurpose.LOGIN) {
            throw DomainException("OTP_PURPOSE_INVALID", "The OTP purpose is invalid for this endpoint")
        }
    }
}
