package com.brewdial.api.identity

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import tools.jackson.databind.ObjectMapper

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
class IdentityFilter(
    private val identityResolver: IdentityResolver,
    private val objectMapper: ObjectMapper
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        // CORS preflight never resolves or creates an app user.
        if (!request.method.equals("OPTIONS", ignoreCase = true)) {
            parseValidIdentity(request.getHeader(HEADER))?.let { (provider, externalKey) ->
                try {
                    request.setAttribute(APP_USER_ID_ATTRIBUTE, identityResolver.resolve(provider, externalKey))
                } catch (_: Exception) {
                    response.status = HttpServletResponse.SC_SERVICE_UNAVAILABLE
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    response.characterEncoding = Charsets.UTF_8.name()
                    response.writer.write(
                        objectMapper.writeValueAsString(
                            linkedMapOf("ok" to false, "error" to "identity temporarily unavailable")
                        )
                    )
                    return
                }
            }
        }
        filterChain.doFilter(request, response)
    }

    private fun parseValidIdentity(raw: String?): Pair<String, String>? {
        if (raw.isNullOrEmpty()) return null
        val separator = raw.indexOf(':')
        if (separator < 0) return null
        val provider = raw.substring(0, separator)
        val externalKey = raw.substring(separator + 1)
        return if (provider in VALID_PROVIDERS && externalKey.length >= MIN_EXTERNAL_KEY_LENGTH) {
            provider to externalKey
        } else {
            null
        }
    }

    companion object {
        const val HEADER = "X-BrewDial-Identity"
        const val APP_USER_ID_ATTRIBUTE = "brewDial.appUserId"
        private const val MIN_EXTERNAL_KEY_LENGTH = 16
        private val VALID_PROVIDERS = setOf("toss_anon", "web_local")

        fun appUserId(request: HttpServletRequest): String? =
            request.getAttribute(APP_USER_ID_ATTRIBUTE) as? String
    }
}
