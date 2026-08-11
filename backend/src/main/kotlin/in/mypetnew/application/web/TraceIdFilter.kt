package `in`.mypetnew.application.web

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.MDC
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class TraceIdFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val candidate = request.getHeader("X-Trace-Id")
        val traceId = candidate?.takeIf { it.matches(Regex("[A-Za-z0-9._:-]{1,64}")) } ?: UUID.randomUUID().toString()
        request.setAttribute(TRACE_ATTRIBUTE, traceId)
        response.setHeader("X-Trace-Id", traceId)
        MDC.put("traceId", traceId)
        try {
            filterChain.doFilter(request, response)
        } finally {
            MDC.remove("traceId")
        }
    }

    companion object {
        const val TRACE_ATTRIBUTE = "mypet.traceId"
    }
}

