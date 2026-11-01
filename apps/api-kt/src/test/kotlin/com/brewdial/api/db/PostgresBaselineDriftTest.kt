package com.brewdial.api.db

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * packages/db/migrations (node-pg-migrate) stays the PostgreSQL source of
 * truth. The Flyway PostgreSQL scripts must contain exactly their up sections,
 * in order; regenerate with scripts/gen-postgres-baseline.sh.
 */
class PostgresBaselineDriftTest {
    @Test
    fun flywayPostgresScriptsMatchNodeMigrationUpSections() {
        val nodeMigrations = File("../../packages/db/migrations").listFiles { file -> file.name.endsWith(".sql") }
            ?.sortedBy { it.name }
            ?: error("packages/db/migrations not found from ${File(".").absolutePath}")
        val expected = nodeMigrations.joinToString("\n") { file ->
            file.readLines().takeWhile { !it.startsWith("-- Down Migration") }.joinToString("\n")
        }
        val flyway = File("src/main/resources/db/migration/postgresql").listFiles { file -> file.name.endsWith(".sql") }
            ?.sortedBy { it.name.substringAfter('V').substringBefore("__").toInt() }
            ?: error("no Flyway PostgreSQL scripts")
        val actual = flyway.joinToString("\n") { file ->
            file.readLines()
                .filterNot { it.startsWith("-- GENERATED") || it.startsWith("-- Up sections") ||
                    it.startsWith("-- Existing databases") || it.startsWith("-- (spring.flyway") ||
                    it.startsWith("-- >>> ") }
                .joinToString("\n")
        }
        assertEquals(normalize(expected), normalize(actual))
    }

    private fun normalize(sql: String): String = sql.lines().map { it.trimEnd() }.filter { it.isNotEmpty() }.joinToString("\n")
}
