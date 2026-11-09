package com.brewdial.api.brew

import tools.jackson.databind.JsonNode

internal fun validateXBloomBrew(input: JsonNode): List<String> {
    val errors = mutableListOf<String>()
    val brewKeys = setOf("xbloomBrewId", "brewedAt", "brewTimeSec", "recipeName", "xbloomRecipeId", "recipeSnapshot", "curve")
    if (!input.isObject) return listOf("brew must be an object")
    input.propertyNames().forEach { if (it !in brewKeys) errors += "brew.$it is not allowed" }
    val id = input.get("xbloomBrewId")
    if (id == null || !id.isTextual || !id.asText().matches(Regex("\\d{1,32}"))) errors += "xbloomBrewId must be a decimal string of at most 32 digits"
    val brewedAt = input.get("brewedAt")
    if (brewedAt == null || !brewedAt.isTextual || !ISO_MILLIS.matches(brewedAt.asText()) || runCatching { java.time.Instant.parse(brewedAt.asText()) }.isFailure) {
        errors += "brewedAt must be a supported ISO timestamp"
    }
    if (!positiveNumber(input.get("brewTimeSec"))) errors += "brewTimeSec must be a positive finite number"
    val recipeName = input.get("recipeName")
    if (recipeName == null || !recipeName.isTextual) errors += "recipeName must be a string"
    else {
        if (recipeName.asText().any { it.code < 32 || it.code == 127 }) errors += "recipeName must not contain control characters"
        if (recipeName.asText().toByteArray(Charsets.UTF_8).size > 65535) errors += "recipeName must fit in a MySQL TEXT column"
    }
    val recipeId = input.get("xbloomRecipeId")
    if (recipeId == null || (!recipeId.isNull && (!recipeId.isTextual || !recipeId.asText().matches(Regex("\\d{1,32}"))))) {
        errors += "xbloomRecipeId must be a decimal string of at most 32 digits or null"
    }

    val snapshot = input.get("recipeSnapshot")
    val snapshotKeys = setOf("doseG", "grinderSize", "rpm", "cupType", "bypassEnabled", "bypassVolumeMl", "bypassTemperatureC", "pours")
    if (snapshot == null || !snapshot.isObject) errors += "recipeSnapshot must be an object"
    else {
        snapshot.propertyNames().forEach { if (it !in snapshotKeys) errors += "recipeSnapshot.$it is not allowed" }
        for (key in listOf("doseG", "grinderSize", "rpm", "cupType", "bypassVolumeMl", "bypassTemperatureC")) {
            if (!nonNegativeNumber(snapshot.get(key))) errors += "recipeSnapshot.$key must be a finite non-negative number"
        }
        if (snapshot.get("bypassEnabled")?.isBoolean != true) errors += "recipeSnapshot.bypassEnabled must be a boolean"
        val pours = snapshot.get("pours")
        if (pours == null || !pours.isArray) errors += "recipeSnapshot.pours must be an array"
        else pours.forEachIndexed { index, pour ->
            val pourKeys = setOf("volumeMl", "temperatureC", "flowRate", "pattern", "pauseSec", "vibrationBefore", "vibrationAfter")
            if (!pour.isObject) errors += "recipeSnapshot.pours[$index] must be an object"
            else {
                pour.propertyNames().forEach { if (it !in pourKeys) errors += "recipeSnapshot.pours[$index].$it is not allowed" }
                for (key in listOf("volumeMl", "temperatureC", "flowRate", "pauseSec")) {
                    if (!nonNegativeNumber(pour.get(key))) errors += "recipeSnapshot.pours[$index].$key must be a finite non-negative number"
                }
                if (pour.get("pattern")?.takeIf { it.isTextual }?.asText() !in setOf("spiral", "ring", "center")) {
                    errors += "recipeSnapshot.pours[$index].pattern must be spiral, ring, or center"
                }
                if (pour.get("vibrationBefore")?.isBoolean != true) errors += "recipeSnapshot.pours[$index].vibrationBefore must be a boolean"
                if (pour.get("vibrationAfter")?.isBoolean != true) errors += "recipeSnapshot.pours[$index].vibrationAfter must be a boolean"
            }
        }
    }
    val curve = input.get("curve")
    if (curve == null || !curve.isArray) errors += "curve must be an array"
    else {
        if (curve.size() == 0) errors += "curve must not be empty"
        if (curve.size() > 1200) errors += "curve must contain at most 1200 points"
        curve.forEachIndexed { index, point ->
            if (!point.isArray || point.size() != 2 || !nonNegativeNumber(point.get(0)) || !nonNegativeNumber(point.get(1))) {
                errors += "curve[$index] must be two finite non-negative numbers"
            }
        }
    }
    return errors
}

private fun positiveNumber(value: JsonNode?): Boolean = value != null && value.isNumber && value.asDouble().isFinite() && value.asDouble() > 0
private fun nonNegativeNumber(value: JsonNode?): Boolean = value != null && value.isNumber && value.asDouble().isFinite() && value.asDouble() >= 0
private val ISO_MILLIS = Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")
