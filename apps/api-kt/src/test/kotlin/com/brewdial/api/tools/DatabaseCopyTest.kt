package com.brewdial.api.tools

import com.brewdial.api.config.DatabaseUrlConfig
import com.brewdial.api.config.DatabaseUrlParser
import com.brewdial.api.config.DatabaseVendor
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import java.sql.Connection
import java.sql.DriverManager
import java.time.Duration
import java.util.Properties
import java.util.UUID

/**
 * Runs the copy against both real databases, through Flyway-migrated schemas, as
 * the production shape: the PostgreSQL side connects as a non-superuser table
 * owner. ci-kt.yml runs it in the job that has both database services.
 */
@EnabledIfEnvironmentVariable(named = "BREWDIAL_COPY_TEST_POSTGRES_URL", matches = ".+")
@EnabledIfEnvironmentVariable(named = "BREWDIAL_COPY_TEST_MYSQL_URL", matches = ".+")
class DatabaseCopyTest {
    private val id = UUID.randomUUID().toString().replace("-", "").take(12)
    private val database = "copy_$id"
    private val pgOwner = "copy_owner_$id"
    private val pgOwnerPassword = "owner-$id"
    private val mysqlCopyUser = "copy_src_$id"
    private val pgAdminConfig = DatabaseUrlParser.parse(System.getenv("BREWDIAL_COPY_TEST_POSTGRES_URL"))
    private val mysqlAdminConfig = DatabaseUrlParser.parse(System.getenv("BREWDIAL_COPY_TEST_MYSQL_URL"))
    private val output = mutableListOf<String>()

    /** Superuser on the test database: fixtures and assertions. */
    private lateinit var pgAdmin: Connection

    /** Non-superuser owner: what the copy connects as, like brewdial_app. */
    private lateinit var pg: Connection
    private lateinit var mysql: Connection

    @BeforeEach
    fun createDatabases() {
        connect(pgAdminConfig).use { admin ->
            admin.update("create role $pgOwner login nosuperuser password '$pgOwnerPassword'")
            admin.update("create database $database owner $pgOwner")
        }
        connect(mysqlAdminConfig).use { admin ->
            admin.update("create database $database")
            // Like production: the rollback source connects as a user only the API shares.
            admin.update("create user '$mysqlCopyUser'@'%' identified by '$pgOwnerPassword'")
            admin.update("grant all on $database.* to '$mysqlCopyUser'@'%'")
            admin.update("grant process on *.* to '$mysqlCopyUser'@'%'")
        }
        val pgUrl = databaseUrl(pgAdminConfig)
        Flyway.configure().dataSource(pgUrl, pgOwner, pgOwnerPassword)
            .locations("classpath:db/migration/postgresql").placeholderReplacement(false).load().migrate()
        Flyway.configure().dataSource(databaseUrl(mysqlAdminConfig), mysqlAdminConfig.username, mysqlAdminConfig.password)
            .locations("classpath:db/migration/mysql").placeholderReplacement(false).load().migrate()
        pgAdmin = connect(pgAdminConfig, database)
        pg = DriverManager.getConnection(pgUrl, pgOwner, pgOwnerPassword)
        mysql = connect(mysqlAdminConfig, database)
        insertFixture()
    }

    @AfterEach
    fun dropDatabases() {
        listOf(pgAdmin, pg, mysql).forEach { it.close() }
        connect(pgAdminConfig).use { admin ->
            admin.update("drop database $database with (force)")
            admin.update("drop role $pgOwner")
        }
        connect(mysqlAdminConfig).use { admin ->
            admin.update("drop database $database")
            admin.update("drop user '$mysqlCopyUser'@'%'")
        }
    }

    @Test
    fun theFixtureCoversEveryCopiedTable() {
        DatabaseCopy.TABLES.forEach { table ->
            assertTrue(pgAdmin.long("select count(*) from \"$table\"") > 0, "$table has no fixture row")
        }
    }

    @Test
    fun forwardThenReverseCopyRoundTripsByteIdentically() {
        val before = pgFingerprints()

        assertTrue(forward(CopyMode.COPY), output.joinToString("\n"))
        assertTrue(reverse(CopyMode.REPLACE), output.joinToString("\n"))

        assertEquals(before, pgFingerprints())
        assertEquals(42L, pgAdmin.long("select last_value from recipe_code_seq"))
    }

