package com.brewdial.api.agent

import com.brewdial.api.bean.Bean
import com.brewdial.api.config.DatabaseVendor
import com.brewdial.api.config.VendorSql
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
class AgentFeedbackMissingException : RuntimeException()
class AgentFeedbackConflictException(val currentUpdatedAt: String) : RuntimeException()

@Service
class AgentWriteService(
    private val entityManager: EntityManager,
    private val recipeWrites: AgentRecipeWriteRepository,
    private val readRepository: ReadRepository,
    private val jdbcTemplate: JdbcTemplate,
    private val objectMapper: ObjectMapper,
    private val sql: VendorSql
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
        val old = recipe(oldCode) ?: throw AgentRecipeMissingException(oldCode)
        old.status = "superseded"
        old.supersededBy = newCode
        // Match Hono: write old first, then rely on this transaction to roll it
        // back if the replacement cannot be found.
        entityManager.flush()

        val replacement = recipe(newCode) ?: throw AgentRecipeMissingException(newCode)
        replacement.supersedes = oldCode
        entityManager.flush()
        val oldRow = readRepository.findRecipeAnyStatus(oldCode) ?: throw AgentRecipeMissingException(oldCode)
        val replacementRow = readRepository.findRecipeAnyStatus(newCode) ?: throw AgentRecipeMissingException(newCode)
        return linkedMapOf("old" to oldRow, "replacement" to replacementRow)
    }

    @Transactional
    fun createFeedback(recipeCode: String, source: String, body: ObjectNode): LinkedHashMap<String, Any?> {
        val recipe = entityManager.createQuery("select recipe from Recipe recipe where recipe.code = :code", Recipe::class.java)
            .setParameter("code", recipeCode).setLockMode(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
            .resultList.firstOrNull() ?: throw AgentRecipeMissingException(recipeCode)
        val actualNode = body.get("actual")
        if (actualNode != null && !validActual(actualNode)) throw AgentInvalidRangeException("invalid actual")
        val params = parseJson(recipe.params)
        val snapshot = objectMapper.createObjectNode()
            .set("params", params ?: objectMapper.createObjectNode())
        snapshot.set("steps", parseJson(recipe.steps) ?: objectMapper.createArrayNode())
        snapshot.put("method", recipe.method)
        recipe.beanId?.let { snapshot.put("beanId", it) }
        params?.path("grind")?.path("perGrinder")?.takeIf { it.isArray }?.let { parts ->
            val grinderIds = objectMapper.createArrayNode()
            parts.mapNotNull { it.path("grinderId").takeIf { value -> value.isTextual }?.asText() }.forEach { grinderIds.add(it) }
            if (!grinderIds.isEmpty) {
                snapshot.set("grinderIds", grinderIds)
                snapshot.put("grinderId", grinderIds[0].asText())
            }
        }
        val portability = parseJson(recipe.dripperPortability)
        portability?.path("origin")?.path("dripperId")?.takeIf { it.isTextual }?.let { snapshot.set("dripperId", it) }
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
            recipeVersion = recipe.version
            recipeSnapshot = objectMapper.writeValueAsString(snapshot)
        }
        entityManager.persist(feedback)
        entityManager.flush()
        entityManager.refresh(feedback)
        return readRepository.findFeedback(feedback.id.toString())
            ?: error("inserted feedback ${feedback.id} could not be read")
    }

    private fun parseJson(value: String?): JsonNode? = value?.let { runCatching { objectMapper.readTree(it) }.getOrNull() }

    private fun validActual(actual: JsonNode): Boolean {
        if (!actual.isObject) return false
        val allowed = setOf("tempC", "grind", "timeSec", "doseG", "waterG", "blend")
        if (actual.propertyNames().asSequence().any { it !in allowed }) return false
        if (actual.has("tempC") && !actual["tempC"].isNumber) return false
        if (actual.has("timeSec") && !actual["timeSec"].isNumber) return false
        if (actual.has("grind") && !actual["grind"].isTextual) return false
        for (key in listOf("doseG", "waterG")) if (actual.has(key) && (!actual[key].isNumber || !actual[key].asDouble().isFinite() || actual[key].asDouble() <= 0)) return false
        if (actual.has("blend")) {
            val blend = actual["blend"]
            if (!blend.isArray || blend.size() !in 1..5 || blend.any { part ->
                    !part.isObject || part.propertyNames().asSequence().any { it !in setOf("beanId", "name", "grams") } ||
                        (!part.path("beanId").isTextual && !part.path("name").isTextual) ||
                        (part.path("beanId").isTextual && part.path("beanId").asText().isBlank()) ||
                        (part.path("name").isTextual && part.path("name").asText().isBlank()) ||
                        !part.path("grams").isNumber || !part.path("grams").asDouble().isFinite() || part.path("grams").asDouble() <= 0
                }) return false
        }
        return true
    }

    @Transactional
    fun updateFeedback(id: UUID, body: ObjectNode): LinkedHashMap<String, Any?> {
        val row = entityManager.find(Feedback::class.java, id, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
            ?: throw AgentFeedbackMissingException()
        val currentTimestamp = row.updatedAt?.toString() ?: ""
        if (body.has("expectedUpdatedAt")) {
            val expected = runCatching { java.time.Instant.parse(body.path("expectedUpdatedAt").asText()) }.getOrNull()
                ?: throw AgentInvalidRangeException("expectedUpdatedAt must be a valid timestamp string")
            if (expected != row.updatedAt) throw AgentFeedbackConflictException(currentTimestamp)
        }
        val before = readRepository.findFeedback(id.toString()) ?: throw AgentFeedbackMissingException()
        val after = LinkedHashMap(before)
        val changed = mutableListOf<String>()
        for ((key, column) in listOf("ratings" to "ratings", "actual" to "actual")) if (body.has(key)) {
            val incoming = body.get(key)
            if (!incoming.isObject) throw AgentInvalidRangeException("$key must be an object")
            val merged = parseJson(if (key == "ratings") row.ratings else row.actual)?.takeIf { it.isObject }?.deepCopy() as? ObjectNode
                ?: objectMapper.createObjectNode()
            incoming.properties().forEach { entry -> if (entry.value.isNull) merged.remove(entry.key) else merged.set(entry.key, entry.value) }
            val serialized = if (merged.isEmpty) null else objectMapper.writeValueAsString(merged)
            if (key == "ratings") row.ratings = serialized else row.actual = serialized
            after[column] = if (merged.isEmpty) null else merged
            changed += key
        }
        val scalarFields = mapOf("rawComment" to "raw_comment", "comment" to "comment", "quickTags" to "quick_tags", "desiredDirection" to "desired_direction", "nextHint" to "next_hint")
        for ((key, column) in scalarFields) if (body.has(key)) {
            val value = body.get(key)
            if (key in listOf("rawComment", "comment") && !value.isNull && (!value.isTextual || value.asText().length > 2000)) throw AgentInvalidRangeException("$key must be a string of at most 2000 characters or null")
            if (key == "quickTags" && !value.isNull && (!value.isArray || value.size() > 20)) throw AgentInvalidRangeException("quickTags must contain at most 20 items or be null")
            when (key) {
                "rawComment" -> row.rawComment = value.takeUnless { it.isNull }?.asText()
                "comment" -> row.comment = value.takeUnless { it.isNull }?.asText()
                "quickTags" -> row.quickTags = value.takeUnless { it.isNull }?.values()?.map { it.asText() }
                "desiredDirection" -> row.desiredDirection = value.takeUnless { it.isNull }?.values()?.map { it.asText() }
                "nextHint" -> row.nextHint = value.takeUnless { it.isNull }?.values()?.map { it.asText() }
            }
            after[column] = if (value.isNull) null else when (key) {
                "rawComment", "comment" -> value.asText()
                else -> value
            }
            changed += key
        }
        if (body.path("dryRun").asBoolean(false)) return linkedMapOf("dryRun" to true, "before" to before, "after" to after, "changed" to changed)
        entityManager.flush()
        entityManager.refresh(row)
        return readRepository.findFeedback(id.toString()) ?: throw AgentFeedbackMissingException()
    }

    @Transactional
    fun updateGlobalPreferences(input: UpdatePreferencesInput): LinkedHashMap<String, Any?> {
        when (sql.vendor) {
            DatabaseVendor.POSTGRESQL -> jdbcTemplate.update(
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
            // text[] is a JSON array; the update trigger stamps updated_at.
            DatabaseVendor.MYSQL -> jdbcTemplate.update(
                """
                insert into preferences (id, likes, dislikes)
                values ('global', cast(? as json), cast(? as json)) as incoming
                on duplicate key update
                  likes = incoming.likes,
                  dislikes = incoming.dislikes
                """.trimIndent(),
                objectMapper.writeValueAsString(input.likes),
                objectMapper.writeValueAsString(input.dislikes)
            )
        }
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
