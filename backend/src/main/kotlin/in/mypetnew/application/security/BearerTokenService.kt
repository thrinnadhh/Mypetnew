package `in`.mypetnew.application.security

import `in`.mypetnew.common.auth.AdminPermission
import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.common.error.DomainException
import `in`.mypetnew.identity.domain.SessionStore
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

@Component
class BearerTokenService(
    properties: SecurityProperties,
    private val clock: Clock = Clock.systemUTC(),
) {
    private val secret = properties.tokenSecret.toByteArray(StandardCharsets.UTF_8)
    private val issuer = properties.tokenIssuer
    private val audience = properties.tokenAudience
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()

    fun issue(principal: Principal, lifetime: Duration = Duration.ofHours(1)): String {
        val payload = listOf(
            issuer,
            audience,
            principal.actorId,
            principal.role,
            principal.organizationId ?: "-",
            principal.outletIds.sortedBy(UUID::toString).joinToString(","),
            principal.permissions.sortedBy(Enum<*>::name).joinToString(","),
            principal.sessionId,
            clock.instant().plus(lifetime).epochSecond,
        ).joinToString("|")
        val encoded = encoder.encodeToString(payload.toByteArray(StandardCharsets.UTF_8))
        return "$encoded.${encoder.encodeToString(sign(encoded))}"
    }

    fun verify(token: String): Principal {
        val parts = token.split('.')
        if (parts.size != 2) invalid()
        val actualSignature = runCatching { decoder.decode(parts[1]) }.getOrElse { invalid() }
        if (!MessageDigest.isEqual(sign(parts[0]), actualSignature)) invalid()
        val payload = runCatching { String(decoder.decode(parts[0]), StandardCharsets.UTF_8) }.getOrElse { invalid() }
        val values = payload.split('|')
        if (values.size != 9 || values[0] != issuer || values[1] != audience) invalid()
        val expiresAt = values[8].toLongOrNull() ?: invalid()
        if (clock.instant().epochSecond >= expiresAt) invalid()
        return runCatching {
            Principal(
                actorId = UUID.fromString(values[2]),
                role = Role.valueOf(values[3]),
                organizationId = values[4].takeUnless { it == "-" }?.let(UUID::fromString),
                outletIds = values[5].csv().map(UUID::fromString).toSet(),
                permissions = values[6].csv().map(AdminPermission::valueOf).toSet(),
                sessionId = UUID.fromString(values[7]),
            )
        }.getOrElse { invalid() }
    }

    private fun sign(payload: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(secret, "HmacSHA256"))
        doFinal(payload.toByteArray(StandardCharsets.UTF_8))
    }

    private fun String.csv(): List<String> = if (isBlank()) emptyList() else split(',')

    private fun invalid(): Nothing = throw DomainException("TOKEN_INVALID", "The access token is invalid or expired")
}

@Component
class BearerAuthenticationFilter(
    private val tokens: BearerTokenService,
    private val sessions: SessionStore,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val authorization = request.getHeader("Authorization")
        if (authorization?.startsWith("Bearer ") == true && SecurityContextHolder.getContext().authentication == null) {
            val principal = runCatching { tokens.verify(authorization.removePrefix("Bearer ").trim()) }.getOrNull()
            if (principal != null && runCatching { sessions.isActive(principal.sessionId) }.getOrDefault(false)) {
                val authorities = buildList {
                    add(SimpleGrantedAuthority("ROLE_${principal.role}"))
                    principal.permissions.forEach { add(SimpleGrantedAuthority("PERMISSION_$it")) }
                }
                SecurityContextHolder.getContext().authentication =
                    UsernamePasswordAuthenticationToken(principal, null, authorities)
            }
        }
        filterChain.doFilter(request, response)
    }
}
