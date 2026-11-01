package com.brewdial.api.tools

import com.brewdial.api.config.DatabaseUrlParser
import com.brewdial.api.config.DatabaseVendor
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.ApplicationContext
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.security.MessageDigest
import java.sql.Connection
import java.sql.DriverManager
import java.sql.ResultSet
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import javax.sql.DataSource
import kotlin.system.exitProcess

/**
 * One-shot PostgreSQL → MySQL data copy with verification (runbook
 * docs/runbooks/oci-heatwave-cutover.md). It runs inside the normal api-kt
 * image: DATABASE_URL is the MySQL target (Flyway creates the schema first),
 * BREWDIAL_COPY_SOURCE_URL the PostgreSQL source, BREWDIAL_COPY_MODE `copy`
 * (copy, then verify) or `verify` (verify only). It exits when done: 0 when
 * every table's row count and checksum match, non-zero otherwise.
 *
 * Checksum: SHA-256 over each table's rows, every value in a vendor-neutral
 * canonical form (UUIDs as text, JSON with sorted keys and normalised numbers,
 * text[] as JSON arrays, timestamps as UTC instants), rows sorted.
 */
@Component
@ConditionalOnProperty("brewdial.copy.source-url")
class DatabaseCopyRunner(
    private val target: DataSource,
    private val vendor: DatabaseVendor,
    private val objectMapper: ObjectMapper,
    private val environment: Environment,
    private val context: ApplicationContext
) : ApplicationRunner {
    private val log = LoggerFactory.getLogger(javaClass)

    override fun run(args: ApplicationArguments) {
        val ok = try {
            execute()
        } catch (exception: Exception) {
            log.error("database copy failed", exception)
            false
        }
        exitProcess(SpringApplication.exit(context, { if (ok) 0 else 1 }))
    }

    fun execute(): Boolean {
        check(vendor == DatabaseVendor.MYSQL) { "DATABASE_URL (the copy target) must be mysql://" }
        val source = DatabaseUrlParser.parse(environment.getRequiredProperty("brewdial.copy.source-url"))
        check(source.vendor == DatabaseVendor.POSTGRESQL) { "BREWDIAL_COPY_SOURCE_URL must be postgres://" }
        val mode = environment.getProperty("brewdial.copy.mode", "copy")
        check(mode == "copy" || mode == "verify") { "BREWDIAL_COPY_MODE must be copy or verify" }

        DriverManager.getConnection(source.jdbcUrl, source.username, source.password).use { pg ->
            // One snapshot for the whole copy and verification.
            pg.transactionIsolation = Connection.TRANSACTION_REPEATABLE_READ
            pg.autoCommit = false
            pg.isReadOnly = true
            target.connection.use { mysql ->
                checkTableList(mysql)
                if (mode == "copy") copy(pg, mysql)
                val report = TABLES.map { table -> compare(pg, mysql, table) }
                report.forEach { log.info(it.line()) }
                println(report.joinToString("\n", prefix = "TABLE\tPOSTGRES_ROWS\tMYSQL_ROWS\tPOSTGRES_SHA256\tMYSQL_SHA256\tRESULT\n") { it.line() })
                pg.rollback()
                val ok = report.all { it.matches }
                println(if (ok) "COPY_VERIFY_OK tables=${report.size}" else "COPY_VERIFY_MISMATCH")
                return ok
            }
        }
    }

    private fun checkTableList(mysql: Connection) {
        val tables = mutableSetOf<String>()
        mysql.metaData.getTables(mysql.catalog, null, "%", arrayOf("TABLE")).use { rows ->
            while (rows.next()) tables += rows.getString("TABLE_NAME")
        }
        val unknown = tables - TABLES.toSet() - setOf("flyway_schema_history", "recipe_code_seq")
        check(unknown.isEmpty()) { "tables not covered by the copy: $unknown (update DatabaseCopyRunner.TABLES)" }
    }

    /**
     * MySQL bounds the VARCHAR columns that PostgreSQL keeps as unbounded text.
     * Reports every oversized value at once, before anything is written.
     */
    private fun checkCapacity(pg: Connection, mysql: Connection) {
        val tooLong = TABLES.flatMap { table ->
            targetColumns(mysql, table).filter { it.maxChars != null }.mapNotNull { column ->
                val sql = "select count(*) from ${pgName(table)} where char_length(${pgName(column.name)}::text) > ${column.maxChars}"
                val rows = pg.createStatement().use { statement ->
                    statement.executeQuery(sql).use { result ->
                        result.next()
                        result.getLong(1)
                    }
                }
                if (rows > 0) "$table.${column.name}: $rows rows longer than ${column.maxChars}" else null
            }
        }
        check(tooLong.isEmpty()) { "source values do not fit the MySQL columns: $tooLong" }
    }

    private fun copy(pg: Connection, mysql: Connection) {
        checkCapacity(pg, mysql)
        mysql.autoCommit = false
        try {
            mysql.createStatement().use { statement ->
                statement.execute("set @bd_replication_role = 'replica'")
                // V1 seeds this row; the source row replaces it.
                statement.execute("delete from bd_migration_meta")
                TABLES.forEach { table ->
                    statement.executeQuery("select count(*) from ${mysqlName(table)}").use { rows ->
                        rows.next()
                        check(rows.getLong(1) == 0L) { "target table $table is not empty; copy needs a freshly migrated database" }
                    }
                }
            }
            TABLES.forEach { table -> copyTable(pg, mysql, table) }
            val (lastValue, isCalled) = pg.createStatement().use { statement ->
                statement.executeQuery("select last_value, is_called from recipe_code_seq").use { rows ->
                    rows.next()
                    rows.getLong(1) to rows.getBoolean(2)
                }
            }
            // recipe_code_seq.value is the last number handed out.
            mysql.prepareStatement("update recipe_code_seq set value = ? where id = 1").use { statement ->
                statement.setLong(1, if (isCalled) lastValue else lastValue - 1)
                statement.executeUpdate()
            }
            mysql.commit()
            log.info("copied {} tables; recipe_code_seq last_value={} is_called={}", TABLES.size, lastValue, isCalled)
        } catch (exception: Exception) {
            mysql.rollback()
            throw exception
        } finally {
            mysql.createStatement().use { it.execute("set @bd_replication_role = null") }
            mysql.autoCommit = true
        }
    }

    private fun copyTable(pg: Connection, mysql: Connection, table: String) {
        val columns = targetColumns(mysql, table)
        val placeholders = columns.joinToString(", ") { if (it.json) "cast(? as json)" else "?" }
        val insert = "insert into ${mysqlName(table)} (${columns.joinToString(", ") { mysqlName(it.name) }}) values ($placeholders)"
        var count = 0
        mysql.prepareStatement(insert).use { statement ->
            pg.createStatement().use { select ->
                select.fetchSize = BATCH
                select.executeQuery("select ${columns.joinToString(", ") { pgName(it.name) }} from ${pgName(table)}").use { rows ->
                    while (rows.next()) {
                        columns.forEachIndexed { index, column -> statement.setObject(index + 1, pgValueForMySql(rows, index + 1, column)) }
                        statement.addBatch()
                        if (++count % BATCH == 0) statement.executeBatch()
                    }
                }
            }
            statement.executeBatch()
        }
        log.info("copied {} rows into {}", count, table)
    }

    private fun pgValueForMySql(rows: ResultSet, index: Int, column: Column): Any? {
        val raw = when (rows.metaData.getColumnTypeName(index)) {
            "timestamptz" -> rows.getObject(index, OffsetDateTime::class.java)
            else -> rows.getObject(index)
        } ?: return null
        return when {
            raw is OffsetDateTime -> raw.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime()
            raw is java.sql.Array -> objectMapper.writeValueAsString(arrayValues(raw))
            column.json -> raw.toString()
            raw is java.util.UUID -> raw.toString()
            else -> raw
        }
    }

    private fun compare(pg: Connection, mysql: Connection, table: String): TableReport {
        val columns = targetColumns(mysql, table)
        val source = digest(pg, "select ${columns.joinToString(", ") { pgName(it.name) }} from ${pgName(table)}", columns)
        val copy = digest(mysql, "select ${columns.joinToString(", ") { mysqlName(it.name) }} from ${mysqlName(table)}", columns)
        return TableReport(table, source.first, copy.first, source.second, copy.second)
    }

    private fun digest(connection: Connection, sql: String, columns: List<Column>): Pair<Long, String> {
        val lines = mutableListOf<String>()
        connection.createStatement().use { statement ->
            statement.executeQuery(sql).use { rows ->
                while (rows.next()) {
                    lines += columns.indices.joinToString("\u001f") { index -> canonical(rows, index + 1, columns[index]) }
                }
            }
        }
        lines.sort()
        val sha = MessageDigest.getInstance("SHA-256")
        lines.forEach { line -> sha.update(line.toByteArray(Charsets.UTF_8)); sha.update('\n'.code.toByte()) }
        return lines.size.toLong() to sha.digest().joinToString("") { "%02x".format(it) }
    }

    private fun canonical(rows: ResultSet, index: Int, column: Column): String {
        val raw = when (rows.metaData.getColumnTypeName(index).lowercase()) {
            "timestamptz" -> rows.getObject(index, OffsetDateTime::class.java)
            "datetime" -> rows.getObject(index, LocalDateTime::class.java)
            else -> rows.getObject(index)
        } ?: return "∅"
        return when {
            raw is OffsetDateTime -> raw.toInstant().toString()
            raw is LocalDateTime -> raw.toInstant(ZoneOffset.UTC).toString()
            raw is java.sql.Array -> canonicalJson(objectMapper.valueToTree(arrayValues(raw)))
            column.json -> canonicalJson(objectMapper.readTree(raw.toString()))
            raw is java.math.BigDecimal -> raw.stripTrailingZeros().toPlainString()
            raw is Number -> raw.toString()
            else -> raw.toString()
        }
    }

    private fun canonicalJson(node: JsonNode): String = when {
        node.isObject -> node.properties().sortedBy { it.key }
            .joinToString(",", "{", "}") { (key, value) -> objectMapper.writeValueAsString(key) + ":" + canonicalJson(value) }
        node.isArray -> node.values().joinToString(",", "[", "]") { canonicalJson(it) }
        node.isNumber -> node.decimalValue().stripTrailingZeros().toPlainString()
        node.isNull -> "null"
        node.isBoolean -> node.asBoolean().toString()
        else -> objectMapper.writeValueAsString(node.asText())
    }

    private fun arrayValues(array: java.sql.Array): List<String?> = try {
        (array.array as Array<*>).map { it?.toString() }
    } finally {
        array.free()
    }

    private fun targetColumns(mysql: Connection, table: String): List<Column> {
        val columns = mutableListOf<Column>()
        mysql.metaData.getColumns(mysql.catalog, null, table, "%").use { rows ->
            while (rows.next()) {
                val type = rows.getString("TYPE_NAME")
                columns += Column(
                    name = rows.getString("COLUMN_NAME"),
                    json = type.equals("JSON", ignoreCase = true),
                    maxChars = if (type.equals("VARCHAR", ignoreCase = true)) rows.getInt("COLUMN_SIZE") else null
                )
            }
        }
        check(columns.isNotEmpty()) { "target table $table has no columns" }
        return columns
    }

    private fun pgName(name: String) = "\"$name\""

    private fun mysqlName(name: String) = "`$name`"

    private class Column(val name: String, val json: Boolean, val maxChars: Int?)

    private class TableReport(
        val table: String,
        val sourceRows: Long,
        val targetRows: Long,
        val sourceSha: String,
        val targetSha: String
    ) {
        val matches get() = sourceRows == targetRows && sourceSha == targetSha

        fun line() = "$table\t$sourceRows\t$targetRows\t$sourceSha\t$targetSha\t${if (matches) "OK" else "MISMATCH"}"
    }

    private companion object {
        const val BATCH = 500

        /** Foreign-key order: every table after the tables it references. */
        val TABLES = listOf(
            "app_users", "beans", "recipes", "feedback", "preferences", "bd_migration_meta",
            "user_identities", "grinders", "drippers", "user_gear", "grinder_calibration",
            "saved_recipes", "saved_beans", "bean_photos", "bean_purchase_links"
        )
    }
}
