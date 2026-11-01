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
        val root = File("src/main")
        val found = root.walkTopDown().filter { it.extension in setOf("kt", "java", "xml") }
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
            """entityManager.createStoredProcedureQuery("x")""",
            """@Procedure("x")""",
            """jdbcTemplate.update("delete from x")""",
            """private val jdbc: JdbcOperations""",
            """SimpleJdbcInsert(dataSource)""",
            """@JoinFormula("lower(name)")""",
            """@ColumnTransformer(read = "lower(name)")""",
            """@Subselect("select 1")""",
            """@Filter(name = "x")""",
            """createQuery("select function('lower', b.name) from Bean b")""",
            """createQuery("select sql('lower(?)', b.name) from Bean b")""",
            """<named-native-query name="x"/>""",
            """val url = "https://x" ; jdbcTemplate""",
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
            """@SQLRestriction("deleted = false")""",
            """val glob = "/*" ; jdbcTemplate ; val end = "*/" """
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
        val code = STRING_OR_COMMENT.replace(source) { match -> if (match.value.startsWith("\"")) match.value else "" }
        return NATIVE_ACCESS.findAll(code).map { it.value }.toList()
    }

    private companion object {
        // Strings first, so that a `//` or `/*` inside one does not hide the code after it.
        val STRING_OR_COMMENT = Regex("\"\"\"[\\s\\S]*?\"\"\"|\"(?:\\\\.|[^\"\\\\\\n])*\"|/\\*[\\s\\S]*?\\*/|//[^\\n]*")
        val NATIVE_ACCESS = Regex(
            listOf(
                "createNative\\w*",
                "createStoredProcedureQuery",
                "nativeQuery\\s*=",
                "@NativeQuery",
                "@NamedNativeQuer(y|ies)",
                "@Procedure\\b",
                "\\b\\w*[jJ]dbc(Template|Client|Operations)\\b",
                "\\bSimpleJdbc\\w+",
                "\\bjavax\\.sql\\.",
                "\\bjava\\.sql\\.",
                "\\bDriverManager\\b",
                "\\bdoWork\\b",
                "\\bdoReturningWork\\b",
                "\\.createStatement\\(",
                "\\.prepareStatement\\(",
                "\\.prepareCall\\(",
                "@Formula\\b",
                "@JoinFormula\\b",
                "@ColumnTransformer\\b",
                "@Subselect\\b",
                "@Filter(Def)?\\b",
                "@SQL[A-Z]\\w*",
                // JPQL escape hatches into database functions and fragments.
                "\\bfunction\\s*\\(\\s*'",
                "\\bsql\\s*\\(\\s*'",
                "<(named-)?native-query\\b"
            ).joinToString("|")
        )
    }
}
