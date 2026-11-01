package com.brewdial.api.config

import jakarta.persistence.EntityManager
import org.hibernate.Session
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component

@Configuration
class DatabaseVendorConfiguration {
    @Bean
    fun databaseVendor(environment: Environment): DatabaseVendor =
        DatabaseVendor.valueOf(environment.getRequiredProperty(DatabaseVendor.PROPERTY))
}

/**
 * The small SQL fragments that differ between PostgreSQL and MySQL. Whole
 * statements that differ live next to their PostgreSQL twin in the repository,
 * behind `when (sql.vendor)`.
 */
@Component
class VendorSql(val vendor: DatabaseVendor) {
    /** Placeholder for a uuid parameter bound as a string. */
    val uuid: String = when (vendor) {
        DatabaseVendor.POSTGRESQL -> "cast(? as uuid)"
        DatabaseVendor.MYSQL -> "?"
    }

    /** Placeholder for a JSON document bound as a string. */
    val json: String = when (vendor) {
        DatabaseVendor.POSTGRESQL -> "cast(? as jsonb)"
        DatabaseVendor.MYSQL -> "cast(? as json)"
    }

    /**
     * Runs [block] with owner/agent writes allowed by the recipes guard trigger.
     * Must run inside a transaction. PostgreSQL scopes the flag to the
     * transaction (set_config(..., true)). MySQL has no transaction-local
     * variables, so the session variable is cleared again before returning,
     * also on failure, and never leaks to the next user of the pooled connection.
     */
    fun <T> withOwnerWrites(entityManager: EntityManager, block: () -> T): T = when (vendor) {
        DatabaseVendor.POSTGRESQL -> {
            entityManager.createNativeQuery("select set_config('bd.owner_write_ok','on',true)").singleResult
            block()
        }
        DatabaseVendor.MYSQL -> {
            // Plain JDBC on the transaction's connection: the reset must still run
            // when a failed flush has left the Hibernate session unusable.
            val connection = entityManager.unwrap(Session::class.java).doReturningWork { it }
            connection.createStatement().use { it.execute("set @bd_owner_write_ok = 'on'") }
            try {
                block()
            } finally {
                connection.createStatement().use { it.execute("set @bd_owner_write_ok = null") }
            }
        }
    }
}
