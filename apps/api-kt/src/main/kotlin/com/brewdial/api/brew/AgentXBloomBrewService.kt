package com.brewdial.api.brew

import com.brewdial.api.recipe.Recipe
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.node.ObjectNode
import java.time.Instant

@Service
class AgentXBloomBrewService(
    private val entityManager: EntityManager,
    private val objectMapper: ObjectMapper
) {
    @Transactional
    fun ingest(input: List<ObjectNode>): LinkedHashMap<String, List<String>> {
        val inserted = mutableListOf<String>()
        val duplicate = mutableListOf<String>()
        for (brew in input) {
            val id = brew.path("xbloomBrewId").asText()
            if (entityManager.find(XBloomBrew::class.java, id) != null) {
                duplicate += id
                continue
            }
            val metrics = deriveMetrics(brew.path("curve"))
            val entity = XBloomBrew().apply {
                xbloomBrewId = id
                brewedAt = Instant.parse(brew.path("brewedAt").asText())
                brewTimeSec = brew.path("brewTimeSec").asDouble()
                recipeName = brew.path("recipeName").asText()
                xbloomRecipeId = brew.get("xbloomRecipeId")?.takeUnless { it.isNull }?.asText()
                totalWaterMl = metrics.totalWaterMl
                finalCupG = metrics.finalCupG
                retentionG = metrics.retentionG
                pourEndSec = metrics.pourEndSec
                cupAtPourEndG = metrics.cupAtPourEndG
                drawdownSec = metrics.drawdownSec
                earlyDrawdownGPerSec = metrics.earlyDrawdownGPerSec
                recipeSnapshot = objectMapper.writeValueAsString(brew.path("recipeSnapshot"))
                curve = objectMapper.writeValueAsString(brew.path("curve"))
            }
            entityManager.persist(entity)
            entityManager.flush()
            inserted += id
        }
        return linkedMapOf("inserted" to inserted, "duplicate" to duplicate)
    }

    @Transactional(readOnly = true)
    fun list(limit: Int, recipeCode: String?, xbloomRecipeId: String?, since: Instant?): List<LinkedHashMap<String, Any?>> {
        val conditions = mutableListOf<String>()
        val parameters = linkedMapOf<String, Any>()
        if (xbloomRecipeId != null) {
            conditions += "brew.xbloomRecipeId = :xbloomRecipeId"
            parameters["xbloomRecipeId"] = xbloomRecipeId
        }
        if (since != null) {
            conditions += "brew.brewedAt >= :since"
            parameters["since"] = since
        }
        if (recipeCode != null) {
            val recipeIds = entityManager.createQuery(
                "select link.xbloomRecipeId from XBloomRecipeLink link where link.recipeCode = :recipeCode", String::class.java
            ).setParameter("recipeCode", recipeCode).resultList
            if (recipeIds.isEmpty()) return emptyList()
            conditions += "brew.xbloomRecipeId in :recipeIds"
            parameters["recipeIds"] = recipeIds
        }
        val where = if (conditions.isEmpty()) "" else " where ${conditions.joinToString(" and ")}" 
        val query = entityManager.createQuery("select brew from XBloomBrew brew$where order by brew.brewedAt desc", XBloomBrew::class.java)
        parameters.forEach { (key, value) -> query.setParameter(key, value) }
        query.maxResults = limit
        return query.resultList.map { toBrewMap(it, includeCurve = false) }
    }

    @Transactional(readOnly = true)
    fun detail(id: String): LinkedHashMap<String, Any?>? {
        val brew = entityManager.find(XBloomBrew::class.java, id) ?: return null
        val result = toBrewMap(brew, includeCurve = true)
        val link = brew.xbloomRecipeId?.let { entityManager.find(XBloomRecipeLink::class.java, it) }
        val recipe = link?.let { recipeByCode(it.recipeCode) }
        result["linkedRecipe"] = if (link != null && recipe != null) linkedMapOf(
            "recipeCode" to link.recipeCode, "title" to recipe.title, "currentVersion" to recipe.version
        ) else null
        val baseline = if (brew.xbloomRecipeId == null) emptyList() else entityManager.createQuery(
            "select prior from XBloomBrew prior where prior.xbloomRecipeId = :recipeId and prior.brewedAt < :brewedAt order by prior.brewedAt desc",
            XBloomBrew::class.java
        ).setParameter("recipeId", brew.xbloomRecipeId).setParameter("brewedAt", brew.brewedAt).setMaxResults(10).resultList
        result["anomalyHint"] = anomalyHint(brew, baseline)
        return result
    }

    @Transactional
    fun link(xbloomRecipeId: String, recipeCode: String): Boolean {
        if (recipeByCode(recipeCode) == null) return false
        val existing = entityManager.find(XBloomRecipeLink::class.java, xbloomRecipeId)
        if (existing == null) {
            entityManager.persist(XBloomRecipeLink().apply {
                this.xbloomRecipeId = xbloomRecipeId
                this.recipeCode = recipeCode
            })
        } else {
            existing.recipeCode = recipeCode
            existing.updatedAt = Instant.now()
        }
        entityManager.flush()
        return true
    }

    @Transactional(readOnly = true)
    fun links(): List<LinkedHashMap<String, Any?>> = entityManager.createQuery(
        "select link from XBloomRecipeLink link order by link.xbloomRecipeId", XBloomRecipeLink::class.java
    ).resultList.mapNotNull { link ->
        val recipe = recipeByCode(link.recipeCode) ?: return@mapNotNull null
        linkedMapOf(
            "xbloomRecipeId" to link.xbloomRecipeId,
            "recipeCode" to link.recipeCode,
            "recipeTitle" to recipe.title,
            "createdAt" to link.createdAt?.toString(),
            "updatedAt" to link.updatedAt?.toString()
        )
    }

    private fun recipeByCode(code: String): Recipe? = entityManager.createQuery(
        "select recipe from Recipe recipe where recipe.code = :code", Recipe::class.java
    ).setParameter("code", code).resultList.firstOrNull()

    private fun toBrewMap(brew: XBloomBrew, includeCurve: Boolean): LinkedHashMap<String, Any?> {
        val link = brew.xbloomRecipeId?.let { entityManager.find(XBloomRecipeLink::class.java, it) }
        val recipe = link?.let { recipeByCode(it.recipeCode) }
        return linkedMapOf(
            "xbloomBrewId" to brew.xbloomBrewId,
            "brewedAt" to brew.brewedAt.toString().let { if (it.endsWith("Z") && !it.contains('.')) it.dropLast(1) + ".000Z" else it },
            "brewTimeSec" to brew.brewTimeSec,
            "recipeName" to brew.recipeName,
            "xbloomRecipeId" to brew.xbloomRecipeId,
            "totalWaterMl" to brew.totalWaterMl,
            "finalCupG" to brew.finalCupG,
            "retentionG" to brew.retentionG,
            "pourEndSec" to brew.pourEndSec,
            "cupAtPourEndG" to brew.cupAtPourEndG,
            "drawdownSec" to brew.drawdownSec,
            "earlyDrawdownGPerSec" to brew.earlyDrawdownGPerSec,
            "recipeSnapshot" to objectMapper.readTree(brew.recipeSnapshot),
            "recipeCode" to link?.recipeCode,
            "recipeTitle" to recipe?.title,
            "recipeVersion" to recipe?.version
        ).apply {
            if (includeCurve) put("curve", objectMapper.readTree(brew.curve))
        }
    }

    private data class Metrics(
        val totalWaterMl: Double,
        val finalCupG: Double,
        val retentionG: Double,
        val pourEndSec: Int,
        val cupAtPourEndG: Double,
        val drawdownSec: Int,
        val earlyDrawdownGPerSec: Double
    )

    private fun deriveMetrics(curve: JsonNode): Metrics {
        val points = (0 until curve.size()).map { index -> curve[index] }
        val last = points.last()
        val water = last[0].asDouble()
        val cup = last[1].asDouble()
        val pourEnd = points.indexOfFirst { it[0].asDouble() >= water }.coerceAtLeast(0)
        val cupAtPourEnd = points[pourEnd][1].asDouble()
        val targetIndex = points.indexOfFirstIndexed { index, point -> index >= pourEnd && point[1].asDouble() >= cup * 0.98 }
            .let { if (it < 0) points.lastIndex else it }
        val earlyEnd = minOf(points.lastIndex, pourEnd + 10)
        val earlyRate = if (earlyEnd == pourEnd) 0.0 else (points[earlyEnd][1].asDouble() - cupAtPourEnd) / (earlyEnd - pourEnd)
        return Metrics(water, cup, water - cup, pourEnd, cupAtPourEnd, targetIndex - pourEnd, earlyRate)
    }

    private fun anomalyHint(current: XBloomBrew, baseline: List<XBloomBrew>): LinkedHashMap<String, Any?> {
        if (baseline.size < 3) return linkedMapOf("status" to "insufficient_baseline", "baselineCount" to baseline.size)
        val metrics = listOf(
            Triple("brewTimeSec", current.brewTimeSec, 5.0) to baseline.map { it.brewTimeSec },
            Triple("drawdownSec", current.drawdownSec.toDouble(), 5.0) to baseline.map { it.drawdownSec.toDouble() },
            Triple("finalCupG", current.finalCupG, 3.0) to baseline.map { it.finalCupG },
            Triple("cupAtPourEndG", current.cupAtPourEndG, 2.0) to baseline.map { it.cupAtPourEndG },
            Triple("earlyDrawdownGPerSec", current.earlyDrawdownGPerSec, 0.1) to baseline.map { it.earlyDrawdownGPerSec }
        ).map { (spec, values) ->
            val median = median(values)
            val mad = median(values.map { kotlin.math.abs(it - median) })
            val delta = spec.second - median
            linkedMapOf(
                "metric" to spec.first,
                "baselineMedian" to median,
                "value" to spec.second,
                "delta" to delta,
                "threshold" to maxOf(3 * mad, spec.third),
                "flagged" to (kotlin.math.abs(delta) > maxOf(3 * mad, spec.third))
            )
        }
        val unusual = metrics.any { it["flagged"] == true }
        return linkedMapOf(
            "status" to if (unusual) "unusual" else "normal",
            "baselineCount" to baseline.size,
            "metrics" to metrics,
            "advisory" to true,
            "note" to "클라우드 1 Hz 곡선만으로는 필터가 밀린 경우 같은 원인을 구분하기 어렵습니다. unusual 표시는 판정이 아니라 운영자에게 확인할 단서입니다."
        )
    }

    private fun median(values: List<Double>): Double {
        val sorted = values.sorted()
        val middle = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[middle] else (sorted[middle - 1] + sorted[middle]) / 2
    }
}

private fun List<JsonNode>.indexOfFirstIndexed(predicate: (Int, JsonNode) -> Boolean): Int {
    forEachIndexed { index, node -> if (predicate(index, node)) return index }
    return -1
}
