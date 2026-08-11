package `in`.mypetnew.application.web

import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.OtpPurpose
import `in`.mypetnew.identity.domain.OtpChallengeResponse
import `in`.mypetnew.identity.domain.OtpService
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
    val accessToken: String,
    val tokenType: String = "Bearer",
    val expiresAt: Instant,
    val role: Role,
)

@RestController
@RequestMapping("/api/v1/auth/otp")
class IdentityController(
    private val otp: OtpService,
    private val tokens: BearerTokenService,
) {
    @PostMapping("/request")
    fun request(@RequestBody body: OtpRequestBody, request: HttpServletRequest): OtpChallengeResponse {
        requireLoginPurpose(body.purpose)
        return otp.request(body.mobile, body.purpose, body.deviceId, request.remoteAddr ?: "unknown")
    }

    @PostMapping("/verify")
    fun verify(@RequestBody body: OtpVerifyBody): OtpSessionResponse {
        requireLoginPurpose(body.purpose)
        val verified = otp.verify(body.challengeId, body.mobile, body.purpose, body.code)
        val principal = Principal(verified.subjectId, Role.CUSTOMER)
        return OtpSessionResponse(
            accessToken = tokens.issue(principal),
            expiresAt = verified.verifiedAt.plusSeconds(3_600),
            role = Role.CUSTOMER,
        )
    }

    private fun requireLoginPurpose(purpose: OtpPurpose) {
        if (purpose != OtpPurpose.LOGIN) {
            throw DomainException("OTP_PURPOSE_INVALID", "The OTP purpose is invalid for this endpoint")
        }
    }
}
