package `in`.mypetnew.application.security

import `in`.mypetnew.common.auth.Principal
import `in`.mypetnew.common.auth.Role
import `in`.mypetnew.identity.infrastructure.MerchantPrincipalResolver
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class MerchantReauthorizationFilter(
    private val merchantPrincipals: MerchantPrincipalResolver,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val authentication = SecurityContextHolder.getContext().authentication
        val tokenPrincipal = authentication?.principal as? Principal
        if (tokenPrincipal?.role == Role.MERCHANT) {
            val currentPrincipal = runCatching { merchantPrincipals.reauthorize(tokenPrincipal) }.getOrNull()
            if (currentPrincipal == null) {
                SecurityContextHolder.clearContext()
            } else {
                val authorities = buildList {
                    add(SimpleGrantedAuthority("ROLE_${currentPrincipal.role}"))
                    currentPrincipal.permissions.forEach { add(SimpleGrantedAuthority("PERMISSION_$it")) }
                }
                SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(
                    currentPrincipal,
                    null,
                    authorities,
                )
            }
        }
        filterChain.doFilter(request, response)
    }
}
