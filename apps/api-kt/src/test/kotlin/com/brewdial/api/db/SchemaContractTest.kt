package com.brewdial.api.db

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.io.File
import javax.sql.DataSource

/**
 * PostgreSQL and MySQL must expose the same schema: the same tables and views,
 * the same columns, and the same NOT NULL rules on tables. Both CI jobs compare
 * the migrated database against one checked-in contract, so a migration added
 * for one vendor only fails the other job.
 */
@SpringBootTest
class SchemaContractTest {
    @Autowired
    private lateinit var dataSource: DataSource

    @Test
    fun migratedSchemaMatchesTheSharedContract() {
        val actual = describeSchema()
        val contract = File(CONTRACT)
        if (System.getenv("UPDATE_SCHEMA_CONTRACT") == "1") contract.writeText(actual)
        assertEquals(contract.readText(), actual, "schema differs from $CONTRACT (vendor-specific migration missing?)")
    }

    private fun describeSchema(): String = dataSource.connection.use { connection ->
        val meta = connection.metaData
        val relations = sortedMapOf<String, String>()
        meta.getTables(connection.catalog, connection.schema, "%", arrayOf("TABLE", "VIEW")).use { tables ->
            while (tables.next()) {
                val name = tables.getString("TABLE_NAME")
                if (name !in IGNORED) relations[name] = tables.getString("TABLE_TYPE")
            }
        }
        buildString {
            relations.forEach { (relation, type) ->
                appendLine("${type.lowercase()} $relation")
                val columns = sortedMapOf<String, String>()
                meta.getColumns(connection.catalog, connection.schema, relation, "%").use { rows ->
                    while (rows.next()) {
                        val nullable = if (rows.getString("IS_NULLABLE") == "NO") "not null" else "null"
                        // View nullability is inferred differently by each vendor.
                        columns[rows.getString("COLUMN_NAME")] = if (type == "VIEW") "" else " $nullable"
                    }
                }
                columns.forEach { (column, nullable) -> appendLine("  $column$nullable") }
            }
        }
    }

    private companion object {
        const val CONTRACT = "src/test/resources/schema-contract.txt"

        // Migration bookkeeping and the MySQL stand-in for a PostgreSQL sequence.
        val IGNORED = setOf("flyway_schema_history", "pgmigrations", "recipe_code_seq")
    }
}
