package com.brewdial.api.validation

import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.ArrayNode
import tools.jackson.databind.node.JsonNodeFactory
import tools.jackson.databind.node.ObjectNode
import java.util.Locale
import kotlin.math.abs

/**
 * Kotlin-side copy of the agent-facing shared validators.  These deliberately
 * work on JsonNode rather than controller DTOs so malformed JSON values keep the
 * same validation behavior as Hono's unknown-input validators.
 */
class ValidationResult<T>(
    val ok: Boolean,
    val value: T? = null,
    val errors: List<String> = emptyList(),
    val warnings: List<String> = emptyList()
)

class CreateRecipeInput(
    val method: String,
    val title: String,
    val beanId: String? = null,
    val beanSnapshot: ObjectNode? = null,
    val params: ObjectNode? = null,
    val steps: ArrayNode? = null,
    val intent: List<String>? = null,
    val notes: String? = null,
    val adjustmentFromPrevious: String? = null,
    val createdBy: String? = null,
    val dripperPortability: ObjectNode? = null
)

class BeanAttributesInput(
    val roastLevelOrd: Int? = null,
    val agtronMin: Int? = null,
    val agtronMax: Int? = null,
    val acidity: Int? = null,
    val body: Int? = null,
    val decaf: Boolean? = null,
    val flavorCategories: List<String>? = null,
    val attrsSource: String? = null,
    val sourceUrl: String? = null,
    val attrsNotes: String? = null
) {
    fun hasAnyValue(): Boolean = listOf(
        roastLevelOrd, agtronMin, agtronMax, acidity, body, decaf,
        flavorCategories, attrsSource, sourceUrl, attrsNotes
    ).any { it != null }
}

class CreateBeanPurchaseLinkInput(
    val vendor: String,
    val url: String,
    val linkCategory: String? = null,
    val priceKrw: Int? = null,
    val isAffiliate: Boolean? = null,
    val sortOrder: Int? = null
)

class UpdatePreferencesInput(val likes: List<String>, val dislikes: List<String>)

val BREW_METHODS = listOf("v60", "espresso", "aeropress", "kalita", "other")
val BEAN_FLAVOR_CATEGORIES = listOf(
    "fruity", "floral", "sweet", "nutty_cocoa", "spices", "roasted", "cereal",
    "sour_fermented", "green"
)
val BEAN_ATTRS_SOURCES = listOf("roaster_page", "ai_extracted", "manual")
val TASTE_TAGS = listOf(
    "저산미", "고산미", "다크 로스팅", "라이트 로스팅", "고소함", "초콜릿/단맛", "저녁은 디카페인"
)
val BEAN_LINK_CATEGORIES = listOf("product", "lowest_price", "coupon", "generic")

private val POUR_OVER_METHODS = setOf("v60", "kalita", "aeropress")
private val RECIPE_PARAM_NUMBER_KEYS = listOf("doseG", "waterG", "tempC", "targetTimeSec")
private val RECIPE_PARAM_STRING_KEYS = listOf("ratio", "grinder", "brewer")
private val DRIPPER_CLASSES = listOf("bed_restricted", "dripper_restricted", "hybrid", "immersion")
private val SIZE_MATCHES = listOf("ok", "undersized", "oversized")
private val BED_DEPTH_SHIFTS = listOf("shallower", "deeper", "similar")
private val GRIND_SHIFTS = listOf("coarser", "finer", "none")
private val POUR_SHIFTS = listOf("gentler", "more_agitation", "fewer_pours", "more_pours", "none")
private val CONFIDENCES = listOf("high", "medium", "low")

