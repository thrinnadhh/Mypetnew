package `in`.mypetnew.security

import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.application.security.SecurityProperties
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class BearerTokenServiceContractTest {
    private val clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)
    private val secret = "test-only-secret-that-is-longer-than-32-bytes"

    @Test
    fun `signed access tokens are issuer and audience bound`() {
        val principal = Principal(UUID.randomUUID(), Role.CUSTOMER)
        val issuer = BearerTokenService(SecurityProperties(secret, "mypet-api", "customer-app"), clock)
        val token = issuer.issue(principal)

        assertEquals(principal, issuer.verify(token))
        assertFalse(SecurityProperties(secret, "mypet-api", "customer-app").toString().contains(secret))
        assertThrows(DomainException::class.java) {
            BearerTokenService(SecurityProperties(secret, "foreign-api", "customer-app"), clock).verify(token)
        }
        assertThrows(DomainException::class.java) {
            BearerTokenService(SecurityProperties(secret, "mypet-api", "foreign-app"), clock).verify(token)
        }
    }
}
