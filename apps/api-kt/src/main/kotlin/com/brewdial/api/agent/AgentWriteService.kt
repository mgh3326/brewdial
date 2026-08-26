package com.brewdial.api.agent

import com.brewdial.api.bean.Bean
import com.brewdial.api.feedback.Feedback
import com.brewdial.api.purchase.BeanPurchaseLink
import com.brewdial.api.read.ReadRepository
import com.brewdial.api.recipe.Recipe
import com.brewdial.api.validation.BeanAttributesInput
import com.brewdial.api.validation.CreateBeanPurchaseLinkInput
import com.brewdial.api.validation.CreateRecipeInput
import com.brewdial.api.validation.UpdatePreferencesInput
import jakarta.persistence.EntityManager
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.node.ObjectNode
import java.util.UUID

class AgentRecipeMissingException(code: String) : RuntimeException("recipe not found: $code")
class AgentBeanMissingException : RuntimeException()
class AgentInvalidRangeException(message: String) : RuntimeException(message)

@Service
class AgentWriteService(
    private val entityManager: EntityManager,
    private val recipeWrites: AgentRecipeWriteRepository,
    private val readRepository: ReadRepository,
    private val jdbcTemplate: JdbcTemplate,
    private val objectMapper: ObjectMapper
) {
    fun findRecipeAnyStatus(code: String): LinkedHashMap<String, Any?>? = readRepository.findRecipeAnyStatus(code)

    fun findGlobalPreference(): LinkedHashMap<String, Any?>? = readRepository.findGlobalPreference()

    @Transactional
    fun createRecipe(input: CreateRecipeInput): LinkedHashMap<String, Any?> {
        val recipe = recipeWrites.insertAgentRecipe(input)
        return readRepository.findRecipeAnyStatus(recipe.code)
            ?: error("inserted recipe ${recipe.id} could not be read")
    }

    @Transactional
    fun patchRecipe(code: String, body: ObjectNode): LinkedHashMap<String, Any?> {
        val recipe = recipe(code) ?: throw AgentRecipeMissingException(code)
        if (body.has("title")) recipe.title = body.get("title").asLooseString()
        if (body.has("params")) recipe.params = body.get("params").asDatabaseJson()
        if (body.has("steps")) recipe.steps = body.get("steps").asDatabaseJson()
        if (body.has("notes")) recipe.notes = body.get("notes").asLooseString()
        if (body.has("intent")) recipe.intent = body.get("intent").asStringList()
        if (body.has("beanSnapshot")) recipe.beanSnapshot = body.get("beanSnapshot").asDatabaseJson()
        if (body.has("adjustmentFromPrevious")) {
            recipe.adjustmentFromPrevious = body.get("adjustmentFromPrevious").asLooseString()
        }
        if (body.has("dripperPortability")) {
            recipe.dripperPortability = body.get("dripperPortability").asDatabaseJson()
        }
        recipe.version += 1
        entityManager.flush()
        return readRepository.findRecipeAnyStatus(code) ?: throw AgentRecipeMissingException(code)
    }

    @Transactional
    fun setRecipeStatus(code: String, status: String): LinkedHashMap<String, Any?> {
        val recipe = recipe(code) ?: throw AgentRecipeMissingException(code)
        recipe.status = status
        entityManager.flush()
        return readRepository.findRecipeAnyStatus(code) ?: throw AgentRecipeMissingException(code)
    }

    @Transactional
    fun supersede(oldCode: String, newCode: String): LinkedHashMap<String, Any?> {
        // Resolve both before mutation.  The transaction still protects against any
        // later exception, and this preserves the Hono error's missing-code detail.
        val old = recipe(oldCode) ?: throw AgentRecipeMissingException(oldCode)
        val replacement = recipe(newCode) ?: throw AgentRecipeMissingException(newCode)
        old.status = "superseded"
        old.supersededBy = newCode
        replacement.supersedes = oldCode
        entityManager.flush()
        val oldRow = readRepository.findRecipeAnyStatus(oldCode) ?: throw AgentRecipeMissingException(oldCode)
        val replacementRow = readRepository.findRecipeAnyStatus(newCode) ?: throw AgentRecipeMissingException(newCode)
        return linkedMapOf("old" to oldRow, "replacement" to replacementRow)
    }

    @Transactional
    fun createFeedback(recipeCode: String, source: String, body: ObjectNode): LinkedHashMap<String, Any?> {
        if (readRepository.findRecipeAnyStatus(recipeCode) == null) throw AgentRecipeMissingException(recipeCode)
        val feedback = Feedback().apply {
            id = UUID.randomUUID()
            this.recipeCode = recipeCode
            beanId = body.get("beanId").asLooseString()
            ratings = body.get("ratings").asDatabaseJson()
            actual = body.get("actual").asDatabaseJson()
            comment = body.get("comment").asLooseString()
            rawComment = body.get("rawComment").asLooseString()
            quickTags = body.get("quickTags").asStringList()
            desiredDirection = body.get("desiredDirection").asStringList()
            nextHint = body.get("nextHint").asStringList()
            this.source = source
        }
        entityManager.persist(feedback)
        entityManager.flush()
        entityManager.refresh(feedback)
        return readRepository.findFeedback(feedback.id.toString())
            ?: error("inserted feedback ${feedback.id} could not be read")
    }

    @Transactional
    fun updateGlobalPreferences(input: UpdatePreferencesInput): LinkedHashMap<String, Any?> {
        jdbcTemplate.update(
            """
            insert into preferences (id, likes, dislikes)
            values ('global', cast(? as text[]), cast(? as text[]))
            on conflict (id) do update set
              likes = excluded.likes,
              dislikes = excluded.dislikes,
              updated_at = now()
            """.trimIndent(),
            input.likes.toTypedArray(),
            input.dislikes.toTypedArray()
        )
        return readRepository.findGlobalPreference() ?: error("global preferences could not be read")
    }

    @Transactional
    fun patchBean(id: String, input: BeanAttributesInput): LinkedHashMap<String, Any?> {
        val bean = entityManager.find(Bean::class.java, id) ?: throw AgentBeanMissingException()
        val effectiveMin = input.agtronMin ?: bean.agtronMin
        val effectiveMax = input.agtronMax ?: bean.agtronMax
        if (effectiveMin != null && effectiveMax != null && effectiveMax < effectiveMin) {
            throw AgentInvalidRangeException("agtronMax ($effectiveMax) must be >= agtronMin ($effectiveMin)")
        }
        input.roastLevelOrd?.let { bean.roastLevelOrd = it.toShort() }
        input.agtronMin?.let { bean.agtronMin = it }
        input.agtronMax?.let { bean.agtronMax = it }
        input.acidity?.let { bean.acidity = it.toShort() }
        input.body?.let { bean.body = it.toShort() }
        input.decaf?.let { bean.decaf = it }
        input.flavorCategories?.let { bean.flavorCategories = it }
        input.attrsSource?.let { bean.attrsSource = it }
        input.sourceUrl?.let { bean.sourceUrl = it }
        input.attrsNotes?.let { bean.attrsNotes = it }
        entityManager.flush()
        return readRepository.findBean(id) ?: throw AgentBeanMissingException()
    }

    @Transactional
    fun resyncBean(id: String): LinkedHashMap<String, Any?> {
        val bean = entityManager.find(Bean::class.java, id) ?: throw AgentBeanMissingException()
        val source = readRepository.findResyncSource(id)
        if (source == null) {
            return linkedMapOf(
                "bean" to (readRepository.findBean(id) ?: throw AgentBeanMissingException()),
                "sourceRecipeCode" to null,
                "changed" to emptyList<String>()
            )
        }
        val snapshot = parseSnapshot(source.beanSnapshot)
        val changed = mutableListOf<String>()
        snapshotText(snapshot, "origin")?.takeIf { it != bean.origin }?.let {
            bean.origin = it
            changed += "origin"
        }
        snapshotText(snapshot, "process")?.takeIf { it != bean.process }?.let {
            bean.process = it
            changed += "process"
        }
        snapshotText(snapshot, "roastLevel")?.takeIf { it != bean.roastLevel }?.let {
            bean.roastLevel = it
            changed += "roast_level"
        }
        snapshotText(snapshot, "notes")?.takeIf { it != bean.notes }?.let {
            bean.notes = it
            changed += "notes"
        }
        if (changed.isNotEmpty()) entityManager.flush()
        return linkedMapOf(
            "bean" to (readRepository.findBean(id) ?: throw AgentBeanMissingException()),
            "sourceRecipeCode" to source.code,
            "changed" to changed
        )
    }

    @Transactional
    fun createPurchaseLink(id: String, input: CreateBeanPurchaseLinkInput): LinkedHashMap<String, Any?> {
        if (entityManager.find(Bean::class.java, id) == null) throw AgentBeanMissingException()
        val link = BeanPurchaseLink().apply {
            this.id = UUID.randomUUID()
            beanId = id
            vendor = input.vendor
            url = input.url
            linkCategory = input.linkCategory
            priceKrw = input.priceKrw
            isAffiliate = input.isAffiliate
            sortOrder = input.sortOrder
        }
        entityManager.persist(link)
        entityManager.flush()
        entityManager.refresh(link)
        return readRepository.findPurchaseLink(link.id.toString())
            ?: error("inserted purchase link ${link.id} could not be read")
    }

    private fun recipe(code: String): Recipe? = entityManager.createQuery(
        "select recipe from Recipe recipe where recipe.code = :code",
        Recipe::class.java
    ).setParameter("code", code).resultList.firstOrNull()

    private fun parseSnapshot(raw: String): ObjectNode? = try {
        objectMapper.readTree(raw) as? ObjectNode
    } catch (_: Exception) {
        null
    }

    private fun snapshotText(snapshot: ObjectNode?, key: String): String? = snapshot?.get(key)
        ?.takeIf { it.isTextual }
        ?.asText()
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

    private fun JsonNode?.asLooseString(): String? = when {
        this == null || isNull -> null
        else -> asText()
    }

    private fun JsonNode?.asDatabaseJson(): String? = when {
        this == null || isNull -> null
        else -> toString()
    }

    private fun JsonNode?.asStringList(): List<String>? = when {
        this == null || isNull -> null
        !isArray -> null
        else -> values().map { it.asText() }
    }
}