fun validateCreateRecipeInput(input: JsonNode?): ValidationResult<CreateRecipeInput> {
    val objectInput = input as? ObjectNode ?: return invalid("input must be an object")
    val errors = mutableListOf<String>()
    val method = objectInput.get("method")?.takeIf { it.isTextual }?.asText()
    if (method !in BREW_METHODS) errors += "method must be one of ${BREW_METHODS.joinToString(", ")}"

    val rawTitle = objectInput.get("title")
    val title = rawTitle?.takeIf { it.isTextual }?.asText()?.trim()
    if (title.isNullOrEmpty()) errors += "title is required and must be a non-empty string"

    val beanId = pickString(objectInput, "beanId", errors, "input")
    val beanSnapshot = validateBeanSnapshot(objectInput, errors)
    val params = validateRecipeParams(objectInput, errors)
    val steps = validateRecipeSteps(objectInput, errors)

    val dripperPortability = if (objectInput.has("dripperPortability")) {
        val raw = objectInput.get("dripperPortability") as? ObjectNode
        if (raw == null) {
            errors += "dripperPortability must be an object"
            null
        } else {
            validateDripperPortability(raw, errors)
        }
    } else {
        null
    }

    val intent = if (objectInput.has("intent")) {
        val raw = objectInput.get("intent")
        if (!isStringArray(raw)) {
            errors += "intent must be a string array"
            null
        } else {
            jsonStrings(raw!!)
        }
    } else {
        null
    }
    val notes = pickString(objectInput, "notes", errors, "input")
    val adjustmentFromPrevious = pickString(objectInput, "adjustmentFromPrevious", errors, "input")

    val createdBy = if (objectInput.has("createdBy")) {
        val raw = objectInput.get("createdBy")
        if (raw == null || !raw.isTextual || raw.asText() !in listOf("agent", "manual")) {
            errors += "createdBy must be one of agent, manual"
            null
        } else {
            raw.asText()
        }
    } else {
        null
    }

    if (errors.isNotEmpty()) return invalid(errors)
    val value = CreateRecipeInput(
        method = method!!,
        title = title!!,
        beanId = beanId,
        beanSnapshot = beanSnapshot,
        params = params,
        steps = steps,
        intent = intent,
        notes = notes,
        adjustmentFromPrevious = adjustmentFromPrevious,
        createdBy = createdBy,
        dripperPortability = dripperPortability
    )
    val warnings = mutableListOf<String>()
    validateRecipeCrossFields(value, errors, warnings)
    return if (errors.isEmpty()) valid(value, warnings) else invalid(errors)
}

