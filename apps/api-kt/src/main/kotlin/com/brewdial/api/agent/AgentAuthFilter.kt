package com.brewdial.api.agent

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import tools.jackson.databind.ObjectMapper
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

fun interface AgentTokenSupplier {
    fun token(): String?
}

@Component
class EnvironmentAgentTokenSupplier : AgentTokenSupplier {
    override fun token(): String? = System.getenv("AGENT_TOKEN")
}

/**
 * Gates both Spring mounts of the agent API.  Hashing both values first keeps
 * MessageDigest.isEqual's comparison length fixed, matching Hono's timingSafeEqual.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 3)
class AgentAuthFilter(
    private val tokenSupplier: AgentTokenSupplier,
    private val objectMapper: ObjectMapper
) : OncePerRequestFilter() {
    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        val path = request.requestURI.removePrefix(request.contextPath.orEmpty())
        return !(path == "/agent" || path.startsWith("/agent/") ||
            path == "/api/agent" || path.startsWith("/api/agent/"))
    }

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val configured = tokenSupplier.token()
        if (configured.isNullOrEmpty()) {
            writeError(response, HttpServletResponse.SC_SERVICE_UNAVAILABLE, "agent auth not configured")
            return
        }

        val header = request.getHeader("Authorization")
        if (header == null || !header.startsWith("Bearer ")) {
            writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "agent auth required")
            return
        }

        val provided = header.removePrefix("Bearer ")
        if (!constantTimeEqual(provided, configured)) {
            writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "agent auth required")
            return
        }
        filterChain.doFilter(request, response)
    }

    private fun writeError(response: HttpServletResponse, status: Int, error: String) {
        response.status = status
        response.contentType = MediaType.APPLICATION_JSON_VALUE
        response.characterEncoding = Charsets.UTF_8.name()
        response.writer.write(objectMapper.writeValueAsString(linkedMapOf("ok" to false, "error" to error)))
    }

    private fun constantTimeEqual(provided: String, configured: String): Boolean {
        val digest = MessageDigest.getInstance("SHA-256")
        val providedHash = digest.digest(provided.toByteArray(StandardCharsets.UTF_8))
        val configuredHash = MessageDigest.getInstance("SHA-256")
            .digest(configured.toByteArray(StandardCharsets.UTF_8))
        return MessageDigest.isEqual(providedHash, configuredHash)
    }
}
