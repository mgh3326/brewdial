package com.brewdial.api.recommend

class BeanAttributes(
    val roastLevelOrd: Int? = null,
    val agtronMin: Int? = null,
    val agtronMax: Int? = null,
    val acidity: Int? = null,
    val body: Int? = null,
    val decaf: Boolean? = null,
    val flavorCategories: List<String>? = null,
    val attrsSource: String? = null
)

class TasteSignals(
    val savedBeanAttrs: List<BeanAttributes>,
    val ratedBeanAttrs: List<BeanAttributes>,
    val likes: List<String>,
    val dislikes: List<String>
)

class TasteTarget(
    val acidity: Double? = null,
    val body: Double? = null,
    val roast: Double? = null,
    val flavorAffinity: List<String>,
    val penalize: List<String>,
    val confidence: String,
    val summary: String,
    val evidence: List<String>
)

class BeanScore(
    val band: String,
    val score: Double,
    val axes: List<LinkedHashMap<String, Any>>,
    val why: String
)

private class WeightedAttribute(val attributes: BeanAttributes, val weight: Int)

private class WeightedValue(val value: Double, val weight: Int)

private class AxisFit(val key: String, val fit: Double)

private val axisWeight = linkedMapOf(
    "acidity" to 0.4,
    "roast" to 0.25,
    "body" to 0.2,
    "flavor" to 0.15
)

fun deriveTasteTarget(signals: TasteSignals): TasteTarget {
    val weighted = buildList {
        signals.savedBeanAttrs.forEach { add(WeightedAttribute(it, 2)) }
        signals.ratedBeanAttrs.forEach { add(WeightedAttribute(it, 1)) }
    }

    fun axis(pick: (BeanAttributes) -> Int?): Double? = weightedMean(
        weighted.mapNotNull { weightedAttribute ->
            weightedAttribute.attributes.let(pick)?.let { value ->
                WeightedValue(value.toDouble(), weightedAttribute.weight)
            }
        }
    )

    var acidity = axis { it.acidity }
    var body = axis { it.body }
    var roast = axis { it.roastLevelOrd }

    val flavorCount = LinkedHashMap<String, Int>()
    weighted.forEach { weightedAttribute ->
        weightedAttribute.attributes.flavorCategories.orEmpty().forEach { flavor ->
            flavorCount[flavor] = (flavorCount[flavor] ?: 0) + 1
        }
    }
    val flavorAffinity = flavorCount.entries.withIndex()
        .sortedWith(
            compareByDescending<IndexedValue<Map.Entry<String, Int>>> { it.value.value }
                .thenBy { it.index }
        )
        .map { it.value.key }
        .toMutableList()

    val likes = LinkedHashSet(signals.likes)
    val dislikes = LinkedHashSet(signals.dislikes)
    val penalize = mutableListOf<String>()

    fun addAffinity(flavor: String) {
        if (flavor !in flavorAffinity) flavorAffinity.add(flavor)
    }

    if ("저산미" in likes) acidity = minOf(acidity ?: 2.0, 2.0)
    if ("다크 로스팅" in likes) roast = maxOf(roast ?: 4.0, 4.0)
    if ("고소함" in likes) addAffinity("nutty_cocoa")
    if ("초콜릿/단맛" in likes) {
        addAffinity("sweet")
        addAffinity("nutty_cocoa")
    }
    if ("고산미" in dislikes) penalize.add("highAcidity")
    if ("라이트 로스팅" in dislikes) penalize.add("lightRoast")

    if (acidity != null) acidity = jsRound(acidity).toDouble()
    if (body != null) body = jsRound(body).toDouble()
    if (roast != null) roast = jsRound(roast).toDouble()

    val signalCount = signals.savedBeanAttrs.size + signals.ratedBeanAttrs.size
    val hasTags = likes.size + dislikes.size > 0
    val confidence = when {
        signalCount >= 5 -> "high"
        signalCount >= 2 -> "medium"
        signalCount >= 1 || hasTags -> "low"
        else -> "none"
    }
    if (signalCount == 0 && !hasTags) {
        return TasteTarget(
            flavorAffinity = emptyList(),
            penalize = emptyList(),
            confidence = "none",
            summary = "",
            evidence = emptyList()
        )
    }

    val parts = mutableListOf<String>()
    if (acidity != null) {
        parts.add(if (acidity <= 2) "저산미" else if (acidity >= 4) "고산미" else "중간 산미")
    }
    if (body != null) {
        parts.add(if (body >= 4) "풀바디" else if (body <= 2) "가벼운 바디" else "미디엄 바디")
    }
    if (roast != null) {
        parts.add(if (roast >= 4) "다크 로스팅" else if (roast <= 2) "라이트 로스팅" else "미디엄 로스팅")
    }
    val flavorLabel = flavorAffinity.take(2).joinToString("·") { flavorKo(it) }
    if (flavorLabel.isNotEmpty()) parts.add(flavorLabel)

    val evidence = mutableListOf<String>()
    if (signalCount > 0) evidence.add("저장·고평점 원두 ${signalCount}종의 공통 프로필")
    if (hasTags) evidence.add("명시 취향: ${likes.joinToString("·")}")

    return TasteTarget(
        acidity = acidity,
        body = body,
        roast = roast,
        flavorAffinity = flavorAffinity,
        penalize = penalize,
        confidence = confidence,
        summary = parts.joinToString(" · "),
        evidence = evidence
    )
}