fun validateUpdateBeanAttributesInput(input: JsonNode?): ValidationResult<BeanAttributesInput> {
    val objectInput = input as? ObjectNode ?: return invalid("input must be an object")
    val errors = mutableListOf<String>()
    var roastLevelOrd: Int? = null
    var agtronMin: Int? = null
    var agtronMax: Int? = null
    var acidity: Int? = null
    var body: Int? = null
    var decaf: Boolean? = null
    var flavorCategories: List<String>? = null
    var attrsSource: String? = null

    if (objectInput.has("roastLevelOrd")) {
        val raw = objectInput.get("roastLevelOrd")
        if (!isInt(raw) || raw!!.asInt() !in 1..5) errors += "roastLevelOrd must be an integer 1-5"
        else roastLevelOrd = raw.asInt()
    }
    if (objectInput.has("acidity")) {
        val raw = objectInput.get("acidity")
        if (!isInt(raw) || raw!!.asInt() !in 1..5) errors += "acidity must be an integer 1-5"
        else acidity = raw.asInt()
    }
    if (objectInput.has("body")) {
        val raw = objectInput.get("body")
        if (!isInt(raw) || raw!!.asInt() !in 1..5) errors += "body must be an integer 1-5"
        else body = raw.asInt()
    }
    if (objectInput.has("agtronMin")) {
        val raw = objectInput.get("agtronMin")
        if (!isInt(raw) || raw!!.asInt() !in 0..150) errors += "agtronMin must be an integer 0-150"
        else agtronMin = raw.asInt()
    }
    if (objectInput.has("agtronMax")) {
        val raw = objectInput.get("agtronMax")
        if (!isInt(raw) || raw!!.asInt() !in 0..150) errors += "agtronMax must be an integer 0-150"
        else agtronMax = raw.asInt()
    }
    if (agtronMin != null && agtronMax != null && agtronMax < agtronMin) {
        errors += "agtronMax must be >= agtronMin"
    }
    if (objectInput.has("decaf")) {
        val raw = objectInput.get("decaf")
        if (raw == null || !raw.isBoolean) errors += "decaf must be a boolean"
        else decaf = raw.booleanValue()
    }
    if (objectInput.has("flavorCategories")) {
        val raw = objectInput.get("flavorCategories")
        if (!isStringArray(raw)) {
            errors += "flavorCategories must be a string array"
        } else {
            val values = jsonStrings(raw!!)
            val invalid = values.filterNot { it in BEAN_FLAVOR_CATEGORIES }
            if (invalid.isNotEmpty()) {
                errors += "flavorCategories contains unknown values: ${invalid.joinToString(", ")} (allowed: ${BEAN_FLAVOR_CATEGORIES.joinToString(", ")})"
            } else {
                flavorCategories = values
            }
        }
    }
    if (objectInput.has("attrsSource")) {
        val raw = objectInput.get("attrsSource")
        if (raw == null || !raw.isTextual || raw.asText() !in BEAN_ATTRS_SOURCES) {
            errors += "attrsSource must be one of ${BEAN_ATTRS_SOURCES.joinToString(", ")}"
        } else {
            attrsSource = raw.asText()
        }
    }
    val sourceUrl = pickString(objectInput, "sourceUrl", errors, "input")?.takeIf { it.isNotEmpty() }
    val attrsNotes = pickString(objectInput, "attrsNotes", errors, "input")?.takeIf { it.isNotEmpty() }

    val value = BeanAttributesInput(
        roastLevelOrd = roastLevelOrd,
        agtronMin = agtronMin,
        agtronMax = agtronMax,
        acidity = acidity,
        body = body,
        decaf = decaf,
        flavorCategories = flavorCategories,
        attrsSource = attrsSource,
        sourceUrl = sourceUrl,
        attrsNotes = attrsNotes
    )
    if (errors.isEmpty() && !value.hasAnyValue()) errors += "at least one bean attribute is required"
    return if (errors.isEmpty()) valid(value) else invalid(errors)
}

fun validateCreateBeanPurchaseLinkInput(input: JsonNode?): ValidationResult<CreateBeanPurchaseLinkInput> {
    val objectInput = input as? ObjectNode ?: return invalid("input must be an object")
    val errors = mutableListOf<String>()
    val vendor = pickString(objectInput, "vendor", errors, "input")
    if (vendor.isNullOrEmpty()) errors += "vendor is required"
    else if (vendor.length > 60) errors += "vendor must be 60 characters or fewer"

    val url = pickString(objectInput, "url", errors, "input")
    if (url.isNullOrEmpty()) errors += "url is required"
    else if (!url.startsWith("https://")) errors += "url must start with https://"
    else if (url.length > 2048) errors += "url must be 2048 characters or fewer"

    val linkCategory = if (objectInput.has("linkCategory")) {
        val raw = objectInput.get("linkCategory")
        if (raw == null || !raw.isTextual || raw.asText() !in BEAN_LINK_CATEGORIES) {
            errors += "linkCategory must be one of ${BEAN_LINK_CATEGORIES.joinToString(", ")}"
            null
        } else raw.asText()
    } else null

    val priceKrw = if (objectInput.has("priceKrw")) {
        val raw = objectInput.get("priceKrw")
        if (!isInt(raw) || raw!!.asInt() < 0) {
            errors += "priceKrw must be a non-negative integer"
            null
        } else raw.asInt()
    } else null

    val isAffiliate = if (objectInput.has("isAffiliate")) {
        val raw = objectInput.get("isAffiliate")
        if (raw == null || !raw.isBoolean) {
            errors += "isAffiliate must be a boolean"
            null
        } else raw.booleanValue()
    } else null

    val sortOrder = if (objectInput.has("sortOrder")) {
        val raw = objectInput.get("sortOrder")
        if (!isInt(raw)) {
            errors += "sortOrder must be an integer"
            null
        } else raw.asInt()
    } else null

    if (errors.isNotEmpty()) return invalid(errors)
    return valid(
        CreateBeanPurchaseLinkInput(
            vendor = vendor!!,
            url = url!!,
            linkCategory = linkCategory,
            priceKrw = priceKrw,
            isAffiliate = isAffiliate,
            sortOrder = sortOrder
        )
    )
}

