package com.brewdial.api.recommend

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import tools.jackson.databind.ObjectMapper
import java.nio.file.Paths

class RecommendationEngineTest {
    private val brily = BeanAttributes(
        roastLevelOrd = 5,
        acidity = 1,
        body = 4,
        flavorCategories = listOf("nutty_cocoa", "sweet")
    )
    private val dicaprio = BeanAttributes(
        roastLevelOrd = 5,
        acidity = 1,
        body = 4,
        decaf = true,
        flavorCategories = listOf("nutty_cocoa", "sweet")
    )
    private val dreamy = BeanAttributes(
        roastLevelOrd = 4,
        acidity = 1,
        body = 4,
        decaf = true,
        flavorCategories = listOf("nutty_cocoa", "sweet")
    )
    private val aponte = BeanAttributes(
        roastLevelOrd = 4,
        acidity = 2,
        body = 3,
        decaf = true,
        flavorCategories = listOf("nutty_cocoa", "sweet")
    )
    private val jaldoe = BeanAttributes(
        roastLevelOrd = 3,
        acidity = 3,
        body = 4,
        flavorCategories = listOf("fruity", "sweet")
    )
    private val gujiUraga = BeanAttributes(
        roastLevelOrd = 2,
        acidity = 4,
        body = 2,
        flavorCategories = listOf("fruity", "floral")
    )
    private val signals = TasteSignals(
        savedBeanAttrs = listOf(brily, dicaprio, dreamy),
        ratedBeanAttrs = emptyList(),
        likes = listOf("저산미", "고소함", "초콜릿/단맛", "다크 로스팅", "저녁은 디카페인"),
        dislikes = listOf("고산미", "라이트 로스팅")
    )

    @Test
    fun derivesALowAcidityFullBodyDarkTargetFromSavedBeansAndTags() {
        val target = deriveTasteTarget(signals)

        assertTrue(target.acidity!! <= 2)
        assertTrue(target.body!! >= 3.5)
        assertTrue(target.roast!! >= 4)
        assertTrue("nutty_cocoa" in target.flavorAffinity)
        assertTrue("sweet" in target.flavorAffinity)
        assertTrue("highAcidity" in target.penalize)
        assertTrue("lightRoast" in target.penalize)
        assertNotEquals("none", target.confidence)
        assertTrue(target.summary.isNotEmpty())
    }

    @Test
    fun noSignalsReturnsConfidenceNone() {
        val target = deriveTasteTarget(TasteSignals(emptyList(), emptyList(), emptyList(), emptyList()))

        assertEquals("none", target.confidence)
        assertEquals(emptyList<String>(), target.flavorAffinity)
        assertEquals("", target.summary)
    }

    @Test
    fun derivedTargetsAreIntegerScaleValues() {
        val target = deriveTasteTarget(signals)

        assertEquals(0.0, target.acidity!! % 1.0)
        assertEquals(0.0, target.body!! % 1.0)
        assertEquals(0.0, target.roast!! % 1.0)
    }

    @Test
    fun brilyIsGreat() {
        assertEquals("great", scoreBean(brily, deriveTasteTarget(signals)).band)
    }

    @Test
    fun aponteIsGreat() {
        assertEquals("great", scoreBean(aponte, deriveTasteTarget(signals)).band)
    }

    @Test
    fun jaldoeIsOk() {
        assertEquals("ok", scoreBean(jaldoe, deriveTasteTarget(signals)).band)
    }

    @Test
    fun gujiUragaIsAdventure() {
        assertEquals("adventure", scoreBean(gujiUraga, deriveTasteTarget(signals)).band)
    }

    @Test
    fun emptyAttributesAreUnknown() {
        assertEquals("unknown", scoreBean(BeanAttributes(), deriveTasteTarget(signals)).band)
    }