fun scoreBean(attributes: BeanAttributes, target: TasteTarget): BeanScore {
    val hasData = attributes.acidity != null || attributes.body != null || attributes.roastLevelOrd != null ||
        !attributes.flavorCategories.isNullOrEmpty()
    if (!hasData) return BeanScore("unknown", 0.0, emptyList(), "속성 정보가 없어요")

    val targetAcidity = target.acidity?.let { jsRound(it).toInt() }
    val targetRoast = target.roast?.let { jsRound(it).toInt() }
    val targetBody = target.body?.let { jsRound(it).toInt() }
    val axes = mutableListOf<LinkedHashMap<String, Any>>()
    val fits = mutableListOf<AxisFit>()

    if (attributes.acidity != null && targetAcidity != null) {
        var fit = closeness(attributes.acidity, targetAcidity)
        if ("highAcidity" in target.penalize && attributes.acidity >= 4) fit *= 0.3
        fits.add(AxisFit("acidity", fit))
        axes.add(axis("acidity", "산미", attributes.acidity, targetAcidity, direction(attributes.acidity, targetAcidity)))
    } else {
        axes.add(axis("acidity", "산미", attributes.acidity ?: "—", null, "na"))
    }

    if (attributes.roastLevelOrd != null && targetRoast != null) {
        var fit = closeness(attributes.roastLevelOrd, targetRoast)
        if ("lightRoast" in target.penalize && attributes.roastLevelOrd <= 2) fit *= 0.4
        fits.add(AxisFit("roast", fit))
        axes.add(axis("roast", "로스팅", attributes.roastLevelOrd, targetRoast, direction(attributes.roastLevelOrd, targetRoast)))
    } else {
        axes.add(axis("roast", "로스팅", attributes.roastLevelOrd ?: "—", null, "na"))
    }

    if (attributes.body != null && targetBody != null) {
        fits.add(AxisFit("body", closeness(attributes.body, targetBody)))
        axes.add(axis("body", "무게감", attributes.body, targetBody, direction(attributes.body, targetBody)))
    } else {
        axes.add(axis("body", "무게감", attributes.body ?: "—", null, "na"))
    }

    val beanFlavors = attributes.flavorCategories.orEmpty()
    if (beanFlavors.isNotEmpty() && target.flavorAffinity.isNotEmpty()) {
        val overlap = beanFlavors.count { it in target.flavorAffinity }
        val fit = overlap.toDouble() / minOf(beanFlavors.size, target.flavorAffinity.size)
        fits.add(AxisFit("flavor", fit))
        axes.add(axis("flavor", "향미", beanFlavors.joinToString("·") { flavorKo(it) }, null, if (overlap > 0) "hit" else "miss"))
    } else {
        axes.add(axis("flavor", "향미", beanFlavors.joinToString("·") { flavorKo(it) }.ifEmpty { "—" }, null, "na"))
    }

    val weightSum = fits.sumOf { axisWeight.getValue(it.key) }
    val score = if (weightSum == 0.0) 0.0 else fits.sumOf { it.fit * axisWeight.getValue(it.key) } / weightSum
    val band = when {
        fits.isEmpty() -> "unknown"
        score >= 0.7 -> "great"
        score >= 0.4 -> "ok"
        else -> "adventure"
    }
    val hits = axes.filter { it["match"] == "hit" }.map { it.getValue("label") as String }
    val why = when (band) {
        "great" -> "${hits.take(3).joinToString("·")}이(가) 취향과 일치"
        "ok" -> "일부 축이 취향과 맞아요"
        "adventure" -> "취향과 꽤 달라요 — 모험"
        else -> "속성 정보가 없어요"
    }

    return BeanScore(band, score, axes, why)
}

private fun weightedMean(values: List<WeightedValue>): Double? {
    val finite = values.filter { it.value.isFinite() }
    if (finite.isEmpty()) return null
    val weightSum = finite.sumOf { it.weight }
    return finite.sumOf { it.value * it.weight } / weightSum
}

private fun jsRound(value: Double): Long = Math.round(value)

private fun closeness(value: Int, target: Int, span: Int = 4): Double =
    maxOf(0.0, 1 - kotlin.math.abs(value - target).toDouble() / span)

private fun direction(value: Int, target: Int): String {
    val distance = kotlin.math.abs(value - target)
    return if (distance <= 1) "hit" else if (distance <= 2) "near" else "miss"
}

private fun axis(
    key: String,
    label: String,
    value: Any,
    target: Int?,
    match: String
): LinkedHashMap<String, Any> = linkedMapOf<String, Any>(
    "key" to key,
    "label" to label,
    "value" to value
).also { axis ->
    if (target != null) axis["target"] = target
    axis["match"] = match
}

private fun flavorKo(flavor: String): String = when (flavor) {
    "fruity" -> "과일"
    "floral" -> "플로럴"
    "sweet" -> "단맛"
    "nutty_cocoa" -> "초콜릿·고소"
    "spices" -> "스파이스"
    "roasted" -> "로스티"
    "cereal" -> "곡물"
    "sour_fermented" -> "발효"
    "green" -> "그린"
    else -> flavor
}