fun validateUpdatePreferencesInput(input: JsonNode?): ValidationResult<UpdatePreferencesInput> {
    val objectInput = input as? ObjectNode ?: return invalid("input must be an object")
    val errors = mutableListOf<String>()
    fun clean(field: String): List<String> {
        if (!objectInput.has(field)) return emptyList()
        val raw = objectInput.get(field)
        if (!isStringArray(raw)) {
            errors += "$field must be a string array"
            return emptyList()
        }
        val values = jsonStrings(raw!!)
        val invalid = values.filterNot { it in TASTE_TAGS }
        if (invalid.isNotEmpty()) errors += "$field contains unknown taste tag(s): ${invalid.joinToString(", ")}"
        return values.filter { it in TASTE_TAGS }.distinct()
    }
    val likes = clean("likes")
    val dislikes = clean("dislikes")
    return if (errors.isEmpty()) valid(UpdatePreferencesInput(likes, dislikes)) else invalid(errors)
}

private fun validateBeanSnapshot(input: ObjectNode, errors: MutableList<String>): ObjectNode? {
    if (!input.has("beanSnapshot")) return null
    val raw = input.get("beanSnapshot") as? ObjectNode
    if (raw == null) {
        errors += "beanSnapshot must be an object"
        return null
    }
    val out = objectNode()
    listOf("name", "roaster", "roastDate", "roastLevel", "origin", "process", "notes").forEach { key ->
        pickString(raw, key, errors, "beanSnapshot")?.let { out.put(key, it) }
    }
    return out
}

private fun validateRecipeParams(input: ObjectNode, errors: MutableList<String>): ObjectNode? {
    if (!input.has("params")) return null
    val raw = input.get("params") as? ObjectNode
    if (raw == null) {
        errors += "params must be an object"
        return null
    }
    val out = objectNode()
    RECIPE_PARAM_NUMBER_KEYS.forEach { key ->
        if (!raw.has(key)) return@forEach
        val value = raw.get(key)
        if (!isFiniteNumber(value)) errors += "params.$key must be a number"
        else out.set(key, value!!)
    }
    RECIPE_PARAM_STRING_KEYS.forEach { key ->
        if (!raw.has(key)) return@forEach
        val value = raw.get(key)
        if (value == null || !value.isTextual) errors += "params.$key must be a string"
        else out.set(key, value!!)
    }
    if (raw.has("grind")) {
        val grind = raw.get("grind")
        when {
            grind != null && grind.isTextual -> out.set("grind", grind)
            isPlainObject(grind) -> validateGrindSpec(grind as ObjectNode, errors)?.let { out.set("grind", it) }
            else -> errors += "params.grind must be a string or a GrindSpec object"
        }
    }
    return out
}

