package com.brewdial.api.web

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/** Mirrors Hono CORS behavior: foreign origins still receive the route response. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
class CorsFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val origin = request.getHeader("Origin")
        if (origin in ALLOWED_ORIGINS) {
            response.setHeader("Access-Control-Allow-Origin", origin)
            response.setHeader("Access-Control-Allow-Credentials", "true")
            response.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS)
            response.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS)
            response.setHeader("Access-Control-Max-Age", "86400")
            response.setHeader("Vary", "Origin")
        }

        if (request.method.equals("OPTIONS", ignoreCase = true)) {
            response.status = HttpServletResponse.SC_NO_CONTENT
            return
        }
        filterChain.doFilter(request, response)
    }

    private companion object {
        val ALLOWED_ORIGINS = setOf(
            "https://brewdial.apps.tossmini.com",
            "https://brewdial.private-apps.tossmini.com",
            "https://coffee.robinco.dev",
            "https://brewdial.robinco.dev"
        )
        const val ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        const val ALLOWED_HEADERS = "Content-Type, Authorization, X-BrewDial-Identity"
    }
}