    @Test
    fun reverseCopyCarriesDeletesUpdatesInsertsAndTheSequence() {
        assertTrue(forward(CopyMode.COPY))
        val deletedAfterTheFirstCopy = mysql.string("select id from saved_beans limit 1")

        mysql.update("delete from saved_beans where id = '$deletedAfterTheFirstCopy'")
        mysql.update("update beans set origin = '변경됨' where id = 'bean-1'")
        mysql.update("insert into beans (id, name) values ('bean-new', '새 원두')")
        mysql.update("insert into recipes (method, title) values ('v60', 'after the cutover')")
        assertEquals("COF-0043", mysql.string("select code from recipes where title = 'after the cutover'"))

        assertFalse(forward(CopyMode.VERIFY), "the writes on MySQL must show up as a mismatch")
        assertTrue(reverse(CopyMode.REPLACE), output.joinToString("\n"))
        assertTrue(reverse(CopyMode.VERIFY), "a fresh verify repeats the result")

        assertEquals(0L, pgAdmin.long("select count(*) from saved_beans where id = '$deletedAfterTheFirstCopy'"))
        assertEquals("변경됨", pgAdmin.string("select origin from beans where id = 'bean-1'"))
        assertEquals(1L, pgAdmin.long("select count(*) from beans where id = 'bean-new'"))
        assertEquals(mysql.tableDigest(), pgAdminTableCounts())
        // The next PostgreSQL code continues after the last one MySQL handed out.
        pgAdmin.update("insert into recipes (method, title) values ('v60', 'after the rollback')")
        assertEquals("COF-0044", pgAdmin.string("select code from recipes where title = 'after the rollback'"))
    }

    @Test
    fun reverseCopyLeavesThePostgresTriggersEnabled() {
        assertTrue(forward(CopyMode.COPY))
        assertTrue(reverse(CopyMode.REPLACE))

        assertEquals(0L, pgAdmin.long("select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O'"))
        assertTrue(pgAdmin.long("select count(*) from pg_trigger where not tgisinternal") > 0)
    }

    @Test
    fun aFailedReplaceLeavesTheTargetUntouched() {
        assertTrue(forward(CopyMode.COPY))
        val before = pgFingerprints()
        mysql.update("insert into beans (id, name) values ('bean-boom', 'BOOM')")
        pgAdmin.update("alter table beans add constraint beans_no_boom check (name <> 'BOOM')")

        assertThrows(Exception::class.java) { reverse(CopyMode.REPLACE) }

        assertEquals(before, pgFingerprints())
        assertEquals(0L, pgAdmin.long("select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O'"))
    }

    @Test
    fun aReplaceThatDoesNotVerifyRollsBackBeforeItCommits() {
        assertTrue(forward(CopyMode.COPY))
        val before = pgFingerprints()
        mysql.update("update recipe_code_seq set value = 99 where id = 1")
        // Numbers in a JSON array become text in text[], so the checksums differ.
        mysql.update("update recipes set intent = '[1,2]' where code = 'COF-0041'")

        assertFalse(reverse(CopyMode.REPLACE))

        assertEquals(before, pgFingerprints())
        assertEquals(42L, pgAdmin.long("select last_value from recipe_code_seq"), "setval must be undone")
        assertEquals(0L, pgAdmin.long("select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O'"))
        assertTrue(outputLines().any { it.startsWith("COPY_ROLLED_BACK") })
    }

    @Test
    fun aFirstCopyThatDoesNotVerifyLeavesTheTargetEmpty() {
        pgAdmin.update("update recipes set params = '{\"precise\":1.00000000000000000001}' where code = 'COF-0041'")

        assertFalse(forward(CopyMode.COPY), "MySQL JSON keeps a double, so the value must not verify")

        assertEquals(0L, mysql.long("select count(*) from recipes"))
        assertEquals(0L, mysql.long("select value from recipe_code_seq"))
    }

    @Test
    fun replaceRefusesAnEmptySource() {
        val before = pgFingerprints()

        val failure = assertThrows(IllegalStateException::class.java) { reverse(CopyMode.REPLACE) }

        assertTrue(failure.message!!.contains("holds no data"), failure.message)
        assertEquals(before, pgFingerprints())
        assertEquals(42L, pgAdmin.long("select last_value from recipe_code_seq"))
    }

