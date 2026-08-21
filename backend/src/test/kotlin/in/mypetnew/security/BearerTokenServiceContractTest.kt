package `in`.mypetnew.security

import `in`.mypetnew.application.security.BearerTokenService
import `in`.mypetnew.application.security.SecurityProperties
import `in`.mypetnew.common.auth.MerchantPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import java.nio.charset.StandardCharsets
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
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
        assertThrows(DomainException::class.java) {
            val expiredClock = Clock.fixed(clock.instant().plus(Duration.ofMinutes(15)), ZoneOffset.UTC)
            BearerTokenService(SecurityProperties(secret, "mypet-api", "customer-app"), expiredClock).verify(token)
        }
    }

    @Test
    fun `merchant outlet permission claims round trip without widening scope`() {
        val outletA = UUID.randomUUID()
        val outletB = UUID.randomUUID()
        val principal = Principal(
            actorId = UUID.randomUUID(),
            role = Role.MERCHANT,
            organizationId = UUID.randomUUID(),
            outletIds = setOf(outletA, outletB),
            merchantPermissionsByOutlet = mapOf(
                outletA to setOf(MerchantPermission.CATALOG_WRITE, MerchantPermission.INVENTORY_WRITE),
                outletB to setOf(MerchantPermission.POS_OPERATE),
            ),
        )
        val tokens = BearerTokenService(SecurityProperties(secret, "mypet-api", "merchant-app"), clock)

        assertEquals(principal, tokens.verify(tokens.issue(principal)))
    }

    @Test
    fun `legacy nine field access token remains valid for server reauthorization`() {
        val actorId = UUID.randomUUID()
        val organizationId = UUID.randomUUID()
        val outletId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val payload = listOf(
            "mypet-api",
            "merchant-app",
            actorId,
            Role.MERCHANT,
            organizationId,
            outletId,
            "",
            sessionId,
            clock.instant().plus(Duration.ofMinutes(10)).epochSecond,
        ).joinToString("|")
        val token = signLegacy(payload)
        val tokens = BearerTokenService(SecurityProperties(secret, "mypet-api", "merchant-app"), clock)

        assertEquals(
            Principal(
                actorId = actorId,
                role = Role.MERCHANT,
                organizationId = organizationId,
                outletIds = setOf(outletId),
                sessionId = sessionId,
            ),
            tokens.verify(token),
        )
    }

    private fun signLegacy(payload: String): String {
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val encoded = encoder.encodeToString(payload.toByteArray(StandardCharsets.UTF_8))
        val signature = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
            doFinal(encoded.toByteArray(StandardCharsets.UTF_8))
        }
        return "$encoded.${encoder.encodeToString(signature)}"
    }
}
