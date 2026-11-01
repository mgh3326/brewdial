package com.brewdial.api.tools

import com.brewdial.api.config.DatabaseVendor
import org.slf4j.LoggerFactory
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.math.BigDecimal
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.time.Duration
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Encodes one row for the checksum. A value is `<length>:<value>` and SQL NULL is
 * `-:`, so no value can imitate a column boundary, a row boundary or NULL: two
 * rows encode the same only when every value is the same.
 */
internal fun checksumRow(values: List<String?>): String =
    values.joinToString("") { value -> if (value == null) "-:" else "${value.length}:$value" }

internal enum class CopyMode {
    /** Load a freshly migrated target; refuses a target that holds rows. */
    COPY,

    /** Delete every target row and load the source, in one target transaction. */
    REPLACE,

    /** Compare only; writes nothing. */
    VERIFY;

    companion object {
        fun parse(value: String): CopyMode = entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
            ?: error("BREWDIAL_COPY_MODE must be copy, replace or verify")
    }
}

internal class CopyEndpoint(val connection: Connection, val vendor: DatabaseVendor)

/**
 * Copies and verifies the whole dataset between the PostgreSQL and MySQL schemas,
 * in either direction. The source decides the column list; any table, column or
 * sequence the two sides do not share stops the run before it writes anything.
 *
 * Checksum: SHA-256 over each table's rows, every value in a vendor-neutral
 * canonical form (UUIDs as text, JSON with sorted keys and normalised numbers,
 * text[] as JSON arrays, timestamps as UTC instants), each row encoded by
 * [checksumRow], rows sorted.
 */