private fun validateGrindSpec(raw: ObjectNode, errors: MutableList<String>): ObjectNode? {
    val target = raw.get("target") as? ObjectNode
    if (target == null) {
        errors += "params.grind.target must be an object"
        return null
    }
    val targetOut = objectNode()
    if (target.has("microns")) {
        val value = target.get("microns")
        if (!isFiniteNumber(value)) errors += "params.grind.target.microns must be a number"
        else targetOut.set("microns", value!!)
    }
    if (target.has("brewMethodPosition")) {
        val value = target.get("brewMethodPosition")
        if (value == null || !value.isTextual) errors += "params.grind.target.brewMethodPosition must be a string"
        else targetOut.set("brewMethodPosition", value!!)
    }
    if (target.has("targetDrawdownSec")) {
        val value = target.get("targetDrawdownSec")
        if (!isFiniteNumber(value)) errors += "params.grind.target.targetDrawdownSec must be a finite number"
        else targetOut.set("targetDrawdownSec", value!!)
    }
    if (!targetOut.has("brewMethodPosition") && !targetOut.has("targetDrawdownSec")) {
        errors += "params.grind.target must include brewMethodPosition or targetDrawdownSec"
        return null
    }
    val out = objectNode()
    out.set("target", targetOut)
    if (raw.has("perGrinder")) {
        val values = raw.get("perGrinder") as? ArrayNode
        if (values == null) {
            errors += "params.grind.perGrinder must be an array"
        } else if (values.size() > 10) {
            errors += "params.grind.perGrinder must have at most 10 entries"
        } else {
            val entries = arrayNode()
            values.forEachIndexed { index, item ->
                val itemObject = item as? ObjectNode
                if (itemObject == null) {
                    errors += "params.grind.perGrinder[$index] must be an object"
                    return@forEachIndexed
                }
                val prefix = "params.grind.perGrinder[$index]"
                val grinder = itemObject.get("grinder")
                if (grinder == null || !grinder.isTextual || grinder.asText().trim().isEmpty()) {
                    errors += "$prefix.grinder must be a non-empty string"
                    return@forEachIndexed
                }
                val clicks = itemObject.get("clicks")
                if (clicks == null || (!clicks.isNumber && !clicks.isTextual)) {
                    errors += "$prefix.clicks must be a number or string"
                    return@forEachIndexed
                }
                val source = itemObject.get("source")
                if (source == null || !source.isTextual || source.asText() !in listOf("measured", "dial-in-start")) {
                    errors += "$prefix.source must be 'measured' or 'dial-in-start'"
                    return@forEachIndexed
                }
                val entry = objectNode()
                entry.set("grinder", grinder!!)
                entry.set("clicks", clicks!!)
                entry.set("source", source!!)
                itemObject.get("grinderId")?.takeIf { it.isTextual }?.let { entry.set("grinderId", it) }
                itemObject.get("stepless")?.takeIf { it.isBoolean }?.let { entry.set("stepless", it) }
                if (itemObject.get("stepless")?.isBoolean == true && itemObject.get("stepless")!!.booleanValue() && !clicks.isTextual) {
                    errors += "$prefix.clicks must be a string for a stepless grinder"
                }
                entries.add(entry)
            }
            if (entries.size() > 0) out.set("perGrinder", entries)
        }
    }
    if (raw.has("legacyText")) {
        val value = raw.get("legacyText")
        if (value == null || !value.isTextual) errors += "params.grind.legacyText must be a string"
        else out.set("legacyText", value!!)
    }
    return out
}

