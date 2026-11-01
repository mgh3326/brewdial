package com.brewdial.api.config

import org.springframework.boot.EnvironmentPostProcessor
import org.springframework.boot.SpringApplication
import org.springframework.core.env.ConfigurableEnvironment
import org.springframework.core.env.MapPropertySource

/**
 * Turns DATABASE_URL into datasource properties and, from its scheme, the
 * vendor defaults (driver, Flyway folder, Hibernate type preferences).
 * The connection itself always wins; vendor defaults sit last, so an explicit
 * spring.* property can still override them.
 */
class DatabaseUrlEnvironmentPostProcessor : EnvironmentPostProcessor {
    override fun postProcessEnvironment(
        environment: ConfigurableEnvironment,
        application: SpringApplication
    ) {
        val value = environment.getProperty("DATABASE_URL")
            ?: throw IllegalStateException(
                "DATABASE_URL must be set before brewdial-api can start"
            )
        val database = DatabaseUrlParser.parse(value)
        val connection = linkedMapOf<String, Any>(
            "spring.datasource.url" to database.jdbcUrl,
            "spring.datasource.username" to database.username,
            "spring.datasource.driver-class-name" to database.vendor.driverClassName,
            DatabaseVendor.PROPERTY to database.vendor.name
        )
        database.password?.let { connection["spring.datasource.password"] = it }
        replace(environment, MapPropertySource(CONNECTION_SOURCE, connection), first = true)
        replace(environment, MapPropertySource(VENDOR_DEFAULTS_SOURCE, vendorDefaults(database.vendor)), first = false)
    }

    private fun vendorDefaults(vendor: DatabaseVendor): Map<String, Any> {
        val defaults = linkedMapOf<String, Any>(
            "spring.flyway.locations" to "classpath:db/migration/${vendor.migrationFolder}"
        )
        when (vendor) {
            DatabaseVendor.POSTGRESQL -> {
                // Databases migrated by node-pg-migrate (packages/db) already hold
                // the V1 schema: record them as V1 instead of re-running it.
                defaults["spring.flyway.baseline-on-migrate"] = true
                defaults["spring.flyway.baseline-version"] = "1"
            }
            DatabaseVendor.MYSQL -> {
                // uuid columns are CHAR(36); timestamps are DATETIME(6) in UTC.
                defaults["spring.jpa.properties.hibernate.type.preferred_uuid_jdbc_type"] = "CHAR"
                defaults["spring.jpa.properties.hibernate.jdbc.time_zone"] = "UTC"
                defaults["spring.datasource.hikari.data-source-properties.connectionTimeZone"] = "UTC"
                defaults["spring.datasource.hikari.data-source-properties.forceConnectionTimeZoneToSession"] = "true"
            }
        }
        return defaults
    }

    private fun replace(environment: ConfigurableEnvironment, source: MapPropertySource, first: Boolean) {
        environment.propertySources.remove(source.name)
        if (first) environment.propertySources.addFirst(source) else environment.propertySources.addLast(source)
    }

    private companion object {
        const val CONNECTION_SOURCE = "databaseUrl"
        const val VENDOR_DEFAULTS_SOURCE = "databaseVendorDefaults"
    }
}