    @Test
    fun acidityAxisIsHitAndRenderedWithoutPercent() {
        val result = scoreBean(brily, deriveTasteTarget(signals))

        assertEquals("hit", result.axes.first { it["key"] == "acidity" }["match"])
        assertFalse(ObjectMapper().writeValueAsString(result.axes).contains('%'))
    }

    @Test
    fun displayedAxisTargetIsAnInteger() {
        val result = scoreBean(jaldoe, deriveTasteTarget(signals))
        val roastAxis = result.axes.first { it["key"] == "roast" }

        assertTrue(roastAxis["target"] is Int)
    }

    @Test
    fun partialAttributesRenormalizeOverAvailableAxes() {
        val result = scoreBean(
            BeanAttributes(acidity = 1, flavorCategories = listOf("nutty_cocoa", "sweet")),
            deriveTasteTarget(signals)
        )

        assertNotEquals("unknown", result.band)
        assertNotEquals("na", result.axes.first { it["key"] == "acidity" }["match"])
        assertNotEquals("na", result.axes.first { it["key"] == "flavor" }["match"])
        assertEquals("na", result.axes.first { it["key"] == "roast" }["match"])
        assertEquals("na", result.axes.first { it["key"] == "body" }["match"])
    }

    @Test
    fun positiveHalfRoundsLikeJavaScriptMathRound() {
        val target = TasteTarget(
            acidity = 2.5,
            flavorAffinity = emptyList(),
            penalize = emptyList(),
            confidence = "low",
            summary = "",
            evidence = emptyList()
        )

        val acidityAxis = scoreBean(BeanAttributes(acidity = 3), target).axes.first { it["key"] == "acidity" }
        assertEquals(3, acidityAxis["target"])
    }

    @Test
    fun crossGoldenMatchesTheCompiledTypeScriptImplementation() {
        val target = deriveTasteTarget(signals)
        val result = scoreBean(jaldoe, target)
        val kotlinJson = ObjectMapper().writeValueAsString(
            linkedMapOf(
                "target" to linkedMapOf(
                    "acidity" to Math.round(target.acidity!!),
                    "body" to Math.round(target.body!!),
                    "roast" to Math.round(target.roast!!),
                    "flavorAffinity" to target.flavorAffinity,
                    "penalize" to target.penalize,
                    "confidence" to target.confidence,
                    "summary" to target.summary,
                    "evidence" to target.evidence
                ),
                "score" to linkedMapOf(
                    "band" to result.band,
                    "score" to result.score,
                    "axes" to result.axes,
                    "why" to result.why
                )
            )
        )
        val repositoryRoot = Paths.get(System.getProperty("user.dir")).toAbsolutePath().parent.parent
        val script = """
            import { deriveTasteTarget, scoreBean } from './packages/shared/dist/recommend.js';
            const signals = {
              savedBeanAttrs: [
                { roastLevelOrd: 5, acidity: 1, body: 4, flavorCategories: ['nutty_cocoa', 'sweet'] },
                { roastLevelOrd: 5, acidity: 1, body: 4, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] },
                { roastLevelOrd: 4, acidity: 1, body: 4, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] }
              ],
              ratedBeanAttrs: [],
              likes: ['저산미', '고소함', '초콜릿/단맛', '다크 로스팅', '저녁은 디카페인'],
              dislikes: ['고산미', '라이트 로스팅']
            };
            const target = deriveTasteTarget(signals);
            const score = scoreBean({ roastLevelOrd: 3, acidity: 3, body: 4, flavorCategories: ['fruity', 'sweet'] }, target);
            console.log(JSON.stringify({ target, score }));
        """.trimIndent()
        val process = ProcessBuilder("node", "--input-type=module", "-e", script)
            .directory(repositoryRoot.toFile())
            .redirectErrorStream(true)
            .start()
        val typeScriptJson = process.inputStream.bufferedReader().use { it.readText().trim() }

        assertEquals(0, process.waitFor(), typeScriptJson)
        assertEquals(typeScriptJson, kotlinJson)
    }
}
