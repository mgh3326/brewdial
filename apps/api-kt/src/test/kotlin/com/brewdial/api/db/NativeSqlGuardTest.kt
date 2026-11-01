package com.brewdial.api.db

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Application code stays dialect-neutral: JPQL or criteria only, and native SQL
 * only in the per-vendor Flyway folders. Anything that reaches the database some
 * other way must be listed in native-sql-allowlist.txt with its exact count, so
 * the list can only shrink on purpose: a new use, or a removed one that leaves
 * the count stale, fails here.
 */
class NativeSqlGuardTest {
    @Test
    fun mainCodeMatchesTheAllowlist() {
        val root = File("src/main/kotlin")
        val found = root.walkTopDown().filter { it.extension == "kt" || it.extension == "java" }
            .associate { it.relativeTo(root).invariantSeparatorsPath to nativeSqlUses(it.readText()).size }
            .filterValues { it > 0 }
            .toSortedMap()

        val allowed = File("src/test/resources/native-sql-allowlist.txt").readLines()
            .filter { it.isNotBlank() && !it.startsWith("#") }
            .associate { line ->
                val (count, path) = line.trim().split(Regex("\\s+"), limit = 3)
                path to count.toInt()
            }
            .toSortedMap()

        assertEquals(allowed, found) {
            "Native SQL or raw JDBC outside the allowlist. Use JPQL or criteria, or put vendor SQL in a Flyway " +
                "migration. Only if neither can work, update src/test/resources/native-sql-allowlist.txt with a reason."
        }
    }

    @Test
    fun everyKindOfNativeAccessIsDetected() {
        val samples = listOf(
            """entityManager.createNativeQuery("select 1")""",
            """session.createNativeMutationQuery("delete from x")""",
            """jdbcTemplate.update("delete from x")""",
            """@Query(value = "select 1", nativeQuery = true)""",
            """@NativeQuery("select 1")""",
            """@NamedNativeQuery(name = "x", query = "select 1")""",
            """private val jdbc: JdbcTemplate""",
            """private val jdbc: NamedParameterJdbcTemplate""",
            """private val jdbc: JdbcClient""",
            """import javax.sql.DataSource""",
            """import java.sql.ResultSet""",
            """DriverManager.getConnection(url)""",
            """session.doWork { it.close() }""",
            """session.doReturningWork { it }""",
            """connection.createStatement()""",
            """connection.prepareStatement("select 1")""",
            """connection.prepareCall("call x()")""",
            """@Formula("lower(name)")""",
            """@SQLRestriction("deleted = false")"""
        )
        samples.forEach { sample -> assertEquals(1, nativeSqlUses(sample).size) { sample } }
    }

    @Test
    fun jpqlAndCommentsAreNotNativeAccess() {
        val code = """
            // JdbcTemplate in a line comment
            /* createNativeQuery in a block
               comment */
            /** KDoc naming java.sql.Array */
            val recipe = entityManager.createQuery("select r from Recipe r", Recipe::class.java)
            @Query("select b from Bean b")
        """
        assertEquals(emptyList<String>(), nativeSqlUses(code))
    }

    private fun nativeSqlUses(source: String): List<String> {
        val code = source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "")
        return NATIVE_ACCESS.findAll(code).map { it.value }.toList()
    }

    private companion object {
        val BLOCK_COMMENT = Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL)
        val LINE_COMMENT = Regex("(^|\\s)//[^\\n]*")
        val NATIVE_ACCESS = Regex(
            listOf(
                "createNative\\w*",
                "nativeQuery\\s*=",
                "@NativeQuery",
                "@NamedNativeQuer(y|ies)",
                "\\b\\w*JdbcTemplate\\b",
                // Each call on an injected template, so one more statement raises the count.
                "\\b\\w*[jJ]dbc\\w*\\.\\w+\\(",
                "\\bJdbcClient\\b",
                "\\bjavax\\.sql\\.",
                "\\bjava\\.sql\\.",
                "\\bDriverManager\\b",
                "\\bdoWork\\b",
                "\\bdoReturningWork\\b",
                "\\.createStatement\\(",
                "\\.prepareStatement\\(",
                "\\.prepareCall\\(",
                "@Formula\\b",
                "@SQL[A-Z]\\w*"
            ).joinToString("|")
        )
    }
}
