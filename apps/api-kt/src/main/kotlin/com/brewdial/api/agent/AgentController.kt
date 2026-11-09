package com.brewdial.api.agent

import com.brewdial.api.brew.AgentXBloomBrewService
import com.brewdial.api.brew.validateXBloomBrew
import com.brewdial.api.validation.validateCreateBeanPurchaseLinkInput
import com.brewdial.api.validation.validateCreateRecipeInput
import com.brewdial.api.validation.validateUpdateBeanAttributesInput
import com.brewdial.api.validation.validateUpdatePreferencesInput
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.node.JsonNodeFactory
import tools.jackson.databind.node.ObjectNode

@Component
class AgentJsonBodyReader(private val objectMapper: ObjectMapper) {
    /** Hono's req.json().catch(() => null) behavior. */
    fun read(request: HttpServletRequest): JsonNode? = try {
        objectMapper.readTree(request.inputStream)
    } catch (_: Exception) {
        null
    }
}

@RestController
@RequestMapping(value = ["/api/agent", "/agent"])
class AgentController(
    private val bodies: AgentJsonBodyReader,
    private val writes: AgentWriteService,
    private val brews: AgentXBloomBrewService
) {
    @PostMapping("/brews")
    fun ingestBrews(request: HttpServletRequest): ResponseEntity<Any> {
        val body = bodies.read(request) as? ObjectNode ?: return error("body must contain only a brews array", HttpStatus.BAD_REQUEST)
        if (body.propertyNames().any { it != "brews" }) return error("body must contain only a brews array", HttpStatus.BAD_REQUEST)
        val items = body.get("brews")
        if (items == null || !items.isArray || items.size() !in 1..100) return error("brews must contain 1 to 100 items", HttpStatus.BAD_REQUEST)
        val errors = items.flatMapIndexed { index, item -> validateXBloomBrew(item).map { "brews[$index].${it.removePrefix("brew.")}" } }
        if (errors.isNotEmpty()) return ResponseEntity.badRequest().body(linkedMapOf("error" to "validation failed", "details" to errors))
        val brewItems = mutableListOf<ObjectNode>()
        items.forEach { brewItems += it as ObjectNode }
        return ResponseEntity.ok(brews.ingest(brewItems))
    }

    @GetMapping("/brews")
    fun listBrews(
        @RequestParam(required = false) limit: String?,
        @RequestParam(required = false) recipeCode: String?,
        @RequestParam(required = false) xbloomRecipeId: String?,
        @RequestParam(required = false) since: String?
    ): ResponseEntity<Any> {
        val parsedLimit = limit?.toIntOrNull() ?: if (limit == null) 20 else 0
        if (parsedLimit !in 1..100) return error("limit must be an integer from 1 to 100", HttpStatus.BAD_REQUEST)
        if (recipeCode != null && !recipeCode.matches(Regex("COF-\\d{4,}"))) return error("invalid recipeCode", HttpStatus.BAD_REQUEST)
        if (xbloomRecipeId != null && !xbloomRecipeId.matches(Regex("\\d{1,32}"))) return error("invalid xbloomRecipeId", HttpStatus.BAD_REQUEST)
        val timestamp = if (since == null) null else runCatching { java.time.Instant.parse(since) }.getOrNull()
        if (since != null && timestamp == null) return error("invalid since timestamp", HttpStatus.BAD_REQUEST)
        return ResponseEntity.ok(brews.list(parsedLimit, recipeCode, xbloomRecipeId, timestamp))
    }

    @GetMapping("/brews/{id}")
    fun brew(@PathVariable id: String): ResponseEntity<Any> = brews.detail(id)
        ?.let { ResponseEntity.ok(it) }
        ?: error("brew not found", HttpStatus.NOT_FOUND)

    @PutMapping("/xbloom-recipe-links/{xbloomRecipeId}")
    fun putXBloomRecipeLink(@PathVariable xbloomRecipeId: String, request: HttpServletRequest): ResponseEntity<Any> {
        if (!xbloomRecipeId.matches(Regex("\\d{1,32}"))) return error("invalid xbloomRecipeId", HttpStatus.BAD_REQUEST)
        val body = bodies.read(request) as? ObjectNode ?: return error("recipeCode is required", HttpStatus.BAD_REQUEST)
        if (body.propertyNames().any { it != "recipeCode" } || body.size() != 1) return error("recipeCode is required", HttpStatus.BAD_REQUEST)
        val code = body.get("recipeCode")?.takeIf { it.isTextual }?.asText()
            ?: return error("recipeCode is required", HttpStatus.BAD_REQUEST)
        if (!code.matches(Regex("COF-\\d{4,}"))) return error("recipeCode is required", HttpStatus.BAD_REQUEST)
        if (!brews.link(xbloomRecipeId, code)) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(linkedMapOf("error" to "recipe not found"))
        return ResponseEntity.ok(linkedMapOf("xbloomRecipeId" to xbloomRecipeId, "recipeCode" to code))
    }

    @GetMapping("/xbloom-recipe-links")
    fun getXBloomRecipeLinks(): ResponseEntity<Any> = ResponseEntity.ok(brews.links())

    @PostMapping("/recipes")
    fun createRecipe(request: HttpServletRequest): ResponseEntity<Any> {
        val validation = validateCreateRecipeInput(bodies.read(request))
        if (!validation.ok) return badValidation(validation.errors)
        return ResponseEntity.status(HttpStatus.CREATED).body(writes.createRecipe(validation.value!!))
    }

    @GetMapping("/recipes/{code}")
    fun recipe(@PathVariable code: String): ResponseEntity<Any> {
        // The write service's source of truth is a no-status-filter read.
        val row = writes.findRecipeAnyStatus(code)
        return if (row == null) notFound() else ResponseEntity.ok(row)
    }

    @PatchMapping("/recipes/{code}")
    fun patchRecipe(@PathVariable code: String, request: HttpServletRequest): ResponseEntity<Any> {
        val body = bodies.read(request) as? ObjectNode ?: return error("invalid body", HttpStatus.BAD_REQUEST)
        return try {
            ResponseEntity.ok(writes.patchRecipe(code, body))
        } catch (_: AgentRecipeMissingException) {
            notFound()
        }
    }

    @PatchMapping("/recipes/{code}/status")
    fun patchRecipeStatus(@PathVariable code: String, request: HttpServletRequest): ResponseEntity<Any> {
        val body = bodies.read(request) as? ObjectNode
        val status = body?.get("status")
        if (status == null || !status.isTextual) return error("status is required", HttpStatus.BAD_REQUEST)
        val value = status.asText()
        if (value !in STATUSES) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
                linkedMapOf("error" to "invalid status", "valid" to STATUSES)
            )
        }
        return try {
            ResponseEntity.ok(writes.setRecipeStatus(code, value))
        } catch (_: AgentRecipeMissingException) {
            notFound()
        }
    }

    @PostMapping("/recipes/supersede")
    fun supersede(request: HttpServletRequest): ResponseEntity<Any> {
        val body = bodies.read(request) as? ObjectNode
        val oldCode = body?.get("oldCode")
        val newCode = body?.get("newCode")
        if (oldCode == null || newCode == null || !oldCode.isTextual || !newCode.isTextual) {
            return error("oldCode and newCode are required", HttpStatus.BAD_REQUEST)
        }
        val old = oldCode.asText()
        val replacement = newCode.asText()
        if (old == replacement) return error("cannot supersede a recipe with itself", HttpStatus.BAD_REQUEST)
        return try {
            ResponseEntity.ok(writes.supersede(old, replacement))
        } catch (exception: AgentRecipeMissingException) {
            ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                linkedMapOf("error" to "not found", "detail" to (exception.message ?: "recipe not found"))
            )
        }
    }

    @PostMapping("/feedback")
    fun createFeedback(request: HttpServletRequest): ResponseEntity<Any> {
        val body = bodies.read(request) as? ObjectNode ?: return error("invalid body", HttpStatus.BAD_REQUEST)
        val recipeCode = body.get("recipeCode")
        if (recipeCode == null || !recipeCode.isTextual || recipeCode.asText().isEmpty()) {
            return error("recipeCode is required", HttpStatus.BAD_REQUEST)
        }
        val rawSource = body.get("source")
        if (body.has("source") && (rawSource == null || !rawSource.isTextual || rawSource.asText() !in FEEDBACK_SOURCES)) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
                linkedMapOf("error" to "invalid source", "valid" to FEEDBACK_SOURCES)
            )
        }
        if (body.has("actual") && !validActual(body.get("actual"))) return error("invalid actual", HttpStatus.BAD_REQUEST)
        return try {
            ResponseEntity.status(HttpStatus.CREATED).body(
                writes.createFeedback(recipeCode.asText(), rawSource?.asText() ?: "agent", body)
            )
        } catch (_: AgentRecipeMissingException) {
            ResponseEntity.status(HttpStatus.NOT_FOUND).body(linkedMapOf("error" to "recipe not found"))
        } catch (exception: AgentInvalidRangeException) {
            ResponseEntity.status(HttpStatus.BAD_REQUEST).body(linkedMapOf("error" to "validation failed", "details" to listOf(exception.message)))
        }
    }

    @PatchMapping("/feedback/{id}")
    fun patchFeedback(@PathVariable id: String, request: HttpServletRequest): ResponseEntity<Any> {
        val uuid = runCatching { java.util.UUID.fromString(id) }.getOrNull() ?: return error("invalid id", HttpStatus.BAD_REQUEST)
        val body = bodies.read(request) as? ObjectNode ?: return error("invalid body", HttpStatus.BAD_REQUEST)
        return try {
            ResponseEntity.ok(writes.updateFeedback(uuid, body))
        } catch (_: AgentFeedbackMissingException) {
            notFound()
        } catch (exception: AgentFeedbackConflictException) {
            ResponseEntity.status(HttpStatus.CONFLICT).body(linkedMapOf("error" to "version_conflict", "currentUpdatedAt" to exception.currentUpdatedAt))
        } catch (exception: AgentInvalidRangeException) {
            ResponseEntity.status(HttpStatus.BAD_REQUEST).body(linkedMapOf("error" to "validation failed", "details" to listOf(exception.message)))
        }
    }

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

    @GetMapping("/preferences/global")
    fun globalPreferences(): ResponseEntity<Any> = writes.findGlobalPreference()
        ?.let { ResponseEntity.ok(it) }
        ?: ResponseEntity.ok(JsonNodeFactory.instance.nullNode())

    @PostMapping("/preferences/global")
    fun updateGlobalPreferences(request: HttpServletRequest): ResponseEntity<Any> {
        val validation = validateUpdatePreferencesInput(bodies.read(request))
        if (!validation.ok) return badValidation(validation.errors)
        return ResponseEntity.ok(writes.updateGlobalPreferences(validation.value!!))
    }

    @PatchMapping("/beans/{id}")
    fun patchBean(@PathVariable id: String, request: HttpServletRequest): ResponseEntity<Any> {
        val validation = validateUpdateBeanAttributesInput(bodies.read(request))
        if (!validation.ok) return badValidation(validation.errors)
        return try {
            ResponseEntity.ok(writes.patchBean(id, validation.value!!))
        } catch (_: AgentBeanMissingException) {
            notFound()
        } catch (exception: AgentInvalidRangeException) {
            ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
                linkedMapOf("error" to "validation failed", "details" to listOf(exception.message ?: "invalid range"))
            )
        }
    }

    @PostMapping("/beans/{id}/resync")
    fun resyncBean(@PathVariable id: String): ResponseEntity<Any> = try {
        ResponseEntity.ok(writes.resyncBean(id))
    } catch (_: AgentBeanMissingException) {
        notFound()
    }

    @PostMapping("/beans/{id}/purchase-links")
    fun createPurchaseLink(@PathVariable id: String, request: HttpServletRequest): ResponseEntity<Any> {
        val validation = validateCreateBeanPurchaseLinkInput(bodies.read(request))
        if (!validation.ok) return badValidation(validation.errors)
        return try {
            ResponseEntity.status(HttpStatus.CREATED).body(writes.createPurchaseLink(id, validation.value!!))
        } catch (_: AgentBeanMissingException) {
            notFound()
        }
    }

    private fun badValidation(errors: List<String>): ResponseEntity<Any> = ResponseEntity.status(HttpStatus.BAD_REQUEST)
        .body(linkedMapOf("error" to "validation failed", "details" to errors))

    private fun error(error: String, status: HttpStatus): ResponseEntity<Any> = ResponseEntity.status(status)
        .body(linkedMapOf("error" to error))

    private fun notFound(): ResponseEntity<Any> = error("not found", HttpStatus.NOT_FOUND)

    private companion object {
        val STATUSES = listOf("active", "archived", "superseded", "test", "reference")
        val FEEDBACK_SOURCES = listOf("agent", "mcp", "coffee_profile", "api")
    }
}