private fun validateDripperPortability(raw: ObjectNode, errors: MutableList<String>): ObjectNode? {
    val origin = raw.get("origin") as? ObjectNode
    if (origin == null || origin.get("dripper")?.isTextual != true || origin.get("dripper")!!.asText().trim().isEmpty()) {
        errors += "dripperPortability.origin.dripper is required"
        return null
    }
    val out = objectNode()
    val originOut = objectNode()
    originOut.set("dripper", origin.get("dripper")!!)
    origin.get("dripperId")?.takeIf { it.isTextual }?.let { originOut.set("dripperId", it) }
    origin.get("sizeModel")?.takeIf { it.isTextual }?.let { originOut.set("sizeModel", it) }
    out.set("origin", originOut)
    val anchorsOut = objectNode()
    if (raw.has("anchors")) {
        val anchors = raw.get("anchors") as? ObjectNode
        if (anchors == null) {
            errors += "dripperPortability.anchors must be an object"
        } else {
            anchors.get("ratio")?.takeIf { it.isTextual }?.let { anchorsOut.set("ratio", it) }
            anchors.get("tempC")?.takeIf { it.isNumber }?.let { anchorsOut.set("tempC", it) }
            anchors.get("targetDrawdownSec")?.takeIf { it.isNumber }
                ?.let { anchorsOut.set("targetDrawdownSec", it) }
        }
    }
    out.set("anchors", anchorsOut)
    if (raw.has("classNote")) {
        val value = raw.get("classNote")
        if (value == null || !value.isTextual) errors += "dripperPortability.classNote must be a string"
        else out.set("classNote", value)
    }
    if (raw.has("targets")) {
        val targets = raw.get("targets") as? ArrayNode
        if (targets == null) {
            errors += "dripperPortability.targets must be an array"
        } else if (targets.size() > 30) {
            errors += "dripperPortability.targets must have at most 30 entries"
        } else {
            val targetOut = arrayNode()
            targets.forEachIndexed { index, target ->
                val prefix = "dripperPortability.targets[$index]"
                val targetObject = target as? ObjectNode
                if (targetObject == null) {
                    errors += "$prefix must be an object"
                    return@forEachIndexed
                }
                val dripper = targetObject.get("dripper")
                if (dripper == null || !dripper.isTextual || dripper.asText().trim().isEmpty()) {
                    errors += "$prefix.dripper must be a non-empty string"
                    return@forEachIndexed
                }
                val clazz = targetObject.get("class")
                if (clazz == null || !clazz.isTextual || clazz.asText() !in DRIPPER_CLASSES) {
                    errors += "$prefix.class must be one of ${DRIPPER_CLASSES.joinToString(", ")}"
                    return@forEachIndexed
                }
                val sizeMatch = targetObject.get("sizeMatch")
                if (sizeMatch == null || !sizeMatch.isTextual || sizeMatch.asText() !in SIZE_MATCHES) {
                    errors += "$prefix.sizeMatch must be one of ${SIZE_MATCHES.joinToString(", ")}"
                    return@forEachIndexed
                }
                val grindShift = targetObject.get("grindShift")
                if (grindShift == null || !grindShift.isTextual || grindShift.asText() !in GRIND_SHIFTS) {
                    errors += "$prefix.grindShift must be one of ${GRIND_SHIFTS.joinToString(", ")}"
                    return@forEachIndexed
                }
                val pourShift = targetObject.get("pourShift")
                if (pourShift == null || !pourShift.isTextual || pourShift.asText() !in POUR_SHIFTS) {
                    errors += "$prefix.pourShift must be one of ${POUR_SHIFTS.joinToString(", ")}"
                    return@forEachIndexed
                }
                val confidence = targetObject.get("confidence")
                if (confidence == null || !confidence.isTextual || confidence.asText() !in CONFIDENCES) {
                    errors += "$prefix.confidence must be one of ${CONFIDENCES.joinToString(", ")}"
                    return@forEachIndexed
                }
                val entry = objectNode()
                entry.set("dripper", dripper!!)
                entry.set("class", clazz!!)
                entry.set("sizeMatch", sizeMatch!!)
                entry.set("grindShift", grindShift!!)
                entry.set("pourShift", pourShift!!)
                entry.set("confidence", confidence!!)
                targetObject.get("dripperId")?.takeIf { it.isTextual }?.let { entry.set("dripperId", it) }
                targetObject.get("bedDepthShift")?.takeIf { it.isTextual && it.asText() in BED_DEPTH_SHIFTS }
                    ?.let { entry.set("bedDepthShift", it) }
                targetObject.get("bedOverflow")?.takeIf { it.isBoolean }?.let { entry.set("bedOverflow", it) }
                if (targetObject.has("warn")) {
                    val warn = targetObject.get("warn")
                    if (warn == null || !warn.isTextual) errors += "$prefix.warn must be a string"
                    else if (warn.asText().length > 280) errors += "$prefix.warn must be at most 280 characters"
                    else entry.set("warn", warn)
                }
                targetObject.get("note")?.takeIf { it.isTextual }?.let { entry.set("note", it) }
                targetOut.add(entry)
            }
            if (targetOut.size() > 0) out.set("targets", targetOut)
        }
    }
    return out
}

