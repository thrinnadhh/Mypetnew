package `in`.mypetnew.common.security

/**
 * A final defensive boundary for text that is approved for operational logging.
 * Callers must still construct allowlisted, structured events and avoid personal
 * data entirely; redaction is not permission to log request/response bodies.
 */
object SensitiveDataRedactor {
    private val rules = listOf(
        Rule(
            Regex("(?i)\\b(Bearer\\s+)[A-Za-z0-9._~+/=-]+"),
            "$1[REDACTED_TOKEN]",
        ),
        Rule(
            Regex(
                "(?i)(\\\"?(?:access_?token|refresh_?token|fcm_?token|session_?token|password|cvv|cvc|upi_?pin|card_?number|bank_?password)\\\"?\\s*[:=]\\s*\\\"?)[^\\\",\\s}]+",
            ),
            "$1[REDACTED]",
        ),
        Rule(
            Regex("(?i)\\b(otp|one[- ]?time(?: password| code)?)(\\s*[:=]\\s*)[0-9]{4,8}\\b"),
            "$1$2[REDACTED_OTP]",
        ),
        Rule(
            Regex("(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?![A-Za-z0-9-])"),
            "[REDACTED_EMAIL]",
        ),
        Rule(
            Regex("(?<![0-9])(?:\\+?91[- ]?)?[6-9][0-9]{9}(?![0-9])"),
            "[REDACTED_MOBILE]",
        ),
        Rule(
            Regex("(?i)\\b(lat(?:itude)?|lng|lon(?:gitude)?)(\\s*[:=]\\s*)-?[0-9]{1,3}(?:\\.[0-9]+)?"),
            "$1$2[REDACTED_COORDINATE]",
        ),
    )

    fun redact(message: String): String = rules.fold(message) { safe, rule ->
        rule.pattern.replace(safe, rule.replacement)
    }

    private data class Rule(val pattern: Regex, val replacement: String)
}

