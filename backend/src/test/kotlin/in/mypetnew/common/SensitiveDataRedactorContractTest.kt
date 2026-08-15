package `in`.mypetnew.common

import `in`.mypetnew.common.security.SensitiveDataRedactor
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class SensitiveDataRedactorContractTest {
    @Test
    fun `redacts identity authentication payment and location values`() {
        val unsafe = """
            mobile=+919812345678 email=person@example.com otp: 123456
            Authorization: Bearer eyJhbGciOi.test.signature
            {"refreshToken":"secret-value","cvv":"123","upi_pin":"654321"}
            latitude=17.385 longitude:78.4867
        """.trimIndent()

        val redacted = SensitiveDataRedactor.redact(unsafe)

        assertThat(redacted).doesNotContain(
            "+919812345678",
            "person@example.com",
            "123456",
            "eyJhbGciOi.test.signature",
            "secret-value",
            "654321",
            "17.385",
            "78.4867",
        )
        assertThat(redacted).contains(
            "[REDACTED_MOBILE]",
            "[REDACTED_EMAIL]",
            "[REDACTED_OTP]",
            "[REDACTED_TOKEN]",
            "[REDACTED_COORDINATE]",
        )
    }

    @Test
    fun `leaves allowlisted operational context intact`() {
        val message = "event=refresh_replay outcome=denied traceId=7844a688-c8f7-4a2d-9f53-b7698388c888"

        assertThat(SensitiveDataRedactor.redact(message)).isEqualTo(message)
    }
}

