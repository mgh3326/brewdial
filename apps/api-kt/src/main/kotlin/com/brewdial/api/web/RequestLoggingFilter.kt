package com.brewdial.api.web

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import tools.jackson.databind.ObjectMapper

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestLoggingFilter(
    private val objectMapper: ObjectMapper
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val startedAt = System.nanoTime()
        try {
            filterChain.doFilter(request, response)
        } finally {
            val elapsedMillis = (System.nanoTime() - startedAt) / 1_000_000
            // Deliberately do not include headers, query parameters, or bodies.
            println(
                objectMapper.writeValueAsString(
                    linkedMapOf(
                        "level" to "info",
                        "msg" to "request",
                        "method" to request.method,
                        "path" to request.requestURI,
                        "status" to response.status,
                        "ms" to elapsedMillis
                    )
                )
            )
        }
    }
}
