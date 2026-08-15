package `in`.mypetnew.application.web

import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.OtpPurpose
import `in`.mypetnew.identity.domain.OtpService
import `in`.mypetnew.identity.infrastructure.CaptainSessionIssuer
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class CaptainOtpVerifyBody(
    val challengeId: UUID,
    val mobile: String,
    val purpose: OtpPurpose,
    val code: String,
)

@RestController
@RequestMapping("/api/v1/auth/captain")
class CaptainIdentityController(
    private val otp: OtpService,
    private val tokens: BearerTokenService,
    private val sessions: CaptainSessionIssuer,
) {
    @PostMapping("/otp/verify")
    fun verify(@RequestBody body: CaptainOtpVerifyBody): OtpSessionResponse {
        if (body.purpose != OtpPurpose.LOGIN) {
            throw DomainException("OTP_PURPOSE_INVALID", "The OTP purpose is invalid for this endpoint")
        }
        val verified = otp.verify(body.challengeId, body.mobile, body.purpose, body.code)
        val session = sessions.createCaptain(verified.mobile, verified.deviceId)
        if (session.role != Role.CAPTAIN) {
            throw DomainException("SESSION_INVALID", "The session cannot be created")
        }
        val principal = Principal(session.accountId, Role.CAPTAIN, sessionId = session.sessionId)
        return OtpSessionResponse(
            accountId = session.accountId,
            accessToken = tokens.issue(principal),
            refreshToken = session.refreshToken,
            accessTokenExpiresAt = tokens.expiresAt(verified.verifiedAt),
            refreshTokenExpiresAt = session.expiresAt,
            role = Role.CAPTAIN,
        )
    }
}