private fun validateRecipeSteps(input: ObjectNode, errors: MutableList<String>): ArrayNode? {
    if (!input.has("steps")) return null
    val raw = input.get("steps") as? ArrayNode
    if (raw == null) {
        errors += "steps must be an array"
        return null
    }
    val out = arrayNode()
    raw.forEachIndexed { index, step ->
        val stepObject = step as? ObjectNode
        if (stepObject == null) {
            errors += "steps[$index] must be an object"
            return@forEachIndexed
        }
        val note = stepObject.get("note")
        if (note == null || !note.isTextual || note.asText().trim().isEmpty()) {
            errors += "steps[$index].note must be a non-empty string"
            return@forEachIndexed
        }
        val built = objectNode()
        built.set("note", note!!)
        if (stepObject.has("atSec")) {
            val value = stepObject.get("atSec")
            if (!isFiniteNumber(value)) errors += "steps[$index].atSec must be a finite number"
            else built.set("atSec", value!!)
        }
        if (stepObject.has("waterG")) {
            val value = stepObject.get("waterG")
            if (!isFiniteNumber(value)) errors += "steps[$index].waterG must be a finite number"
            else built.set("waterG", value!!)
        }
        if (stepObject.has("endSec")) {
            val value = stepObject.get("endSec")
            if (!isFiniteNumber(value) || value!!.asDouble() < 0) {
                errors += "steps[$index].endSec must be a non-negative finite number"
            } else if (isFiniteNumber(stepObject.get("atSec")) && value.asDouble() <= stepObject.get("atSec")!!.asDouble()) {
                errors += "steps[$index].endSec must be greater than atSec"
            } else {
                built.set("endSec", value)
            }
        }
        if (stepObject.has("pourRateGPerSec")) {
            val value = stepObject.get("pourRateGPerSec")
            if (!isFiniteNumber(value) || value!!.asDouble() <= 0) {
                errors += "steps[$index].pourRateGPerSec must be a positive finite number"
            } else {
                built.set("pourRateGPerSec", value)
            }
        }
        out.add(built)
    }
    return out
}

private class TimedStep(val atSec: Double, val endSec: Double?, val waterG: Double?)

