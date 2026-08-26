package com.brewdial.api.me

import com.brewdial.api.identity.IdentityFilter
import com.brewdial.api.read.ReadRepository
import com.brewdial.api.recommend.BeanAttributes
import com.brewdial.api.recommend.BeanScore
import com.brewdial.api.recommend.TasteSignals
import com.brewdial.api.recommend.TasteTarget
import com.brewdial.api.recommend.deriveTasteTarget
import com.brewdial.api.recommend.scoreBean
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@RestController
@RequestMapping(value = ["/api/me", "/me"])
class MeController(
    private val meRepository: MeRepository,
    private val readRepository: ReadRepository,
    private val objectMapper: ObjectMapper
) {
    @PostMapping("/saved-recipes")
    fun saveRecipe(request: HttpServletRequest): ResponseEntity<Any> {
        val appUserId = IdentityFilter.appUserId(request) ?: return identityRequired()
        val code = textField(readBody(request), "code") ?: return badRequest("code required")
        meRepository.saveRecipe(appUserId, code)
        return response(HttpStatus.CREATED, linkedMapOf("ok" to true))
    }

    @PostMapping("/saved-beans")
    fun saveBean(request: HttpServletRequest): ResponseEntity<Any> {
        val appUserId = IdentityFilter.appUserId(request) ?: return identityRequired()
        val beanId = textField(readBody(request), "beanId") ?: return badRequest("beanId required")
        meRepository.saveBean(appUserId, beanId)
        return response(HttpStatus.CREATED, linkedMapOf("ok" to true))
    }

    @GetMapping("/collections")
    fun collections(request: HttpServletRequest): ResponseEntity<Any> {
        val appUserId = IdentityFilter.appUserId(request) ?: return identityRequired()
        return response(HttpStatus.OK, meRepository.collections(appUserId))
    }

    @GetMapping("/recommendations")
    fun recommendations(request: HttpServletRequest): LinkedHashMap<String, Any> {
        val signals = meRepository.tasteSignals(IdentityFilter.appUserId(request))
        val preferences = meRepository.globalPreference()
        val target = deriveTasteTarget(
            TasteSignals(
                savedBeanAttrs = signals.savedBeanAttrs,
                ratedBeanAttrs = signals.ratedBeanAttrs,
                likes = preferences.likes,
                dislikes = preferences.dislikes
            )
        )
        val candidates = readRepository.listBeans().mapNotNull { row ->
            val id = row["id"] as? String
            if (id.isNullOrEmpty()) null else CandidateScore(id, scoreBean(beanAttributes(row), target))
        }
        val rankScore = mapOf("great" to 3, "ok" to 2, "adventure" to 1, "unknown" to 0)
        val ranked = candidates.withIndex()
            .sortedWith(
                compareByDescending<IndexedValue<CandidateScore>> { rankScore.getValue(it.value.result.band) }
                    .thenByDescending { it.value.result.score }
                    .thenBy { it.index }
            )
            .map { it.value.id }
        val bands = LinkedHashMap<String, Any>()
        candidates.forEach { candidate ->
            bands[candidate.id] = linkedMapOf(
                "band" to candidate.result.band,
                "axes" to candidate.result.axes,
                "why" to candidate.result.why
            )
        }
        return linkedMapOf(
            "tasteProfile" to linkedMapOf(
                "targets" to renderedTargets(target),
                "flavorAffinity" to target.flavorAffinity,
                "penalize" to target.penalize,
                "confidence" to target.confidence,
                "summary" to target.summary,
                "evidence" to target.evidence,
                "likes" to preferences.likes,
                "dislikes" to preferences.dislikes
            ),
            "bands" to bands,
            "ranked" to ranked
        )
    }

    @PutMapping("/gear")
    fun upsertGear(request: HttpServletRequest): ResponseEntity<Any> {
        val appUserId = IdentityFilter.appUserId(request) ?: return identityRequired()
        val body = readBody(request)
        val kind = textField(body, "kind")?.takeIf { it.isNotEmpty() }
        val label = textField(body, "label")?.takeIf { it.isNotEmpty() }
        if (kind == null || label == null) return badRequest("kind and label required")

        val details = body?.get("details")?.takeUnless { it.isNull } ?: objectMapper.createObjectNode()
        val id = meRepository.upsertGear(
            appUserId = appUserId,
            kind = kind,
            label = label,
            grinderId = nullableTextField(body, "grinderId"),
            dripperId = nullableTextField(body, "dripperId"),
            details = objectMapper.writeValueAsString(details),
            isDefault = body?.get("isDefault")?.takeIf { it.isBoolean }?.booleanValue() ?: false
        )
        return response(HttpStatus.OK, linkedMapOf("ok" to true, "id" to id))
    }

    @PutMapping("/calibration")
    fun upsertCalibration(request: HttpServletRequest): ResponseEntity<Any> {
        val appUserId = IdentityFilter.appUserId(request) ?: return identityRequired()
        val body = readBody(request)
        val fromLabel = textField(body, "fromLabel")?.takeIf { it.isNotEmpty() }
        val toLabel = textField(body, "toLabel")?.takeIf { it.isNotEmpty() }
        if (fromLabel == null || toLabel == null) return badRequest("fromLabel and toLabel required")

        val samples = body?.get("samples")?.takeUnless { it.isNull } ?: objectMapper.createArrayNode()
        val id = meRepository.upsertCalibration(
            appUserId = appUserId,
            fromLabel = fromLabel,
            toLabel = toLabel,
            anchorMethod = nullableTextField(body, "anchorMethod"),
            fromGrinderId = nullableTextField(body, "fromGrinderId"),
            toGrinderId = nullableTextField(body, "toGrinderId"),
            samples = objectMapper.writeValueAsString(samples),
            source = textField(body, "source") ?: "measured",
            notes = textField(body, "notes")
        )
        return response(HttpStatus.OK, linkedMapOf("ok" to true, "id" to id))
    }

    private fun beanAttributes(row: Map<String, Any?>): BeanAttributes = BeanAttributes(
        roastLevelOrd = number(row["roast_level_ord"]),
        agtronMin = number(row["agtron_min"]),
        agtronMax = number(row["agtron_max"]),
        acidity = number(row["acidity"]),
        body = number(row["body"]),
        decaf = row["decaf"] as? Boolean,
        flavorCategories = (row["flavor_categories"] as? List<*>)?.mapNotNull { it?.toString() },
        attrsSource = row["attrs_source"] as? String
    )

    private fun number(value: Any?): Int? = (value as? Number)?.toInt()

    private fun renderedTargets(target: TasteTarget): LinkedHashMap<String, Any> = linkedMapOf<String, Any>().also {
        target.acidity?.let { value -> it["acidity"] = Math.round(value) }
        target.body?.let { value -> it["body"] = Math.round(value) }
        target.roast?.let { value -> it["roast"] = Math.round(value) }
    }

    private fun readBody(request: HttpServletRequest): JsonNode? = try {
        request.inputStream.use { input ->
            val bytes = input.readBytes()
            if (bytes.isEmpty()) null else objectMapper.readTree(bytes)
        }
    } catch (_: Exception) {
        null
    }

    private fun textField(body: JsonNode?, name: String): String? =
        body?.takeIf { it.isObject }?.get(name)?.takeIf { it.isTextual }?.textValue()

    private fun nullableTextField(body: JsonNode?, name: String): String? =
        textField(body, name)?.takeIf { it.isNotEmpty() }

    private fun identityRequired(): ResponseEntity<Any> = response(
        HttpStatus.UNAUTHORIZED,
        linkedMapOf("ok" to false, "error" to "identity required")
    )

    private fun badRequest(error: String): ResponseEntity<Any> =
        response(HttpStatus.BAD_REQUEST, linkedMapOf("error" to error))

    private fun response(status: HttpStatus, body: Any): ResponseEntity<Any> =
        ResponseEntity.status(status).body(body)

    private class CandidateScore(val id: String, val result: BeanScore)
}
