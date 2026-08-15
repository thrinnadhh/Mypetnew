package `in`.mypetnew.identity.infrastructure

import `in`.mypetnew.identity.domain.OtpProvider
import `in`.mypetnew.identity.domain.OtpPurpose
import java.util.UUID
import org.slf4j.LoggerFactory

class ConsoleOtpProvider : OtpProvider {
    private val logger = LoggerFactory.getLogger(ConsoleOtpProvider::class.java)

    override fun send(challengeId: UUID, mobile: String, code: String, purpose: OtpPurpose) {
        logger.warn(
            "DEVICE_PROFILE_OTP challengeId={} mobile={} purpose={} code={}",
            challengeId,
            mobile,
            purpose,
            code,
        )
    }
}
