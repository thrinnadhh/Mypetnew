package `in`.mypetnew.application.web

import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.OtpPurpose
import `in`.mypetnew.identity.domain.OtpService
import `in`.mypetnew.identity.infrastructure.MerchantPrincipalResolver
import `in`.mypetnew.identity.infrastructure.MerchantSessionIssuer
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/v1/auth/merchant")
class MerchantIdentityController(
    private val otp: OtpService,
    private val tokens: BearerTokenService,
    private val sessions: MerchantSessionIssuer,
    private val principals: MerchantPrincipalResolver,
) {
    @PostMapping("/otp/verify")
    fun verify(@RequestBody body: OtpVerifyBody): OtpSessionResponse {
        if (body.purpose != OtpPurpose.LOGIN) {
            throw DomainException("OTP_PURPOSE_INVALID", "The OTP purpose is invalid for this endpoint")
        }
        val verified = otp.verify(body.challengeId, body.mobile, body.purpose, body.code)
        val session = sessions.createMerchant(verified.subjectId, verified.mobile, verified.deviceId)
        val principal = principals.resolve(session.accountId, session.sessionId)
        if (principal.role != Role.MERCHANT || principal.actorId != session.accountId) {
            throw DomainException("SESSION_INVALID", "The session cannot be created")
        }
        return OtpSessionResponse(
            accountId = session.accountId,
            accessToken = tokens.issue(principal),
            refreshToken = session.refreshToken,
            accessTokenExpiresAt = verified.verifiedAt.plusSeconds(3_600),
            refreshTokenExpiresAt = session.expiresAt,
            role = Role.MERCHANT,
        )
    }
}
