package com.brewdial.api.config

/**
 * The database family behind DATABASE_URL. It is the single switch between
 * PostgreSQL and MySQL: the JDBC driver, the Flyway migration folder and the
 * few vendor-specific SQL statements all follow from it.
 */
enum class DatabaseVendor(
    val jdbcScheme: String,
    val driverClassName: String,
    val defaultPort: Int,
    /** Folder under db/migration holding this vendor's Flyway scripts. */
    val migrationFolder: String
) {
    POSTGRESQL("postgresql", "org.postgresql.Driver", 5432, "postgresql"),
    MYSQL("mysql", "com.mysql.cj.jdbc.Driver", 3306, "mysql");

    companion object {
        const val PROPERTY = "brewdial.database.vendor"

        fun fromUriScheme(scheme: String?): DatabaseVendor? = when (scheme?.lowercase()) {
            "postgres", "postgresql" -> POSTGRESQL
            "mysql" -> MYSQL
            else -> null
        }
    }
}
