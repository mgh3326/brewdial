package com.brewdial.api.agent

import com.brewdial.api.validation.BeanAttributesInput
import com.brewdial.api.validation.CreateRecipeInput
import com.brewdial.api.recipe.Recipe
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.context.annotation.Import
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.node.JsonNodeFactory
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc
@Import(AgentWriteIntegrationTest.AgentTestTokenConfiguration::class)
class AgentWriteIntegrationTest {
    @Autowired
    private lateinit var recipeWrites: AgentRecipeWriteRepository

    @Autowired
    private lateinit var writes: AgentWriteService

    @Autowired
    private lateinit var entityManager: EntityManager

    @Autowired
    private lateinit var transactionTemplate: TransactionTemplate

    @Autowired
    private lateinit var jdbcTemplate: JdbcTemplate

    @Autowired
    private lateinit var mockMvc: MockMvc

    private val recipeCodes = mutableListOf<String>()
    private val beanIds = mutableListOf<String>()

    @AfterEach
    fun cleanUp() {
        recipeCodes.forEach { code -> jdbcTemplate.update("delete from recipes where code = ?", code) }
        beanIds.forEach { id ->
            jdbcTemplate.update("delete from bean_purchase_links where bean_id = ?", id)
            jdbcTemplate.update("delete from beans where id = ?", id)
        }
    }

    @Test
    fun guardProofWithoutSetConfigForcesManualCreatedBy() {
        val code = transactionTemplate.execute {
            Recipe().apply {
                id = UUID.randomUUID()
                method = "v60"
                title = "Guard proof ${UUID.randomUUID()}"
                createdBy = "agent"
                ownerId = null
                isOfficial = false
                version = 1
                status = "active"
            }.also { recipe ->
                entityManager.persist(recipe)
                entityManager.flush()
                entityManager.refresh(recipe)
            }.code
        } ?: error("guard proof recipe did not receive a code")
        recipeCodes += code

        val row = jdbcTemplate.queryForMap("select created_by from recipes where code = ?", code)
        assertEquals("manual", row["created_by"])
    }

    @Test
    fun productionCreateRecipeWritesAgentOwnedGuardedFields() {
        val response = writes.createRecipe(CreateRecipeInput("v60", "Production path ${UUID.randomUUID()}"))
        val code = response["code"] as String
        recipeCodes += code

        val row = jdbcTemplate.queryForMap(
            "select created_by, owner_id, is_official, version, code from recipes where code = ?",
            code
        )
        assertEquals("agent", row["created_by"])
        assertEquals(null, row["owner_id"])
        assertEquals(false, row["is_official"])
        assertEquals(1, row["version"])
        assertEquals(true, (row["code"] as String).startsWith("COF-"))
    }

    @Test
    fun failedAgentInsertDoesNotLeaveOwnerWritesEnabled() {
        val title = "Leak proof ${UUID.randomUUID()}"
        val invalidGrind = JsonNodeFactory.instance.objectNode().put("grind", 3)

        // The CHECK on params.grind fails the flush inside the owner-write section.
        assertThrows(Exception::class.java) {
            recipeWrites.insertAgentRecipe(CreateRecipeInput("v60", title, params = invalidGrind))
        }

        // Same thread, so Hikari hands back the same connection. The guard must
        // still force created_by to 'manual' for a session without the flag.
        jdbcTemplate.update("insert into recipes (method, title, created_by) values ('v60', ?, 'agent')", title)
        val row = jdbcTemplate.queryForMap("select code, created_by from recipes where title = ?", title)
        recipeCodes += row["code"] as String
        assertEquals("manual", row["created_by"])
    }

    @Test
    fun supersedeMissingReplacementRollsBackOldRow() {
        val old = recipeWrites.insertAgentRecipe(CreateRecipeInput("v60", "Rollback ${UUID.randomUUID()}"))
        recipeCodes += old.code

        assertThrows(AgentRecipeMissingException::class.java) {
            writes.supersede(old.code, "DOES-NOT-EXIST-${UUID.randomUUID()}")
        }

        val row = transactionTemplate.execute {
            jdbcTemplate.queryForMap(
                "select status, superseded_by, supersedes from recipes where code = ?",
                old.code
            )
        } ?: error("rollback verification transaction did not return the old recipe")
        assertEquals("active", row["status"])
        assertEquals(null, row["superseded_by"])
        assertEquals(null, row["supersedes"])
    }

    @Test
    fun mergedAgtronRangeGuardReturns400() {
        val id = "kt-agent-guard-${UUID.randomUUID()}"
        beanIds += id
        jdbcTemplate.update("insert into beans (id, name) values (?, ?)", id, "Guard Bean $id")
        writes.patchBean(id, BeanAttributesInput(agtronMin = 57, agtronMax = 59))

        mockMvc.perform(
            patch("/api/agent/beans/$id")
                .header("Authorization", "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"agtronMax\":40}")
        ).andExpect(status().isBadRequest)
    }

    @Test
    fun aBodyIsNotInspectedBeforeAgentAuth() {
        val nul = """{"method":"v60","title":"a\u0000b"}"""
        val tooLarge = ByteArray(1024 * 1024 + 1) { 'x'.code.toByte() }

        mockMvc.perform(post("/api/agent/recipes").contentType(MediaType.APPLICATION_JSON).content(nul))
            .andExpect(status().isUnauthorized)
        mockMvc.perform(post("/api/agent/recipes").contentType(MediaType.APPLICATION_JSON).content(tooLarge))
            .andExpect(status().isUnauthorized)

        mockMvc.perform(
            post("/api/agent/recipes").header("Authorization", "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON).content(nul)
        ).andExpect(status().isBadRequest)
        mockMvc.perform(
            post("/api/agent/recipes").header("Authorization", "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON).content(tooLarge)
        ).andExpect(status().isPayloadTooLarge)
    }

    @TestConfiguration
    class AgentTestTokenConfiguration {
        @Bean
        @Primary
        fun testAgentTokenSupplier(): AgentTokenSupplier = AgentTokenSupplier { "test-token" }
    }
}