    @Test
    fun anOpenWriteOnThePostgresSourceStopsTheCopyBeforeItWrites() {
        DriverManager.getConnection(databaseUrl(pgAdminConfig), pgOwner, pgOwnerPassword).use { writer ->
            writer.autoCommit = false
            writer.update("update beans set origin = 'in flight' where id = 'bean-1'")

            val failure = assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }

            assertTrue(failure.message!!.contains("could write"), failure.message)
            assertEquals(0L, mysql.long("select count(*) from beans"), "nothing may be written")
            writer.rollback()
        }

        assertTrue(forward(CopyMode.COPY), output.joinToString("\n"))
    }

    @Test
    fun theCopyWaitsForAWriteThatFinishesAndThenSeesIt() {
        val writer = DriverManager.getConnection(databaseUrl(pgAdminConfig), pgOwner, pgOwnerPassword)
        writer.autoCommit = false
        writer.update("update beans set origin = 'committed while waiting' where id = 'bean-1'")
        val committer = Thread {
            Thread.sleep(700)
            writer.commit()
            writer.close()
        }
        committer.start()

        assertTrue(forward(CopyMode.COPY, Duration.ofSeconds(30)), output.joinToString("\n"))

        committer.join()
        assertEquals("committed while waiting", mysql.string("select origin from beans where id = 'bean-1'"))
    }

    @Test
    fun anIdlePostgresSessionDoesNotStopTheCopy() {
        DriverManager.getConnection(databaseUrl(pgAdminConfig), pgOwner, pgOwnerPassword).use { reader ->
            reader.autoCommit = false
            reader.string("select origin from beans where id = 'bean-1'")

            assertTrue(forward(CopyMode.COPY), output.joinToString("\n"))
        }
    }

    @Test
    fun anotherSessionOfTheApiUserStopsTheRollback() {
        assertTrue(forward(CopyMode.COPY))
        val before = pgFingerprints()

        mysqlAsCopyUser().use { stillConnected ->
            stillConnected.string("select 1")

            val failure = assertThrows(IllegalStateException::class.java) { reverse(CopyMode.REPLACE) }

            assertTrue(failure.message!!.contains("could write"), failure.message)
            assertEquals(before, pgFingerprints())
        }

        assertTrue(reverse(CopyMode.REPLACE), output.joinToString("\n"))
    }

    @Test
    fun aWriterOnAnotherMysqlAccountStopsTheRollback() {
        assertTrue(forward(CopyMode.COPY))
        val before = pgFingerprints()

        connect(mysqlAdminConfig, database).use { otherAccount ->
            otherAccount.autoCommit = false
            otherAccount.update("update beans set origin = 'in flight' where id = 'bean-1'")

            val failure = assertThrows(IllegalStateException::class.java) { reverse(CopyMode.REPLACE) }

            assertTrue(failure.message!!.contains("could write"), failure.message)
            assertEquals(before, pgFingerprints())
            otherAccount.rollback()
        }

        assertTrue(reverse(CopyMode.REPLACE), output.joinToString("\n"))
        assertEquals("Panama", pgAdmin.string("select origin from beans where id = 'bean-1'"))
    }

    @Test
    fun aReadOnlySnapshotOnAnotherMysqlAccountDoesNotStopTheRollback() {
        assertTrue(forward(CopyMode.COPY))

        connect(mysqlAdminConfig, database).use { backup ->
            backup.autoCommit = false
            backup.string("select origin from beans where id = 'bean-1'")

            assertTrue(reverse(CopyMode.REPLACE), output.joinToString("\n"))
        }
    }

    @Test
    fun aMysqlUserThatCannotSeeOtherAccountsStopsTheCutover() {
        connect(mysqlAdminConfig).use { admin -> admin.update("revoke process on *.* from '$mysqlCopyUser'@'%'") }

        val failure = mysqlAsCopyUser().use { target ->
            assertThrows(IllegalStateException::class.java) {
                DatabaseCopy(CopyEndpoint(freshPg(), DatabaseVendor.POSTGRESQL), CopyEndpoint(target, DatabaseVendor.MYSQL), output::add).run(CopyMode.COPY)
            }
        }

        assertTrue(failure.message!!.contains("grant it PROCESS"), failure.message)
        assertEquals(0L, mysql.long("select count(*) from beans"), "nothing may be written")
    }

    @Test
    fun aTableThePostgresRoleDoesNotOwnStopsTheCutover() {
        pgAdmin.update("alter table bean_photos owner to postgres")

        val failure = assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }

        assertTrue(failure.message!!.contains("bean_photos"), failure.message)
        assertEquals(0L, mysql.long("select count(*) from beans"), "nothing may be written")
    }

    @Test
    fun copyFailsOnAColumnOnlyPostgresHas() {
        pgAdmin.update("alter table beans add column drift_note text")

        val failure = assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }

        assertTrue(failure.message!!.contains("beans.drift_note exists only in POSTGRESQL"), failure.message)
        assertEquals(0L, mysql.long("select count(*) from beans"), "nothing may be written")
        assertThrows(IllegalStateException::class.java) { forward(CopyMode.VERIFY) }
    }

    @Test
    fun copyFailsOnAColumnOnlyMysqlHas() {
        mysql.update("alter table beans add column drift_note text")

        val failure = assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }

        assertTrue(failure.message!!.contains("beans.drift_note exists only in MYSQL"), failure.message)
    }

    @Test
    fun copyFailsOnATableOrSequenceItDoesNotCover() {
        pgAdmin.update("create table drift_table (id int)")
        assertTrue(assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }.message!!.contains("drift_table"))
        pgAdmin.update("drop table drift_table")

        pgAdmin.update("create sequence drift_seq")
        assertTrue(assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }.message!!.contains("drift_seq"))
        pgAdmin.update("drop sequence drift_seq")

        mysql.update("create table drift_counter (id int auto_increment primary key)")
        assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }
    }

    @Test
    fun verifyComparesTheSequenceValue() {
        assertTrue(forward(CopyMode.COPY))
        assertTrue(outputLines().contains("recipe_code_seq\t42\t42\tOK"), outputLines().joinToString("\n"))

        mysql.update("update recipe_code_seq set value = 99 where id = 1")
        output.clear()

        assertFalse(forward(CopyMode.VERIFY))
        assertTrue(outputLines().contains("recipe_code_seq\t42\t99\tMISMATCH"), outputLines().joinToString("\n"))
        assertEquals(1, outputLines().count { it.endsWith("\tMISMATCH") }, "every table still matches")
    }

    @Test
    fun aSequenceThatNeverHandedOutANumberCopiesAsZero() {
        pgAdmin.update("select setval('recipe_code_seq', 1, false)")

        assertTrue(forward(CopyMode.COPY))

        assertEquals(0L, mysql.long("select value from recipe_code_seq"))
        assertTrue(reverse(CopyMode.REPLACE))
        assertEquals(false, pgAdmin.prepareStatement("select is_called from recipe_code_seq").use { statement ->
            statement.executeQuery().use { rows ->
                rows.next()
                rows.getBoolean(1)
            }
        })
    }

    @Test
    fun copyRefusesATargetWithRowsAndReplaceAccepts() {
        assertTrue(forward(CopyMode.COPY))

        val failure = assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }

        assertTrue(failure.message!!.contains("is not empty"), failure.message)
        assertTrue(forward(CopyMode.REPLACE), output.joinToString("\n"))
    }

    @Test
    fun copyRefusesValuesLongerThanTheMysqlColumn() {
        pgAdmin.update("insert into beans (id, name) values ('bean-long', repeat('x', 256))")

        val failure = assertThrows(IllegalStateException::class.java) { forward(CopyMode.COPY) }

        assertTrue(failure.message!!.contains("beans.name: 1 rows longer than 255"), failure.message)
    }

    @Test
    fun verifyDetectsAChangedValueInEveryDirection() {
        assertTrue(forward(CopyMode.COPY))
        mysql.update("update bd_migration_meta set value = 'changed' where `key` = 'fixture'")

        assertFalse(forward(CopyMode.VERIFY))
        assertFalse(reverse(CopyMode.VERIFY))
    }

    private fun outputLines() = output.flatMap { it.lines() }

    private fun forward(mode: CopyMode, quietTimeout: Duration = Duration.ofSeconds(1)): Boolean = DatabaseCopy(
        CopyEndpoint(freshPg(), DatabaseVendor.POSTGRESQL),
        CopyEndpoint(mysql, DatabaseVendor.MYSQL),
        output::add,
        quietTimeout
    ).run(mode)

    private fun reverse(mode: CopyMode, quietTimeout: Duration = Duration.ofSeconds(1)): Boolean = mysqlAsCopyUser().use { source ->
        DatabaseCopy(
            CopyEndpoint(source, DatabaseVendor.MYSQL),
            CopyEndpoint(pg, DatabaseVendor.POSTGRESQL),
            output::add,
            quietTimeout
        ).run(mode)
    }

    private fun mysqlAsCopyUser(): Connection {
        val properties = Properties()
        properties["user"] = mysqlCopyUser
        properties["password"] = pgOwnerPassword
        properties["connectionTimeZone"] = "UTC"
        properties["forceConnectionTimeZoneToSession"] = "true"
        return DriverManager.getConnection(databaseUrl(mysqlAdminConfig), properties)
    }

    /** The runner gives every run its own source connection and snapshot. */
    private fun freshPg(): Connection {
        val connection = DriverManager.getConnection(databaseUrl(pgAdminConfig), pgOwner, pgOwnerPassword)
        openedSources += connection
        return connection
    }

    private val openedSources = mutableListOf<Connection>()

    @AfterEach
    fun closeSources() = openedSources.forEach { it.close() }

    /** PostgreSQL's own text form of every row: changes when any byte of it changes. */
    private fun pgFingerprints(): Map<String, String> = DatabaseCopy.TABLES.associateWith { table ->
        pgAdmin.string(
            "select count(*) || '|' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), 'empty') from \"$table\" t"
        )
    }

    private fun pgAdminTableCounts(): Map<String, Long> =
        DatabaseCopy.TABLES.associateWith { table -> pgAdmin.long("select count(*) from \"$table\"") }

    private fun Connection.tableDigest(): Map<String, Long> =
        DatabaseCopy.TABLES.associateWith { table -> long("select count(*) from `$table`") }

    private fun insertFixture() {
        val alice = "11111111-1111-4111-8111-111111111111"
        val bob = "22222222-2222-4222-8222-222222222222"
        val grinder = "33333333-3333-4333-8333-333333333333"
        val dripper = "44444444-4444-4444-8444-444444444444"
        val statements = listOf(
            """insert into app_users (id, auth_user_id, display_name, created_at, updated_at) values
               ('$alice', null, E'로빈 "quoted" \\ back\nslash', '2026-03-01 12:34:56.123456+09', '2026-03-01 03:34:56.123456+00'),
               ('$bob', '$grinder', null, '2026-03-02 00:00:00+00', '2026-03-02 00:00:00.000001+00')""",
            """insert into beans (id, name, roaster, origin, roast_level_ord, agtron_min, agtron_max, acidity, body, decaf, flavor_categories, attrs_source, notes) values
               ('bean-1', 'Gesha 게이샤', 'Roaster', 'Panama', 2, 55, 65, 3, 4, false, array['fruity','floral'], 'manual', ''),
               ('bean-2', 'Plain', null, null, null, null, null, null, null, null, null, null, null),
               ('bean-3', 'Decaf', 'Roaster', null, null, null, null, null, null, true, '{}', null, null)""",
            """insert into recipes (id, code, method, title, version, params, steps, bean_id, bean_snapshot, intent, created_by, status, owner_id, is_official, dripper_portability, created_at) values
               ('55555555-5555-4555-8555-555555555555', 'COF-0041', 'v60', '레시피 "A"', 2,
                '{"dose_g":18,"ratio":15.5,"grind":{"clicks":24},"nested":{"b":[1,2,{"a":null}],"a":"값"}}',
                '[{"t":0,"pour":40.25},{"t":45,"pour":120}]', 'bean-1', '{"name":"Gesha 게이샤"}', array['clarity','단맛'], 'agent', 'active', null, true, '{"cone":true}', '2026-03-01 01:02:03.654321+00'),
               ('66666666-6666-4666-8666-666666666666', 'COF-0042', 'espresso', 'private', 1,
                '{}', '[]', null, null, '{}', 'manual', 'reference', '$alice', false, null, '2026-03-01 01:02:03+00')""",
            """insert into feedback (id, recipe_code, bean_id, ratings, actual, comment, quick_tags, desired_direction, next_hint, source, owner_id) values
               ('77777777-7777-4777-8777-777777777777', 'COF-0041', 'bean-1', '{"overall":4.5}', '{"dose":18}', 'good', array['tag, "comma"','태그'], '{}', null, 'web', '$alice'),
               ('88888888-8888-4888-8888-888888888888', 'COF-0042', null, null, null, null, null, null, array['next'], 'mcp', null)""",
            """insert into preferences (id, likes, dislikes, default_params) values ('global', array['bright'], '{}', '{"dose":18}')""",
            """insert into bd_migration_meta (key, value) values ('fixture', 'value')""",
            """insert into user_identities (app_user_id, provider, external_key, verified) values ('$alice', 'toss_anon', 'external-key-0001', false)""",
            """insert into grinders (id, name, um_per_click_est, um_per_click_source, stepless, brew_method_ranges, anchor_point) values
               ('$grinder', 'Comandante', 12.5, 'measured', false, '{"v60":[20,30]}', '{"clicks":24}')""",
            """insert into drippers (id, name, class, geometry, continuum_position, hole_spec, recommended_dose_range, size_models) values
               ('$dripper', 'V60', 'bed_restricted', 'cone', 0.25, '{"holes":1}', '{"min":12}', '["01","02"]')""",
            """insert into user_gear (app_user_id, kind, grinder_id, label, details, is_default) values ('$alice', 'grinder', '$grinder', 'mine', '{"note":"x"}', true),
               ('$alice', 'dripper', null, 'other', '{}', false)""",
            """insert into grinder_calibration (app_user_id, from_grinder_id, from_label, to_label, anchor_method, samples, source, notes) values
               ('$alice', '$grinder', 'Comandante', 'Other', 'taste', '[{"from":24,"to":30}]', 'measured', 'note')""",
            """insert into saved_recipes (app_user_id, recipe_code, snapshot, note) values ('$alice', 'COF-0041', '{"title":"레시피"}', 'n')""",
            """insert into saved_beans (app_user_id, bean_id, note) values ('$alice', 'bean-1', null), ('$bob', 'bean-2', 'keep')""",
            """insert into bean_photos (bean_id, app_user_id, url, source, sort_order) values ('bean-1', '$alice', 'https://example.test/a.jpg', 'manual', 1)""",
            """insert into bean_purchase_links (bean_id, vendor, url, price_krw, is_affiliate, active, sort_order) values ('bean-1', 'Kurly', 'https://example.test/buy', 18000, true, false, 2)"""
        )
        pgAdmin.update("set session_replication_role = replica")
        statements.forEach { pgAdmin.update(it) }
        pgAdmin.update("set session_replication_role = default")
        pgAdmin.update("select setval('recipe_code_seq', 42, true)")
    }

    private fun databaseUrl(config: DatabaseUrlConfig): String {
        val query = config.jdbcUrl.substringAfter('?', "")
        val base = config.jdbcUrl.substringBefore('?').substringBeforeLast('/') + "/$database"
        return if (query.isEmpty()) base else "$base?$query"
    }

    private fun connect(config: DatabaseUrlConfig, databaseName: String? = null): Connection {
        val properties = Properties()
        properties["user"] = config.username
        config.password?.let { properties["password"] = it }
        if (config.vendor == DatabaseVendor.MYSQL) {
            properties["connectionTimeZone"] = "UTC"
            properties["forceConnectionTimeZoneToSession"] = "true"
        }
        return DriverManager.getConnection(if (databaseName == null) config.jdbcUrl else databaseUrl(config), properties)
    }

    private fun Connection.update(sql: String) {
        createStatement().use { it.execute(sql) }
    }

    private fun Connection.long(sql: String): Long = createStatement().use { statement ->
        statement.executeQuery(sql).use { rows ->
            rows.next()
            rows.getLong(1)
        }
    }

    private fun Connection.string(sql: String): String = createStatement().use { statement ->
        statement.executeQuery(sql).use { rows ->
            rows.next()
            rows.getString(1)
        }
    }
}
