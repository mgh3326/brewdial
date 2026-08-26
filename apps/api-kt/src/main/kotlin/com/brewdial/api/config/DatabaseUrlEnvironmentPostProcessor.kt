package com.brewdial.api.config

import org.springframework.boot.EnvironmentPostProcessor
import org.springframework.boot.SpringApplication
import org.springframework.core.env.ConfigurableEnvironment
import org.springframework.core.env.MapPropertySource

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
        val properties = linkedMapOf<String, Any>(
            "spring.datasource.url" to database.jdbcUrl,
            "spring.datasource.username" to database.username
        )
        database.password?.let { properties["spring.datasource.password"] = it }

        val propertySource = MapPropertySource("databaseUrl", properties)
        environment.propertySources.remove(propertySource.name)
        environment.propertySources.addFirst(propertySource)
    }
}
