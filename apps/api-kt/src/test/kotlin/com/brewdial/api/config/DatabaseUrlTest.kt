package com.brewdial.api.config

import com.brewdial.api.BrewdialApiKtApplication
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.SpringApplication
import org.springframework.mock.env.MockEnvironment

class DatabaseUrlTest {
    @Test
    fun parsesUriWithoutPassword() {
        val result = DatabaseUrlParser.parse("postgres://mgh3326@localhost:5432/brewdial_test")

        assertEquals("jdbc:postgresql://localhost:5432/brewdial_test", result.jdbcUrl)
        assertEquals("mgh3326", result.username)
        assertNull(result.password)
    }

    @Test
    fun parsesUriWithPassword() {
        val result = DatabaseUrlParser.parse("postgres://app-user:s3cret@db.example:5433/app")

        assertEquals("jdbc:postgresql://db.example:5433/app", result.jdbcUrl)
        assertEquals("app-user", result.username)
        assertEquals("s3cret", result.password)
    }

    @Test
    fun preservesQueryParameters() {
        val result = DatabaseUrlParser.parse(
            "postgres://app-user:s3cret@db.example:5432/app?sslmode=require"
        )

        assertEquals(
            "jdbc:postgresql://db.example:5432/app?sslmode=require",
            result.jdbcUrl
        )
    }

    @Test
    fun rejectsUnknownSchemeWithClearMessage() {
        val exception = assertThrows(IllegalArgumentException::class.java) {
            DatabaseUrlParser.parse("sqlserver://app-user:pw@localhost:1433/app")
        }

        assertTrue(exception.message.orEmpty().contains("postgres://"))
        assertTrue(exception.message.orEmpty().contains("mysql://"))
    }

    @Test
    fun parsesMySqlUriWithDefaultPortAndQuery() {
        val result = DatabaseUrlParser.parse("mysql://app-user:s3cret@db.example/app?sslMode=REQUIRED")

        assertEquals(DatabaseVendor.MYSQL, result.vendor)
        assertEquals("jdbc:mysql://db.example:3306/app?sslMode=REQUIRED", result.jdbcUrl)
        assertEquals("app-user", result.username)
        assertEquals("s3cret", result.password)
    }

    @Test
    fun postgresqlSchemeAliasSelectsPostgres() {
        val result = DatabaseUrlParser.parse("postgresql://app@db.example/app")

        assertEquals(DatabaseVendor.POSTGRESQL, result.vendor)
        assertEquals("jdbc:postgresql://db.example:5432/app", result.jdbcUrl)
    }

    @Test
    fun mySqlUrlSelectsMySqlDriverMigrationsAndTypes() {
        val environment = MockEnvironment().withProperty("DATABASE_URL", "mysql://app@db.example:3306/app")

        DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(
            environment,
            SpringApplication(BrewdialApiKtApplication::class.java)
        )

        assertEquals("MYSQL", environment.getProperty(DatabaseVendor.PROPERTY))
        assertEquals("com.mysql.cj.jdbc.Driver", environment.getProperty("spring.datasource.driver-class-name"))
        assertEquals("classpath:db/migration/mysql", environment.getProperty("spring.flyway.locations"))
        assertEquals("CHAR", environment.getProperty("spring.jpa.properties.hibernate.type.preferred_uuid_jdbc_type"))
        assertNull(environment.getProperty("spring.flyway.baseline-on-migrate"))
    }

    @Test
    fun explicitSpringPropertyOverridesVendorDefault() {
        val environment = MockEnvironment()
            .withProperty("DATABASE_URL", "postgres://app@db.example/app")
            .withProperty("spring.flyway.locations", "classpath:custom")

        DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(
            environment,
            SpringApplication(BrewdialApiKtApplication::class.java)
        )

        assertEquals("classpath:custom", environment.getProperty("spring.flyway.locations"))
        assertEquals("true", environment.getProperty("spring.flyway.baseline-on-migrate"))
    }

    @Test
    fun missingEnvironmentVariableFailsWithActionableMessage() {
        val exception = assertThrows(IllegalStateException::class.java) {
            DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(
                MockEnvironment(),
                SpringApplication(BrewdialApiKtApplication::class.java)
            )
        }

        assertTrue(exception.message.orEmpty().contains("DATABASE_URL"))
    }

    @Test
    fun postProcessorPublishesDatasourceProperties() {
        val environment = MockEnvironment().withProperty(
            "DATABASE_URL",
            "postgres://app-user:s3cret@db.example:5432/app?sslmode=require"
        )

        DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(
            environment,
            SpringApplication(BrewdialApiKtApplication::class.java)
        )

        assertEquals(
            "jdbc:postgresql://db.example:5432/app?sslmode=require",
            environment.getProperty("spring.datasource.url")
        )
        assertEquals("app-user", environment.getProperty("spring.datasource.username"))
        assertEquals("s3cret", environment.getProperty("spring.datasource.password"))
        assertEquals("org.postgresql.Driver", environment.getProperty("spring.datasource.driver-class-name"))
        assertEquals("classpath:db/migration/postgresql", environment.getProperty("spring.flyway.locations"))
        assertEquals("POSTGRESQL", environment.getProperty(DatabaseVendor.PROPERTY))
    }
}
