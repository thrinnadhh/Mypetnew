package `in`.mypetnew.application.security

import `in`.mypetnew.application.web.ApiErrorEnvelope
import `in`.mypetnew.application.web.TraceIdFilter
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.AuthenticationEntryPoint
import org.springframework.security.web.SecurityFilterChain
import java.time.Instant
import java.util.UUID
import tools.jackson.databind.ObjectMapper

@ConfigurationProperties("mypet.security")
data class SecurityProperties(val tokenSecret: String) {
    init {
        require(tokenSecret.length >= 32) { "MYPET_TOKEN_SECRET must contain at least 32 characters" }
    }
}

@Configuration
@EnableConfigurationProperties(SecurityProperties::class)
class SecurityConfiguration {
    @Bean
    fun securityFilterChain(http: HttpSecurity, objectMapper: ObjectMapper): SecurityFilterChain {
        val entryPoint = stableAuthenticationEntryPoint(objectMapper)
        http
            .csrf { it.disable() }
            .httpBasic { it.disable() }
            .formLogin { it.disable() }
            .logout { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.requestMatchers("/actuator/health/**", "/api/v1/public/**", "/api/v1/auth/otp/**").permitAll()
                    .anyRequest().authenticated()
            }
            .exceptionHandling {
                it.authenticationEntryPoint(entryPoint)
                    .accessDeniedHandler { request, response, _ ->
                        writeError(objectMapper, request, response, 403, "FORBIDDEN", "Access is denied")
                    }
            }
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
