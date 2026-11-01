package com.brewdial.api.tools

import com.brewdial.api.config.DatabaseUrlParser
import com.brewdial.api.config.DatabaseVendor
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.ApplicationContext
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper
import java.sql.DriverManager
import java.util.Properties
import javax.sql.DataSource
import kotlin.system.exitProcess

/**
 * One-shot data copy with verification (runbook docs/runbooks/oci-heatwave-cutover.md).
 * It runs inside the normal api-kt image: DATABASE_URL is the target (Flyway
 * migrates it first), BREWDIAL_COPY_SOURCE_URL the source on the other database
 * vendor, BREWDIAL_COPY_MODE `copy`, `replace` or `verify` ([CopyMode]). It exits
 * when done: 0 when every table and sequence matches, non-zero otherwise.
 */
@Component
@ConditionalOnProperty("brewdial.copy.source-url")
class DatabaseCopyRunner(
    private val target: DataSource,
    private val vendor: DatabaseVendor,
    private val objectMapper: ObjectMapper,
    private val environment: Environment,
    private val context: ApplicationContext
) : ApplicationRunner {
    private val log = LoggerFactory.getLogger(javaClass)

    override fun run(args: ApplicationArguments) {
        val ok = try {
            execute()
        } catch (exception: IllegalStateException) {
            // Our own checks: the message names tables and columns, never a URL.
            println("COPY_CHECK_FAILED ${exception.message}")
            log.error("database copy check failed", exception)
            false
        } catch (exception: Exception) {
            println("COPY_FAILED ${exception.javaClass.simpleName}")
            log.error("database copy failed", exception)
            false
        }
        exitProcess(SpringApplication.exit(context, { if (ok) 0 else 1 }))
    }

    private fun execute(): Boolean {
        val source = DatabaseUrlParser.parse(environment.getRequiredProperty("brewdial.copy.source-url"))
        check(source.vendor != vendor) { "DATABASE_URL and BREWDIAL_COPY_SOURCE_URL must use different database vendors" }
        val mode = CopyMode.parse(environment.getProperty("brewdial.copy.mode", "copy"))
        val properties = Properties()
        properties["user"] = source.username
        source.password?.let { properties["password"] = it }
        // The same session settings the application uses for MySQL DATETIME(6) in UTC.
        if (source.vendor == DatabaseVendor.MYSQL) {
            properties["connectionTimeZone"] = "UTC"
            properties["forceConnectionTimeZoneToSession"] = "true"
        }
        DriverManager.getConnection(source.jdbcUrl, properties).use { sourceConnection ->
            target.connection.use { targetConnection ->
                return DatabaseCopy(
                    CopyEndpoint(sourceConnection, source.vendor),
                    CopyEndpoint(targetConnection, vendor),
                    objectMapper
                ).run(mode)
            }
        }
    }
}
