package com.brewdial.api.agent

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
    private val writes: AgentWriteService
) {
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
        return try {
            ResponseEntity.status(HttpStatus.CREATED).body(
                writes.createFeedback(recipeCode.asText(), rawSource?.asText() ?: "agent", body)
            )
        } catch (_: AgentRecipeMissingException) {
            ResponseEntity.status(HttpStatus.NOT_FOUND).body(linkedMapOf("error" to "recipe not found"))
        }
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
        val STATUSES = listOf("active", "archived", "superseded", "test")
        val FEEDBACK_SOURCES = listOf("agent", "mcp", "coffee_profile", "api")
    }
}