internal class DatabaseCopy(
    private val source: CopyEndpoint,
    private val target: CopyEndpoint,
    private val output: (String) -> Unit = ::println,
    private val quietTimeout: Duration = Duration.ofSeconds(120)
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** Exact JSON numbers: as doubles, two values that differ past 17 digits would compare equal. */
    private val objectMapper = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build()

    init {
        require(source.vendor != target.vendor) { "source and target must be different database vendors" }
    }

    /**
     * Returns true when every table and sequence matches after the run. A write
     * is compared inside its transaction and commits only if everything matches.
     */
    fun run(mode: CopyMode): Boolean {
        waitForQuietSource()
        checkPostgresOwnership()
        // One snapshot of the source for the whole copy and verification.
        source.connection.transactionIsolation = Connection.TRANSACTION_REPEATABLE_READ
        source.connection.autoCommit = false
        source.connection.isReadOnly = true
        try {
            val columns = TABLES.associateWith { table -> sharedColumns(table) }
            checkTableList(source)
            checkTableList(target)
            checkCounterList(source)
            checkCounterList(target)
            return if (mode == CopyMode.VERIFY) report(columns) else write(mode, columns)
        } finally {
            source.connection.rollback()
        }
    }

    /**
     * A snapshot cannot see a write that commits after it starts, so the source must
     * be quiet first. This runs before the snapshot: PostgreSQL caches its activity
     * view for a whole transaction. It cannot see sessions of another non-superuser
     * role; the verify steps catch those once they commit.
     */
    private fun waitForQuietSource() {
        val deadline = System.nanoTime() + quietTimeout.toNanos()
        while (true) {
            val active = query(source.connection, activeSessionsSql()) { rows ->
                rows.next()
                rows.getLong(1)
            }
            if (active == 0L) return
            check(System.nanoTime() < deadline) {
                "the ${source.vendor} source still has $active session(s) that could write after waiting $quietTimeout; refusing to read it"
            }
            log.info("waiting for {} session(s) on the {} source", active, source.vendor)
            Thread.sleep(QUIET_POLL_MILLIS)
        }
    }

    /**
     * The copy into PostgreSQL disables user triggers, which only the table owner may
     * do. Checked in both directions, so that the cutover fails rather than the rollback.
     */
    private fun checkPostgresOwnership() {
        val postgres = if (source.vendor == DatabaseVendor.POSTGRESQL) source else target
        val tables = TABLES.joinToString(", ") { "'$it'" }
        val foreign = mutableListOf<String>()
        query(
            postgres.connection,
            "select tablename from pg_tables where schemaname = current_schema() and tablename in ($tables) and tableowner <> current_user"
        ) { rows -> while (rows.next()) foreign += rows.getString(1) }
        check(foreign.isEmpty()) { "the PostgreSQL role does not own $foreign, so a rollback could not load them" }
    }

    private fun activeSessionsSql(): String = when (source.vendor) {
        // Sessions holding a transaction ID have written or are writing.
        DatabaseVendor.POSTGRESQL ->
            "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() " +
                "and backend_type = 'client backend' and backend_xid is not null"
        // MySQL is the source only for a rollback, with api-kt stopped. The application
        // user then has no reason to be connected, and an open transaction looks idle
        // without the PROCESS privilege, so any other session of this user counts.
        DatabaseVendor.MYSQL ->
            "select count(*) from information_schema.processlist where user = substring_index(current_user(), '@', 1) and id <> connection_id()"
    }

    /**
     * The source column list, after proving that the target has exactly those
     * columns. A column on one side only is data that the copy would drop, in
     * this direction or on the way back.
     */
    private fun sharedColumns(table: String): Map<String, SharedColumn> {
        val fromSource = columns(source, table)
        val fromTarget = columns(target, table)
        val drift = (fromSource.keys - fromTarget.keys).map { "$table.$it exists only in ${source.vendor}" } +
            (fromTarget.keys - fromSource.keys).map { "$table.$it exists only in ${target.vendor}" }
        check(drift.isEmpty()) { "schema drift: $drift" }
        return fromSource.mapValues { (name, column) -> SharedColumn(column, fromTarget.getValue(name)) }
    }

    private fun columns(endpoint: CopyEndpoint, table: String): Map<String, Column> {
        val columns = linkedMapOf<String, Column>()
        val connection = endpoint.connection
        connection.metaData.getColumns(connection.catalog, connection.schema, table, "%").use { rows ->
            while (rows.next()) {
                // The table name is a LIKE pattern, and `_` matches any character.
                if (rows.getString("TABLE_NAME") != table) continue
                val type = rows.getString("TYPE_NAME").lowercase()
                val name = rows.getString("COLUMN_NAME")
                columns[name] = Column(name, type, if (type == "varchar") rows.getInt("COLUMN_SIZE") else null)
            }
        }
        check(columns.isNotEmpty()) { "${endpoint.vendor} table $table has no columns" }
        return columns
    }

    private fun checkTableList(endpoint: CopyEndpoint) {
        val tables = mutableSetOf<String>()
        val connection = endpoint.connection
        connection.metaData.getTables(connection.catalog, connection.schema, "%", arrayOf("TABLE")).use { rows ->
            while (rows.next()) tables += rows.getString("TABLE_NAME")
        }
        val unknown = tables - TABLES.toSet() - NOT_COPIED_TABLES
        check(unknown.isEmpty()) { "${endpoint.vendor} tables not covered by the copy: $unknown (update DatabaseCopy.TABLES)" }
    }

    /** Every generated-number source must be carried over and verified, or be known to need neither. */
    private fun checkCounterList(endpoint: CopyEndpoint) {
        val sql = when (endpoint.vendor) {
            DatabaseVendor.POSTGRESQL -> "select sequencename from pg_sequences where schemaname = current_schema()"
            DatabaseVendor.MYSQL ->
                "select table_name from information_schema.tables where table_schema = database() and auto_increment is not null"
        }
        val found = mutableSetOf<String>()
        query(endpoint.connection, sql) { rows -> while (rows.next()) found += rows.getString(1) }
        val unknown = found - RECIPE_CODE_SEQUENCE - NOT_COPIED_SEQUENCES
        check(unknown.isEmpty()) { "${endpoint.vendor} sequences not covered by the copy: $unknown (update DatabaseCopy)" }
    }

    /**
     * MySQL bounds the VARCHAR columns that PostgreSQL keeps as unbounded text.
     * Reports every oversized value at once, before anything is written.
     */
    private fun checkCapacity(columns: Map<String, Map<String, SharedColumn>>) {
        if (target.vendor != DatabaseVendor.MYSQL) return
        val tooLong = columns.flatMap { (table, tableColumns) ->
            tableColumns.values.filter { it.target.maxChars != null }.mapNotNull { column ->
                val maxChars = column.target.maxChars
                val sql = "select count(*) from ${name(source, table)} where char_length(${name(source, column.name)}::text) > $maxChars"
                val rows = query(source.connection, sql) { result ->
                    result.next()
                    result.getLong(1)
                }
                if (rows > 0) "$table.${column.name}: $rows rows longer than $maxChars" else null
            }
        }
        check(tooLong.isEmpty()) { "source values do not fit the MySQL columns: $tooLong" }
    }

    private fun write(mode: CopyMode, columns: Map<String, Map<String, SharedColumn>>): Boolean {
        checkCapacity(columns)
        if (mode == CopyMode.REPLACE) checkSourceHasData()
        val connection = target.connection
        val previousCounter = readCounter(target)
        var counterWritten = false
        connection.autoCommit = false
        try {
            suspendTriggers()
            if (mode == CopyMode.REPLACE) {
                TABLES.asReversed().forEach { table -> execute("delete from ${name(target, table)}") }
            } else {
                // The baseline migration seeds this row; the source row replaces it.
                execute("delete from ${name(target, "bd_migration_meta")}")
                TABLES.forEach { table -> checkEmpty(table) }
            }
            TABLES.forEach { table -> copyTable(table, columns.getValue(table)) }
            resumeTriggers()
            val counter = readCounter(source)
            counterWritten = true
            writeCounter(counter)
            val ok = report(columns)
            if (ok) {
                connection.commit()
                log.info("{} {} tables; {}={}", mode, TABLES.size, RECIPE_CODE_SEQUENCE, counter)
            } else {
                undoWrite(previousCounter, counterWritten)
                output("COPY_ROLLED_BACK the target keeps its previous rows")
            }
            return ok
        } catch (failure: Throwable) {
            undoWrite(previousCounter, counterWritten)
            throw failure
        } finally {
            if (target.vendor == DatabaseVendor.MYSQL) execute("set @bd_replication_role = null")
            connection.autoCommit = true
        }
    }

    private fun undoWrite(previousCounter: Long, counterWritten: Boolean) {
        target.connection.rollback()
        // PostgreSQL setval ignores the rollback.
        if (counterWritten && target.vendor == DatabaseVendor.POSTGRESQL) {
            writeCounter(previousCounter)
            target.connection.commit()
        }
    }

    /** A replace deletes every target row, so an empty source would erase the data and still verify. */
    private fun checkSourceHasData() {
        val hasData = (TABLES - "bd_migration_meta").any { table ->
            query(source.connection, "select count(*) from ${name(source, table)}") { rows ->
                rows.next()
                rows.getLong(1) > 0
            }
        }
        check(hasData) { "the ${source.vendor} source holds no data; refusing to replace the target with it" }
    }

    /**
     * Loads rows exactly as they are. MySQL: the triggers' own bypass flag.
     * PostgreSQL: the table owner may disable user triggers (foreign keys stay
     * on), and the change is part of the transaction, so a failure restores them.
     */
    private fun suspendTriggers() = when (target.vendor) {
        DatabaseVendor.MYSQL -> execute("set @bd_replication_role = 'replica'")
        DatabaseVendor.POSTGRESQL -> {
            execute("set local lock_timeout = '30s'")
            TABLES.forEach { table -> execute("alter table ${name(target, table)} disable trigger user") }
        }
    }

    private fun resumeTriggers() {
        if (target.vendor == DatabaseVendor.POSTGRESQL) {
            TABLES.forEach { table -> execute("alter table ${name(target, table)} enable trigger user") }
        }
    }

    private fun checkEmpty(table: String) {
        val rows = query(target.connection, "select count(*) from ${name(target, table)}") { result ->
            result.next()
            result.getLong(1)
        }
        check(rows == 0L) { "target table $table is not empty; copy needs a freshly migrated database" }
    }

    private fun copyTable(table: String, columns: Map<String, SharedColumn>) {
        val list = columns.values.toList()
        val placeholders = list.joinToString(", ") { placeholder(it.target) }
        val insert = "insert into ${name(target, table)} (${list.joinToString(", ") { name(target, it.name) }}) values ($placeholders)"
        val select = "select ${list.joinToString(", ") { name(source, it.name) }} from ${name(source, table)}"
        var count = 0
        target.connection.prepareStatement(insert).use { statement ->
            source.connection.createStatement().use { reader ->
                reader.fetchSize = if (source.vendor == DatabaseVendor.POSTGRESQL) BATCH else 0
                reader.executeQuery(select).use { rows ->
                    while (rows.next()) {
                        list.forEachIndexed { index, column -> statement.setObject(index + 1, targetValue(rows, index + 1, column)) }
                        statement.addBatch()
                        if (++count % BATCH == 0) statement.executeBatch()
                    }
                }
            }
            statement.executeBatch()
        }
        log.info("copied {} rows into {}", count, table)
    }

    private fun placeholder(column: Column): String = when (column.type) {
        "json" -> "cast(? as json)"
        "jsonb" -> "cast(? as jsonb)"
        "uuid" -> "cast(? as uuid)"
        else -> "?"
    }

    private fun targetValue(rows: ResultSet, index: Int, column: SharedColumn): Any? {
        val raw = readValue(rows, index) ?: return null
        return when {
            raw is OffsetDateTime -> raw.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime()
            raw is LocalDateTime -> raw.atOffset(ZoneOffset.UTC)
            raw is java.sql.Array -> objectMapper.writeValueAsString(arrayValues(raw))
            column.target.type == PG_TEXT_ARRAY -> target.connection.createArrayOf("text", textArray(raw.toString()))
            column.target.isJson -> raw.toString()
            // DECIMAL(38,10) pads 0.5 to 0.5000000000; unbounded numeric would keep the padding.
            raw is BigDecimal -> BigDecimal(raw.stripTrailingZeros().toPlainString())
            raw is java.util.UUID -> raw.toString()
            else -> raw
        }
    }

    private fun textArray(json: String): Array<String?> =
        objectMapper.readTree(json).values().map { if (it.isNull) null else it.asText() }.toTypedArray()

    private fun readCounter(endpoint: CopyEndpoint): Long = when (endpoint.vendor) {
        DatabaseVendor.POSTGRESQL -> query(endpoint.connection, "select last_value, is_called from $RECIPE_CODE_SEQUENCE") { rows ->
            rows.next()
            if (rows.getBoolean(2)) rows.getLong(1) else rows.getLong(1) - 1
        }
        DatabaseVendor.MYSQL -> query(endpoint.connection, "select value from $RECIPE_CODE_SEQUENCE where id = 1") { rows ->
            check(rows.next()) { "$RECIPE_CODE_SEQUENCE has no row" }
            rows.getLong(1)
        }
    }

    /** The counter is the last number handed out; 0 means none was. */
    private fun writeCounter(value: Long) {
        val sql = when (target.vendor) {
            DatabaseVendor.POSTGRESQL ->
                if (value > 0) "select setval('$RECIPE_CODE_SEQUENCE', $value, true)" else "select setval('$RECIPE_CODE_SEQUENCE', 1, false)"
            DatabaseVendor.MYSQL -> "update $RECIPE_CODE_SEQUENCE set value = $value where id = 1"
        }
        execute(sql)
    }

    private fun report(columns: Map<String, Map<String, SharedColumn>>): Boolean {
        val tables = TABLES.map { table -> compare(table, columns.getValue(table).keys.toList()) }
        val counter = CounterReport(RECIPE_CODE_SEQUENCE, readCounter(source), readCounter(target))
        tables.forEach { log.info(it.line()) }
        log.info(counter.line())
        output(tables.joinToString("\n", prefix = "TABLE\tSOURCE_ROWS\tTARGET_ROWS\tSOURCE_SHA256\tTARGET_SHA256\tRESULT\n") { it.line() })
        output("SEQUENCE\tSOURCE_VALUE\tTARGET_VALUE\tRESULT\n${counter.line()}")
        val ok = tables.all { it.matches } && counter.matches
        output(
            if (ok) {
                "COPY_VERIFY_OK source=${source.vendor} target=${target.vendor} tables=${tables.size} sequences=1"
            } else {
                "COPY_VERIFY_MISMATCH source=${source.vendor} target=${target.vendor}"
            }
        )
        return ok
    }

    private fun compare(table: String, columnNames: List<String>): TableReport {
        val fromSource = digest(source, table, columnNames)
        val fromTarget = digest(target, table, columnNames)
        return TableReport(table, fromSource.first, fromTarget.first, fromSource.second, fromTarget.second)
    }

    private fun digest(endpoint: CopyEndpoint, table: String, columnNames: List<String>): Pair<Long, String> {
        val own = columns(endpoint, table)
        val list = columnNames.map { own.getValue(it) }
        val sql = "select ${list.joinToString(", ") { name(endpoint, it.name) }} from ${name(endpoint, table)}"
        val lines = mutableListOf<String>()
        query(endpoint.connection, sql) { rows ->
            while (rows.next()) {
                lines += checksumRow(list.indices.map { index -> canonical(rows, index + 1, list[index]) })
            }
        }
        lines.sort()
        val sha = MessageDigest.getInstance("SHA-256")
        lines.forEach { line -> sha.update(line.toByteArray(Charsets.UTF_8)) }
        return lines.size.toLong() to sha.digest().joinToString("") { "%02x".format(it) }
    }

    private fun canonical(rows: ResultSet, index: Int, column: Column): String? {
        val raw = readValue(rows, index) ?: return null
        return when {
            raw is OffsetDateTime -> raw.toInstant().toString()
            raw is LocalDateTime -> raw.toInstant(ZoneOffset.UTC).toString()
            raw is java.sql.Array -> canonicalJson(objectMapper.valueToTree(arrayValues(raw)))
            column.isJson -> canonicalJson(objectMapper.readTree(raw.toString()))
            raw is BigDecimal -> raw.stripTrailingZeros().toPlainString()
            else -> raw.toString()
        }
    }

    private fun readValue(rows: ResultSet, index: Int): Any? = when (rows.metaData.getColumnTypeName(index).lowercase()) {
        "timestamptz" -> rows.getObject(index, OffsetDateTime::class.java)
        "datetime" -> rows.getObject(index, LocalDateTime::class.java)
        else -> rows.getObject(index)
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

    private fun execute(sql: String) {
        target.connection.createStatement().use { it.execute(sql) }
    }

    private fun <T> query(connection: Connection, sql: String, read: (ResultSet) -> T): T =
        connection.createStatement().use { statement -> statement.executeQuery(sql).use(read) }

    private fun name(endpoint: CopyEndpoint, identifier: String) = when (endpoint.vendor) {
        DatabaseVendor.POSTGRESQL -> "\"$identifier\""
        DatabaseVendor.MYSQL -> "`$identifier`"
    }

    private class Column(val name: String, val type: String, val maxChars: Int?) {
        val isJson get() = type == "json" || type == "jsonb"
    }

    private class SharedColumn(val source: Column, val target: Column) {
        val name get() = source.name
    }

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

    private class CounterReport(val name: String, val sourceValue: Long, val targetValue: Long) {
        val matches get() = sourceValue == targetValue

        fun line() = "$name\t$sourceValue\t$targetValue\t${if (matches) "OK" else "MISMATCH"}"
    }

    internal companion object {
        private const val BATCH = 500
        private const val QUIET_POLL_MILLIS = 500L
        private const val PG_TEXT_ARRAY = "_text"
        const val RECIPE_CODE_SEQUENCE = "recipe_code_seq"

        /** Foreign-key order: every table after the tables it references. */
        val TABLES = listOf(
            "app_users", "beans", "recipes", "feedback", "preferences", "bd_migration_meta",
            "user_identities", "grinders", "drippers", "user_gear", "grinder_calibration",
            "saved_recipes", "saved_beans", "bean_photos", "bean_purchase_links"
        )

        /** Migration history belongs to each side; recipe_code_seq is MySQL's sequence table. */
        private val NOT_COPIED_TABLES = setOf("flyway_schema_history", "pgmigrations", RECIPE_CODE_SEQUENCE)
        private val NOT_COPIED_SEQUENCES = setOf("pgmigrations_id_seq")
    }
}
