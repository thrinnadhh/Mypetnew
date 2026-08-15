package `in`.mypetnew.identity

import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.domain.InMemoryOtpProvider
import `in`.mypetnew.identity.domain.InMemorySessionStore
import `in`.mypetnew.identity.domain.OtpPurpose
import `in`.mypetnew.identity.domain.OtpService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class IdentityContractTest {
    private val clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)

    @Test
    fun `OTP requests are enumeration resistant and values stay provider private`() {
        val provider = InMemoryOtpProvider()
        val service = OtpService(provider, clock)

        val first = service.request("+919876543210", OtpPurpose.LOGIN, "device-a", "127.0.0.1")
        val second = service.request("+919000000000", OtpPurpose.LOGIN, "device-b", "127.0.0.2")

        assertEquals(first.message, second.message)
        assertFalse(first.toString().contains(provider.codeFor(first.challengeId)))
    }

    @Test
    fun `OTP is purpose bound expiring and single use`() {
        val provider = InMemoryOtpProvider()
        val service = OtpService(provider, clock)
        val challenge = service.request("+919876543210", OtpPurpose.LOGIN, "device-a", "127.0.0.1")
        val code = provider.codeFor(challenge.challengeId)

        val verified = service.verify(challenge.challengeId, "+919876543210", OtpPurpose.LOGIN, code, clock.instant())
        assertEquals("+919876543210", verified.mobile)
        assertThrows(DomainException::class.java) {
            service.verify(challenge.challengeId, "+919876543210", OtpPurpose.LOGIN, code, clock.instant())
        }
    }

    @Test
    fun `expired and wrong-purpose OTP never creates identity`() {
        val provider = InMemoryOtpProvider()
        val service = OtpService(provider, clock, ttl = Duration.ofMinutes(5))
        val challenge = service.request("+919876543210", OtpPurpose.LOGIN, "device-a", "127.0.0.1")
        val code = provider.codeFor(challenge.challengeId)

        assertThrows(DomainException::class.java) {
            service.verify(challenge.challengeId, "+919876543210", OtpPurpose.CUSTOMER_ASSOCIATION, code, clock.instant())
        }
        assertThrows(DomainException::class.java) {
            service.verify(challenge.challengeId, "+919876543210", OtpPurpose.LOGIN, code, clock.instant().plusSeconds(301))
        }
    }

    @Test
    fun `OTP verification attempts are bounded and resend cooldown is enforced`() {
        val provider = InMemoryOtpProvider()
        val service = OtpService(provider, clock)
        val challenge = service.request("+919876543210", OtpPurpose.LOGIN, "device-a", "127.0.0.1")
        val code = provider.codeFor(challenge.challengeId)

        repeat(5) {
            assertThrows(DomainException::class.java) {
                service.verify(challenge.challengeId, "+919876543210", OtpPurpose.LOGIN, "000000", clock.instant())
            }
        }
        assertThrows(DomainException::class.java) {
            service.verify(challenge.challengeId, "+919876543210", OtpPurpose.LOGIN, code, clock.instant())
        }
        val cooldown = assertThrows(DomainException::class.java) {
            service.request("+919876543210", OtpPurpose.LOGIN, "device-a", "127.0.0.1")
        }
        assertEquals("OTP_RATE_LIMITED", cooldown.code)
    }

    @Test
    fun `refresh rotation revokes the old secret and session revocation invalidates access`() {
        val store = InMemorySessionStore(clock, Duration.ofDays(30))
        val accountId = UUID.randomUUID()
        val first = store.create(accountId, "+919876543210", Role.CUSTOMER, "device-a")

        assertTrue(store.isActive(first.sessionId))
        val rotated = store.rotate(first.refreshToken)
        assertNotEquals(first.sessionId, rotated.sessionId)
        assertNotEquals(first.refreshToken, rotated.refreshToken)
        assertFalse(store.isActive(first.sessionId))
        assertTrue(store.isActive(rotated.sessionId))
        assertThrows(DomainException::class.java) { store.rotate(first.refreshToken) }
        assertFalse(store.isActive(rotated.sessionId))

        val recovered = store.create(accountId, "+919876543210", Role.CUSTOMER, "device-a")
        store.revoke(recovered.sessionId, accountId)
        assertFalse(store.isActive(recovered.sessionId))
        assertFalse(rotated.toString().contains(rotated.refreshToken))
    }

    @Test
    fun `account disable revokes every device session and prevents recreation`() {
        val store = InMemorySessionStore(clock, Duration.ofDays(30))
        val accountId = UUID.randomUUID()
        val first = store.create(accountId, "+919876543210", Role.CUSTOMER, "device-a")
        val second = store.create(accountId, "+919876543210", Role.CUSTOMER, "device-b")

        store.disableAccount(accountId)

        assertFalse(store.isActive(first.sessionId))
        assertFalse(store.isActive(second.sessionId))
        assertThrows(DomainException::class.java) {
            store.create(accountId, "+919876543210", Role.CUSTOMER, "device-c")
        }
    }
}
