package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.identity.domain.OtpPurpose
import java.util.UUID

class StagingUnavailableOtpProvider : OtpProvider {
    override fun send(
        challengeId: UUID,
        mobile: String,
        code: String,
        purpose: OtpPurpose,
    ) {
        throw DomainException(
            "OTP_PROVIDER_UNAVAILABLE",
            "Verification codes are temporarily unavailable",
        )
    }
}
