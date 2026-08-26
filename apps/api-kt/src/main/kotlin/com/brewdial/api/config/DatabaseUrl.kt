package com.brewdial.api.config

import java.net.URI

class DatabaseUrlConfig(
    val jdbcUrl: String,
    val username: String,
    val password: String?
)

object DatabaseUrlParser {
    private const val DEFAULT_POSTGRES_PORT = 5432

    fun parse(value: String): DatabaseUrlConfig {
        val rawValue = value.trim()
        require(rawValue.isNotEmpty()) {
            "DATABASE_URL must be set to a postgres:// URI"
        }

        val uri = try {
            URI(rawValue)
        } catch (exception: IllegalArgumentException) {
            throw IllegalArgumentException(
                "DATABASE_URL is not a valid postgres:// URI",
                exception
            )
        }

        require(uri.scheme.equals("postgres", ignoreCase = true)) {
            "DATABASE_URL must use the postgres:// scheme (got ${uri.scheme ?: "none"})"
        }

        val userInfo = requireNotNull(uri.userInfo) {
            "DATABASE_URL must include a username before the host"
        }
        val separator = userInfo.indexOf(':')
        val username = if (separator >= 0) userInfo.substring(0, separator) else userInfo
        val password = if (separator >= 0) userInfo.substring(separator + 1) else null
        require(username.isNotEmpty()) {
            "DATABASE_URL must include a non-empty username"
        }

        val host = requireNotNull(uri.host) {
            "DATABASE_URL must include a host"
        }
        val port = if (uri.port == -1) DEFAULT_POSTGRES_PORT else uri.port
        require(port in 1..65535) {
            "DATABASE_URL must use a valid TCP port"
        }

        val databasePath = uri.rawPath.orEmpty()
        require(databasePath.length > 1 && databasePath.startsWith('/')) {
            "DATABASE_URL must include a database name in its path"
        }
        require(uri.fragment == null) {
            "DATABASE_URL must not contain a fragment"
        }

        val jdbcHost = if (host.contains(':') && !host.startsWith('[')) "[$host]" else host
        val query = uri.rawQuery?.let { "?$it" }.orEmpty()
        return DatabaseUrlConfig(
            jdbcUrl = "jdbc:postgresql://$jdbcHost:$port$databasePath$query",
            username = username,
            password = password
        )
    }
}
