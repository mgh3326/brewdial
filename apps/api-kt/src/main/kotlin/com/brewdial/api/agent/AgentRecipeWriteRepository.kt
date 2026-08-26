package com.brewdial.api.agent

import com.brewdial.api.recipe.Recipe
import com.brewdial.api.validation.CreateRecipeInput
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * The only production recipe INSERT path. Under JpaTransactionManager,
 * JdbcTemplate also receives the transaction-bound connection via DataSourceUtils.
 * The EntityManager native query is used here because sharing the JPA write session
 * is explicit in this code.
 */
@Repository
class AgentRecipeWriteRepository(
    private val entityManager: EntityManager
) {
    @Transactional
    fun insertAgentRecipe(input: CreateRecipeInput): Recipe {
        val recipe = Recipe().apply {
            id = UUID.randomUUID()
            method = input.method
            title = input.title
            params = input.params?.toString() ?: "{}"
            steps = input.steps?.toString() ?: "[]"
            beanId = input.beanId
            beanSnapshot = input.beanSnapshot?.toString()
            intent = input.intent
            notes = input.notes
            adjustmentFromPrevious = input.adjustmentFromPrevious
            dripperPortability = input.dripperPortability?.toString()
            createdBy = "agent"
            ownerId = null
            isOfficial = false
            version = 1
            status = "active"
        }
        entityManager.createNativeQuery("select set_config('bd.owner_write_ok','on',true)").singleResult
        entityManager.persist(recipe)
        entityManager.flush()
        entityManager.refresh(recipe)
        return recipe
    }
}
