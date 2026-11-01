package com.brewdial.api.web

import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.InputStreamReader
import java.nio.charset.Charset

/** A raw NUL byte, or a JSON `\u0000` escape whose backslash is not itself escaped. */
private val NUL_CHARACTER = Regex("\u0000|(?<!\\\\)(?:\\\\\\\\)*\\\\u0000", RegexOption.IGNORE_CASE)

internal fun hasNulCharacter(body: ByteArray): Boolean =
    // Every byte maps to one character, and the pattern is ASCII.
    NUL_CHARACTER.containsMatchIn(String(body, Charsets.ISO_8859_1))

/**
 * MySQL stores a NUL character and PostgreSQL refuses it, so one such value would
 * block every copy back to PostgreSQL. Refused here, for both databases, so that
 * the data stays portable. Runs after agent auth, and buffers one bounded body.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 4)
class NulCharacterFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        if (request.method in READ_METHODS) {
            filterChain.doFilter(request, response)
            return
        }
        val body = request.inputStream.readNBytes(MAX_BODY_BYTES + 1)
        if (body.size > MAX_BODY_BYTES) {
            refuse(response, HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "body too large")
            return
        }
        if (hasNulCharacter(body)) {
            refuse(response, HttpServletResponse.SC_BAD_REQUEST, "invalid body")
            return
        }
        filterChain.doFilter(CachedBodyRequest(request, body), response)
    }

    private fun refuse(response: HttpServletResponse, status: Int, error: String) {
        response.status = status
        response.contentType = "application/json"
        response.writer.write("{\"error\":\"$error\"}")
    }

    private class CachedBodyRequest(
        request: HttpServletRequest,
        private val body: ByteArray
    ) : HttpServletRequestWrapper(request) {
        override fun getInputStream(): ServletInputStream {
            val bytes = ByteArrayInputStream(body)
            return object : ServletInputStream() {
                override fun read(): Int = bytes.read()
                override fun read(target: ByteArray, offset: Int, length: Int): Int = bytes.read(target, offset, length)
                override fun isFinished(): Boolean = bytes.available() == 0
                override fun isReady(): Boolean = true
                override fun setReadListener(listener: ReadListener?): Unit = throw UnsupportedOperationException()
            }
        }

        override fun getReader(): BufferedReader {
            val charset = characterEncoding?.let { Charset.forName(it) } ?: Charsets.UTF_8
            return BufferedReader(InputStreamReader(inputStream, charset))
        }
    }

    internal companion object {
        /** A ceiling, not a validation rule: the whole database holds about 10 MB. */
        const val MAX_BODY_BYTES = 1024 * 1024
        private val READ_METHODS = setOf("GET", "HEAD", "OPTIONS")
    }
}
