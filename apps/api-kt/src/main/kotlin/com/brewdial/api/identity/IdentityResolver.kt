package com.brewdial.api.identity

import com.brewdial.api.config.DatabaseVendor
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

interface IdentityResolver {
    fun resolve(provider: String, externalKey: String): String
}

@Component
class JdbcIdentityResolver(
    private val jdbcTemplate: JdbcTemplate,
    private val vendor: DatabaseVendor,
    transactionManager: PlatformTransactionManager
) : IdentityResolver {
    private val newTransaction = TransactionTemplate(transactionManager).apply {
        propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
    }

    override fun resolve(provider: String, externalKey: String): String = when (vendor) {
        DatabaseVendor.POSTGRESQL -> resolveWithFunction(provider, externalKey)
        DatabaseVendor.MYSQL -> resolveInApplication(provider, externalKey)
    }

    private fun resolveWithFunction(provider: String, externalKey: String): String {
        val appUserId = jdbcTemplate.queryForObject(
            "select resolve_app_user(?, ?)",
            UUID::class.java,
            provider,
            externalKey
        )
        return requireNotNull(appUserId) { "resolve_app_user returned null" }.toString()
    }

    /**
     * MySQL port of resolve_app_user. PostgreSQL serialises first touches with
     * an advisory lock; here the unique (provider, external_key) key does it:
     * the app user and its identity are inserted in one transaction, so a racing
     * loser rolls back both rows (no orphan app_users) and reads the winner's.
     */
    private fun resolveInApplication(provider: String, externalKey: String): String {
        require(provider == "toss_anon" || provider == "web_local") {
            "resolve_app_user: v1 RPC accepts only toss_anon|web_local"
        }
        require(externalKey.isNotBlank() && externalKey.length >= MIN_EXTERNAL_KEY_LENGTH) {
            "resolve_app_user: external_key too short"
        }
        findAppUser(provider, externalKey)?.let { return it }
        return try {
            newTransaction.execute {
                val appUserId = UUID.randomUUID().toString()
                jdbcTemplate.update("insert into app_users (id) values (?)", appUserId)
                jdbcTemplate.update(
                    "insert into user_identities (app_user_id, provider, external_key, verified) values (?, ?, ?, false)",
                    appUserId,
                    provider,
                    externalKey
                )
                appUserId
            } ?: error("resolve_app_user transaction returned null")
        } catch (_: DuplicateKeyException) {
            requireNotNull(findAppUser(provider, externalKey)) {
                "resolve_app_user: identity vanished after a concurrent insert"
            }
        }
    }

    private fun findAppUser(provider: String, externalKey: String): String? = jdbcTemplate.queryForList(
        "select app_user_id from user_identities where provider = ? and external_key = ?",
        String::class.java,
        provider,
        externalKey
    ).firstOrNull()

    private companion object {
        const val MIN_EXTERNAL_KEY_LENGTH = 16
    }
}
