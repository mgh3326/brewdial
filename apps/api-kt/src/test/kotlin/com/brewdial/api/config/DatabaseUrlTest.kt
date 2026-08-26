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
    fun rejectsWrongSchemeWithClearMessage() {
        val exception = assertThrows(IllegalArgumentException::class.java) {
            DatabaseUrlParser.parse("mysql://app-user:pw@localhost:3306/app")
        }

        assertTrue(exception.message.orEmpty().contains("postgres://"))
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
    }
}