private fun validateRecipeCrossFields(
    value: CreateRecipeInput,
    errors: MutableList<String>,
    warnings: MutableList<String>
) {
    if (value.method == "other") return
    val params = value.params
    val doseG = params?.get("doseG")?.takeIf(::isFiniteNumber)?.asDouble()
    val waterG = params?.get("waterG")?.takeIf(::isFiniteNumber)?.asDouble()
    val tempC = params?.get("tempC")?.takeIf(::isFiniteNumber)?.asDouble()
    val ratio = params?.get("ratio")?.takeIf { it.isTextual }?.asText()
    val targetTimeSec = params?.get("targetTimeSec")?.takeIf(::isFiniteNumber)?.asDouble()
    val isPourOver = value.method in POUR_OVER_METHODS

    if (doseG != null && doseG <= 0) errors += "params.doseG must be greater than 0"
    if (waterG != null && waterG <= 0) errors += "params.waterG must be greater than 0"
    if (tempC != null) {
        if (tempC <= 0 || tempC > 100) errors += "params.tempC must be between 0 and 100"
        else if (tempC < 80) warnings += "params.tempC ${jsNumber(tempC)}°C is unusually low for hot brewing"
    }
    if (targetTimeSec != null && targetTimeSec <= 0) errors += "params.targetTimeSec must be greater than 0"

    if (ratio != null && doseG != null && doseG != 0.0 && waterG != null && waterG != 0.0) {
        Regex("^\\s*1\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*$").matchEntire(ratio)?.let { match ->
            val declared = match.groupValues[1].toDoubleOrNull()
            val actual = waterG / doseG
            if (declared != null && declared.isFinite() && abs(declared - actual) > 0.3) {
                warnings += "ratio $ratio disagrees with waterG/doseG (≈1:${String.format(Locale.ROOT, "%.1f", actual)})"
            }
        }
    }

    val timedValues = mutableListOf<TimedStep>()
    value.steps?.forEach { step ->
        step.get("atSec")?.takeIf(::isFiniteNumber)?.let { atSec ->
            timedValues += TimedStep(
                atSec = atSec.asDouble(),
                endSec = step.get("endSec")?.takeIf(::isFiniteNumber)?.asDouble(),
                waterG = step.get("waterG")?.takeIf(::isFiniteNumber)?.asDouble()
            )
        }
    }
    val timed = timedValues.sortedBy { it.atSec }
    for (index in 1 until timed.size) {
        val previous = timed[index - 1]
        val current = timed[index]
        if (previous.endSec != null && current.atSec < previous.endSec) {
            errors += "steps overlap: a step starts at ${jsNumber(current.atSec)}s before the previous step ends (${jsNumber(previous.endSec)}s)"
        }
    }
    if (timed.any { it.endSec == null }) warnings += "a timed step has no endSec; pour timing cannot be fully verified"

    if (isPourOver) {
        val weighted = timed.filter { it.waterG != null }
        for (index in 1 until weighted.size) {
            if (weighted[index].waterG!! < weighted[index - 1].waterG!!) {
                errors += "cumulative step waterG decreases (${jsNumber(weighted[index - 1].waterG!!)}g → ${jsNumber(weighted[index].waterG!!)}g)"
            }
        }
        if (waterG != null) {
            weighted.forEach { step ->
                if (step.waterG!! > waterG) errors += "a step waterG (${jsNumber(step.waterG)}g) exceeds total params.waterG (${jsNumber(waterG)}g)"
            }
            weighted.lastOrNull()?.waterG?.let { finalG ->
                if (abs(finalG - waterG) > 1) {
                    warnings += "final step waterG (${jsNumber(finalG)}g) does not reach params.waterG (${jsNumber(waterG)}g)"
                }
            }
        }
    }
    if (targetTimeSec != null && timed.isNotEmpty()) {
        val lastEnd = timed.maxOf { it.endSec ?: it.atSec }
        if (targetTimeSec < lastEnd) {
            errors += "params.targetTimeSec (${jsNumber(targetTimeSec)}s) is before the last pour ends (${jsNumber(lastEnd)}s)"
        } else if (targetTimeSec - lastEnd > 75) {
            warnings += "unrealistic drawdown: targetTimeSec (${jsNumber(targetTimeSec)}s) is ${jsNumber(targetTimeSec - lastEnd)}s after the last pour ends"
        }
        if (isPourOver && (targetTimeSec < 60 || targetTimeSec > 600)) {
            warnings += "params.targetTimeSec (${jsNumber(targetTimeSec)}s) is outside the typical 60–600s range"
        }
    }
}

private fun pickString(source: ObjectNode, key: String, errors: MutableList<String>, path: String): String? {
    if (!source.has(key)) return null
    val value = source.get(key)
    if (value == null || !value.isTextual) {
        errors += "$path.$key must be a string"
        return null
    }
    return value.asText().trim()
}

private fun isPlainObject(value: JsonNode?): Boolean = value != null && value.isObject

private fun isStringArray(value: JsonNode?): Boolean = value != null && value.isArray && value.all { it.isTextual }

private fun jsonStrings(value: JsonNode): List<String> {
    return value.values().map { it.asText() }
}

private fun isInt(value: JsonNode?): Boolean = value != null && value.isNumber && value.asDouble().isFinite() && value.asDouble() % 1.0 == 0.0

private fun isFiniteNumber(value: JsonNode?): Boolean = value != null && value.isNumber && value.asDouble().isFinite()

private fun objectNode(): ObjectNode = JsonNodeFactory.instance.objectNode()

private fun arrayNode(): ArrayNode = JsonNodeFactory.instance.arrayNode()

private fun jsNumber(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

private fun <T> valid(value: T, warnings: List<String> = emptyList()): ValidationResult<T> =
    ValidationResult(ok = true, value = value, warnings = warnings)

private fun <T> invalid(vararg errors: String): ValidationResult<T> = invalid(errors.toList())

private fun <T> invalid(errors: List<String>): ValidationResult<T> = ValidationResult(ok = false, errors = errors)
