package com.brewdial.api.db

import com.brewdial.api.config.DatabaseVendor
import com.brewdial.api.identity.IdentityResolver
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataAccessException
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

/**
 * Trigger and constraint behaviour that both vendors must share. Each test
 * writes plain SQL, so it checks the database, not the application.
 */
@SpringBootTest
class SchemaBehaviourTest {
    @Autowired
    private lateinit var jdbc: JdbcTemplate

    @Autowired
    private lateinit var vendor: DatabaseVendor

    @Autowired
    private lateinit var identities: IdentityResolver

    private val tag = UUID.randomUUID().toString().take(8)
    private val appUsers = mutableListOf<String>()

    @AfterEach
    fun cleanUp() {
        jdbc.update("delete from feedback where recipe_code in (select code from recipes where title like ?)", "sb-$tag%")
        jdbc.update("delete from recipes where title like ?", "sb-$tag%")
        jdbc.update("delete from beans where name like ?", "sb-$tag%")
        appUsers.forEach { jdbc.update("delete from app_users where id = $uuid", it) }
    }

    private val uuid get() = if (vendor == DatabaseVendor.POSTGRESQL) "cast(? as uuid)" else "?"
    private val json get() = if (vendor == DatabaseVendor.POSTGRESQL) "cast(? as jsonb)" else "cast(? as json)"

    private fun insertRecipe(title: String, snapshot: String? = null, createdBy: String = "agent"): String {
        jdbc.update(
            "insert into recipes (method, title, created_by, is_official, bean_snapshot) values ('v60', ?, ?, true, $json)",
            title,
            createdBy,
            snapshot
        )
        return jdbc.queryForObject("select code from recipes where title = ?", String::class.java, title)!!
    }

    @Test
    fun recipeCodeIsAssignedFromTheSequence() {
        val first = insertRecipe("sb-$tag-a")
        val second = insertRecipe("sb-$tag-b")
        assertTrue(Regex("COF-\\d{4}").matches(first), first)
        assertTrue(second > first, "$second should follow $first")
    }

    @Test
    fun guardForcesManualPublicRowsWithoutOwnerWriteFlag() {
        val code = insertRecipe("sb-$tag-guard")
        val row = jdbc.queryForMap("select created_by, is_official, owner_id from recipes where code = ?", code)
        assertEquals("manual", row["created_by"])
        assertEquals(false, truthy(row["is_official"]))
        assertNull(row["owner_id"])
        assertThrows(DataAccessException::class.java) {
            jdbc.update("update recipes set created_by = 'agent' where code = ?", code)
        }
    }

    @Test
    fun publicRecipeCreatesAndEnrichesItsBeanCaseInsensitively() {
        val first = insertRecipe("sb-$tag-bean1", """{"name":" sb-$tag Gesha ","roaster":"R","origin":"Panama"}""")
        val second = insertRecipe("sb-$tag-bean2", """{"name":"SB-$tag gesha","roaster":"r","process":"washed","notes":null}""")
        val beans = jdbc.queryForList(
            "select r.bean_id, b.name, b.origin, b.process, b.notes from recipes r join beans b on b.id = r.bean_id where r.code in (?, ?)",
            first,
            second
        )
        assertEquals(2, beans.size)
        assertEquals(beans[0]["bean_id"], beans[1]["bean_id"])
        assertEquals("sb-$tag Gesha", beans[0]["name"])
        assertEquals("Panama", beans[0]["origin"])
        assertEquals("washed", beans[0]["process"])
        assertNull(beans[0]["notes"])
    }

    @Test
    fun feedbackInheritsTheRecipeBean() {
        val code = insertRecipe("sb-$tag-fb", """{"name":"sb-$tag Feedback bean"}""")
        jdbc.update("insert into feedback (recipe_code, source) values (?, 'api')", code)
        val beanId = jdbc.queryForObject("select bean_id from feedback where recipe_code = ?", String::class.java, code)
        assertEquals(jdbc.queryForObject("select bean_id from recipes where code = ?", String::class.java, code), beanId)
    }

    @Test
    fun updateStampsUpdatedAt() {
        val code = insertRecipe("sb-$tag-upd")
        val before = jdbc.queryForObject("select updated_at from recipes where code = ?", Any::class.java, code)
        Thread.sleep(20)
        jdbc.update("update recipes set notes = 'changed' where code = ?", code)
        val after = jdbc.queryForObject("select updated_at from recipes where code = ?", Any::class.java, code)
        assertNotEquals(before.toString(), after.toString())
    }

    @Test
    fun checkConstraintsRejectInvalidRows() {
        assertThrows(DataAccessException::class.java) {
            jdbc.update("insert into recipes (method, title) values ('pourover', ?)", "sb-$tag-bad-method")
        }
        assertThrows(DataAccessException::class.java) {
            jdbc.update(
                "insert into recipes (method, title, params) values ('v60', ?, $json)",
                "sb-$tag-bad-grind",
                """{"grind":3}"""
            )
        }
        assertThrows(DataAccessException::class.java) {
            jdbc.update("insert into recipes (method, title, status) values ('v60', ?, 'deleted')", "sb-$tag-bad-status")
        }
    }

    @Test
    fun oneDefaultGearPerKindAndKindReferenceRule() {
        val user = identities.resolve("web_local", "sb-$tag-gear-user-key")
        appUsers += user
        val insertGear = "insert into user_gear (app_user_id, kind, label, is_default, dripper_id) values ($uuid, 'grinder', ?, ?, null)"
        jdbc.update(insertGear, user, "a", true)
        jdbc.update(insertGear, user, "b", false)
        jdbc.update(insertGear, user, "c", false)
        assertThrows(DataAccessException::class.java) { jdbc.update(insertGear, user, "d", true) }

        val dripperId = UUID.randomUUID().toString()
        jdbc.update("insert into drippers (id, name, class) values ($uuid, ?, 'hybrid')", dripperId, "sb-$tag dripper")
        try {
            assertThrows(DataAccessException::class.java) {
                jdbc.update(
                    "insert into user_gear (app_user_id, kind, label, dripper_id) values ($uuid, 'grinder', 'e', $uuid)",
                    user,
                    dripperId
                )
            }
        } finally {
            jdbc.update("delete from drippers where id = $uuid", dripperId)
        }
    }

    @Test
    fun identityResolutionIsIdempotent() {
        val first = identities.resolve("toss_anon", "sb-$tag-identity-key")
        appUsers += first
        val second = identities.resolve("toss_anon", "sb-$tag-identity-key")
        assertEquals(first, second)
        assertNotNull(jdbc.queryForObject("select count(*) from app_users where id = $uuid", Long::class.java, first))
        assertThrows(Exception::class.java) { identities.resolve("toss_login", "sb-$tag-identity-key") }
    }

    private fun truthy(value: Any?): Boolean? = when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        else -> null
    }
}
