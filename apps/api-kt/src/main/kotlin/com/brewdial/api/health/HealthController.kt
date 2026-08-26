package com.brewdial.api.health

import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant

@RestController
// Keep the two mounts in one array so follow-up controllers can copy this pattern.
@RequestMapping(value = ["/api", ""])
class HealthController(
    private val jdbcTemplate: JdbcTemplate
) {
    @GetMapping("/health")
    fun health(): Map<String, Any> = linkedMapOf(
        "ok" to true,
        "service" to "brewdial-api",
        "ts" to Instant.now().toString()
    )

    @GetMapping("/db/health")
    fun databaseHealth(): ResponseEntity<Map<String, Any>> = try {
        jdbcTemplate.queryForObject("select 1") { resultSet, _ -> resultSet.getInt(1) }
        ResponseEntity.ok(linkedMapOf("ok" to true, "db" to "up"))
    } catch (_: Exception) {
        ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(linkedMapOf("ok" to false, "db" to "down"))
    }
}
