package com.brewdial.api.health

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HealthEndpointTest {
    @LocalServerPort
    private var port: Int = 0

    private val httpClient = HttpClient.newHttpClient()

    @Test
    fun healthIsMountedAtApiPath() {
        assertHealth("/api/health")
    }

    @Test
    fun healthIsMountedAtRootPath() {
        assertHealth("/health")
    }

    @Test
    fun databaseHealthIsMountedAtApiPath() {
        assertDatabaseHealth("/api/db/health")
    }

    @Test
    fun databaseHealthIsMountedAtRootPath() {
        assertDatabaseHealth("/db/health")
    }

    private fun assertHealth(path: String) {
        val response = request(path)

        assertEquals(200, response.statusCode())
        val body = response.body()
        val prefix = "{\"ok\":true,\"service\":\"brewdial-api\",\"ts\":\""
        assertTrue(body.startsWith(prefix), "Unexpected health body: $body")
        assertTrue(body.endsWith("Z\"}"), "Health timestamp must end in Z: $body")
        val timestamp = body.removePrefix(prefix).removeSuffix("\"}")
        Instant.parse(timestamp)
    }

    private fun assertDatabaseHealth(path: String) {
        val response = request(path)

        assertEquals(200, response.statusCode())
        assertEquals("{\"ok\":true,\"db\":\"up\"}", response.body())
    }

    private fun request(path: String): HttpResponse<String> {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:$port$path"))
            .GET()
            .build()
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString())
    }
}
