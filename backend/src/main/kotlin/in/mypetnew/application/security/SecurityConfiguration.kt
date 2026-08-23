package `in`.mypetnew.application.security

import `in`.mypetnew.application.web.ApiErrorEnvelope
import `in`.mypetnew.application.web.TraceIdFilter
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.AuthenticationEntryPoint
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource
import java.time.Instant
import java.util.UUID
import tools.jackson.databind.ObjectMapper

@ConfigurationProperties("mypet.security")
data class SecurityProperties(
    val tokenSecret: String,
    val tokenIssuer: String,
    val tokenAudience: String,
) {
    init {
        require(tokenSecret.length >= 32) { "MYPET_TOKEN_SECRET must contain at least 32 characters" }
        require(tokenIssuer.matches(Regex("[A-Za-z0-9:/._-]{3,120}"))) { "MYPET_TOKEN_ISSUER is invalid" }
        require(tokenAudience.matches(Regex("[A-Za-z0-9:/._-]{3,120}"))) { "MYPET_TOKEN_AUDIENCE is invalid" }
    }

    override fun toString(): String =
        "SecurityProperties(tokenSecret=[REDACTED], tokenIssuer=$tokenIssuer, tokenAudience=$tokenAudience)"
}

@ConfigurationProperties("mypet.cors")
data class CorsProperties(
    val allowedOrigins: List<String> = emptyList(),
) {
    val normalizedAllowedOrigins: List<String> = allowedOrigins
        .map(String::trim)
        .filter(String::isNotEmpty)
        .distinct()

    init {
        require(normalizedAllowedOrigins.none { it == "*" }) {
            "MYPET_CORS_ALLOWED_ORIGINS must contain explicit origins; wildcard origins are forbidden"
        }
        require(normalizedAllowedOrigins.all { origin ->
            origin.matches(Regex("https?://[^/]+"))
        }) {
            "MYPET_CORS_ALLOWED_ORIGINS contains an invalid origin"
        }
    }
}

@Configuration
@EnableConfigurationProperties(SecurityProperties::class, CorsProperties::class)
class SecurityConfiguration {
    @Bean
    fun corsConfigurationSource(properties: CorsProperties): CorsConfigurationSource {
        val configuration = CorsConfiguration().apply {
            if (properties.normalizedAllowedOrigins.isNotEmpty()) {
                allowedOrigins = properties.normalizedAllowedOrigins
            } else {
                allowedOriginPatterns = listOf("http://localhost:*", "http://127.0.0.1:*", "http://192.168.*:*", "https://*.supabase.co")
            }
            allowedMethods = listOf("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD")
            allowedHeaders = listOf("*")
            exposedHeaders = listOf("Authorization", "Idempotency-Key", "X-Trace-Id")
            allowCredentials = true
            maxAge = 3600L
        }
        return UrlBasedCorsConfigurationSource().apply {
            registerCorsConfiguration("/**", configuration)
        }
    }

    @Bean
    fun securityFilterChain(
        http: HttpSecurity,
        objectMapper: ObjectMapper,
        bearerAuthenticationFilter: BearerAuthenticationFilter,
        merchantReauthorizationFilter: MerchantReauthorizationFilter,
        corsConfigurationSource: CorsConfigurationSource,
    ): SecurityFilterChain {
        val entryPoint = stableAuthenticationEntryPoint(objectMapper)
        http
            .cors { it.configurationSource(corsConfigurationSource) }
            .csrf { it.disable() }
            .httpBasic { it.disable() }
            .formLogin { it.disable() }
            .logout { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.requestMatchers(HttpMethod.GET, "/api/v1/service-regions/active").permitAll()
                    .requestMatchers(HttpMethod.POST, "/api/v1/service-regions/launch-requests").permitAll()
                    .requestMatchers(
                        "/actuator/health/**",
                        "/api/v1/public/**",
                        "/api/v1/auth/otp/**",
                        "/api/v1/auth/merchant/otp/verify",
                        "/api/v1/auth/captain/otp/verify",
                        "/api/v1/auth/sessions/refresh",
                        "/api/v1/webhooks/cashfree/payments",
                    ).permitAll()
                    .anyRequest().authenticated()
            }
            .exceptionHandling {
                it.authenticationEntryPoint(entryPoint)
                    .accessDeniedHandler { request, response, _ ->
                        writeError(objectMapper, request, response, 403, "FORBIDDEN", "Access is denied")
                    }
            }
            .addFilterBefore(bearerAuthenticationFilter, AnonymousAuthenticationFilter::class.java)
            .addFilterAfter(merchantReauthorizationFilter, BearerAuthenticationFilter::class.java)
        return http.build()
    }

    private fun stableAuthenticationEntryPoint(objectMapper: ObjectMapper): AuthenticationEntryPoint =
        AuthenticationEntryPoint { request, response, _ ->
            writeError(
                objectMapper,
                request,
                response,
                401,
                "AUTHENTICATION_REQUIRED",
                "Authentication is required",
            )
        }

    private fun writeError(
        objectMapper: ObjectMapper,
        request: HttpServletRequest,
        response: HttpServletResponse,
        status: Int,
        code: String,
        message: String,
    ) {
        response.status = status
        response.contentType = MediaType.APPLICATION_JSON_VALUE
        val traceId = request.getAttribute(TraceIdFilter.TRACE_ATTRIBUTE)?.toString() ?: UUID.randomUUID().toString()
        objectMapper.writeValue(
            response.outputStream,
            ApiErrorEnvelope(code, message, traceId, emptyMap(), Instant.now(), request.requestURI),
        )
    }
}
