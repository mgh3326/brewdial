package com.brewdial.api.parity

import com.brewdial.api.recommend.BeanAttributes
import com.brewdial.api.recommend.TasteSignals
import com.brewdial.api.recommend.deriveTasteTarget
import com.brewdial.api.recommend.scoreBean
import com.brewdial.api.validation.ValidationResult
import com.brewdial.api.validation.validateCreateBeanPurchaseLinkInput
import com.brewdial.api.validation.validateCreateRecipeInput
import com.brewdial.api.validation.validateUpdateBeanAttributesInput
import com.brewdial.api.validation.validateUpdatePreferencesInput
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import tools.jackson.module.kotlin.jacksonObjectMapper
import tools.jackson.databind.node.ArrayNode
import tools.jackson.databind.node.ObjectNode
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Runs the TS↔Kotlin parity fixtures in packages/shared/src/__fixtures__/parity.
 * Every `expected` there is generated from the TypeScript implementation, so this
 * test fails whenever the Kotlin port gives a different result for the same input.
 */
class ParityGoldenTest {
    // The Kotlin module keeps `is`-prefixed Boolean names (isAffiliate), as the TS fixtures expect.
    private val mapper = jacksonObjectMapper()

    private val fixtureDir: Path =
        Paths.get(System.getProperty("user.dir")).toAbsolutePath()
            .parent.parent.resolve("packages/shared/src/__fixtures__/parity")

    private fun cases(file: String): List<JsonNode> =
        mapper.readTree(Files.readString(fixtureDir.resolve(file))).get("cases").toList()

    @TestFactory
    fun recommend(): List<DynamicTest> = cases("recommend.json").map { case ->
        DynamicTest.dynamicTest(case.get("name").asText()) {
            val signals = case.get("signals")
            val target = deriveTasteTarget(
                TasteSignals(
                    savedBeanAttrs = signals.get("savedBeanAttrs").toList().map(::beanAttributes),
                    ratedBeanAttrs = signals.get("ratedBeanAttrs").toList().map(::beanAttributes),
                    likes = signals.get("likes").toList().map { it.asText() },
                    dislikes = signals.get("dislikes").toList().map { it.asText() }
                )
            )
            val actual = linkedMapOf(
                "target" to target,
                "scores" to case.get("beans").toList().map { scoreBean(beanAttributes(it), target) }
            )
            assertJsonEquals(case.get("expected"), mapper.valueToTree(actual))
        }
    }

    @TestFactory
    fun validation(): List<DynamicTest> = cases("validation.json").map { case ->
        DynamicTest.dynamicTest(case.get("name").asText()) {
            val input = case.get("input")
            val result: ValidationResult<*> = when (val name = case.get("validator").asText()) {
                "CreateRecipe" -> validateCreateRecipeInput(input)
                "UpdateBeanAttributes" -> validateUpdateBeanAttributesInput(input)
                "CreateBeanPurchaseLink" -> validateCreateBeanPurchaseLinkInput(input)
                "UpdatePreferences" -> validateUpdatePreferencesInput(input)
                else -> error("unknown validator $name")
            }
            // Same shape as the shared ValidationResult union.
            val actual = if (result.ok) {
                linkedMapOf("ok" to true, "value" to result.value, "warnings" to result.warnings)
            } else {
                linkedMapOf("ok" to false, "errors" to result.errors)
            }
            assertJsonEquals(case.get("expected"), mapper.valueToTree(actual))
        }
    }

    private fun beanAttributes(node: JsonNode) = BeanAttributes(
        roastLevelOrd = node.intOrNull("roastLevelOrd"),
        agtronMin = node.intOrNull("agtronMin"),
        agtronMax = node.intOrNull("agtronMax"),
        acidity = node.intOrNull("acidity"),
        body = node.intOrNull("body"),
        decaf = node.get("decaf")?.takeIf { !it.isNull }?.booleanValue(),
        flavorCategories = node.get("flavorCategories")?.toList()?.map { it.asText() },
        attrsSource = node.get("attrsSource")?.asText()
    )

    private fun JsonNode.intOrNull(key: String): Int? = get(key)?.takeIf { !it.isNull }?.asInt()

    private fun assertJsonEquals(expected: JsonNode, actual: JsonNode) {
        val want = withoutNulls(expected)
        val got = withoutNulls(actual)
        assertTrue(same(want, got)) {
            "Kotlin result differs from the TypeScript golden\n" +
                "expected: ${mapper.writeValueAsString(want)}\n" +
                "actual:   ${mapper.writeValueAsString(got)}"
        }
    }

    // TS drops `undefined` fields when it serializes; Kotlin carries them as null.
    private fun withoutNulls(node: JsonNode): JsonNode = when (node) {
        is ObjectNode -> mapper.createObjectNode().also { out ->
            node.properties().forEach { (key, value) -> if (!value.isNull) out.set(key, withoutNulls(value)) }
        }
        is ArrayNode -> mapper.createArrayNode().also { out -> node.forEach { out.add(withoutNulls(it)) } }
        else -> node
    }

    // Structural equality where 2 and 2.0 are the same number (JS has one number type).
    private fun same(a: JsonNode, b: JsonNode): Boolean = when {
        a.isNumber && b.isNumber -> a.doubleValue() == b.doubleValue()
        a.isObject && b.isObject ->
            a.propertyNames().toSet() == b.propertyNames().toSet() &&
                a.propertyNames().all { same(a.get(it), b.get(it)) }
        a.isArray && b.isArray -> a.size() == b.size() && (0 until a.size()).all { same(a.get(it), b.get(it)) }
        else -> a == b
    }
}
