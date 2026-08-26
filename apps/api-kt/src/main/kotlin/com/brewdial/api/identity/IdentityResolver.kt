package com.brewdial.api.identity

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.util.UUID

interface IdentityResolver {
    fun resolve(provider: String, externalKey: String): String
}

@Component
class JdbcIdentityResolver(
    private val jdbcTemplate: JdbcTemplate
) : IdentityResolver {
    override fun resolve(provider: String, externalKey: String): String {
        val appUserId = jdbcTemplate.queryForObject(
            "select resolve_app_user(?, ?)",
            UUID::class.java,
            provider,
            externalKey
        )
        return requireNotNull(appUserId) { "resolve_app_user returned null" }.toString()
    }
}
