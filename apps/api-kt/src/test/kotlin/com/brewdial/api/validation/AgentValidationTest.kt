package com.brewdial.api.validation

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import tools.jackson.databind.ObjectMapper

/** Golden cases ported from packages/shared/src/validation.test.ts (24 cases). */
class AgentValidationTest {
    private val mapper = ObjectMapper()
    private fun json(value: String) = mapper.readTree(value)

    @Test fun recipeMinimalValidAndUnknownFieldsAreDropped() {
        val result = validateCreateRecipeInput(json("""{"method":"v60","title":"Test V60","bogus":"drop"}"""))
        assertTrue(result.ok)
        assertEquals("v60", result.value!!.method)
        assertEquals("Test V60", result.value.title)
    }

    @Test fun recipeFullValidInput() = assertTrue(validateCreateRecipeInput(json("""
        {"method":"espresso","title":"Morning shot","params":{"doseG":18,"waterG":36,"tempC":93,"grinder":"K6","brewer":"Gaggia"},"steps":[{"atSec":0,"waterG":0,"note":"Pre-infuse"}],"intent":["sweeter"],"notes":"First","adjustmentFromPrevious":"finer","createdBy":"agent","beanId":"bean:abc","beanSnapshot":{"name":"Geisha","roaster":"Tim"}}
    """)).ok)

    @Test fun recipeRejectsNonObject() = assertError(validateCreateRecipeInput(json("\"nope\"")), "input must be an object")
    @Test fun recipeRejectsMissingTitle() = assertError(validateCreateRecipeInput(json("""{"method":"v60"}""")), "title is required")
    @Test fun recipeRejectsEmptyTitle() = assertFalse(validateCreateRecipeInput(json("""{"method":"v60","title":"   "}""")).ok)
    @Test fun recipeRejectsInvalidMethod() = assertError(validateCreateRecipeInput(json("""{"method":"french-press","title":"X"}""")), "method must be")
    @Test fun recipeRejectsStepWithoutNote() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"waterG":40}]}""")), "steps[0].note")
    @Test fun recipeAcceptsStructuredStep() = assertTrue(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"endSec":35,"waterG":60,"pourRateGPerSec":1.7,"note":"Bloom"}]}""")).ok)
    @Test fun recipeRejectsNegativeEndSec() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"endSec":-1,"note":"Bloom"}]}""")), "endSec")
    @Test fun recipeRejectsEndSecAtStart() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":30,"endSec":30,"note":"Bloom"}]}""")), "greater than atSec")
    @Test fun recipeRejectsNonNumericPourRate() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"pourRateGPerSec":"fast","note":"Bloom"}]}""")), "pourRateGPerSec")
    @Test fun recipeRejectsZeroPourRate() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"pourRateGPerSec":0,"note":"Bloom"}]}""")), "positive")
    @Test fun recipeAcceptsLegacyStep() = assertTrue(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"waterG":40,"note":"Bloom"}]}""")).ok)
    @Test fun recipeRejectsWaterExceedingTotal() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","params":{"waterG":200},"steps":[{"atSec":0,"waterG":300,"note":"Bloom"}]}""")), "exceeds total")
    @Test fun recipeRejectsDecreasingCumulativeWater() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"waterG":140,"note":"A"},{"atSec":40,"waterG":100,"note":"B"}]}""")), "decreases")
    @Test fun recipeRejectsOverlappingSteps() = assertError(validateCreateRecipeInput(json("""{"method":"v60","title":"X","steps":[{"atSec":0,"endSec":50,"note":"A"},{"atSec":45,"endSec":75,"note":"B"}]}""")), "steps overlap")

    @Test fun beanAcceptsStructuredAttributes() = assertTrue(validateUpdateBeanAttributesInput(json("""{"roastLevelOrd":4,"agtronMin":57,"agtronMax":59,"acidity":1,"body":5,"decaf":false,"flavorCategories":["nutty_cocoa","sweet"],"attrsSource":"roaster_page"}""")).ok)
    @Test fun beanRejectsAcidityNine() = assertError(validateUpdateBeanAttributesInput(json("""{"acidity":9}""")), "acidity must be")
    @Test fun beanRejectsUnknownFlavor() = assertError(validateUpdateBeanAttributesInput(json("""{"flavorCategories":["chocolate"]}""")), "unknown values")
    @Test fun beanRejectsInvertedBounds() = assertError(validateUpdateBeanAttributesInput(json("""{"agtronMin":90,"agtronMax":50}""")), "agtronMax must be >=")
    @Test fun beanRejectsEmptyBody() = assertError(validateUpdateBeanAttributesInput(json("{}")), "at least one bean")

    @Test fun purchaseLinkAcceptsMinimalHttps() = assertTrue(validateCreateBeanPurchaseLinkInput(json("""{"vendor":"Kurly","url":"https://example.com/x"}""")).ok)
    @Test fun purchaseLinkRejectsHttp() = assertError(validateCreateBeanPurchaseLinkInput(json("""{"vendor":"Kurly","url":"http://example.com/x"}""")), "url must start")
    @Test fun purchaseLinkRejectsUnknownCategory() = assertError(validateCreateBeanPurchaseLinkInput(json("""{"vendor":"Kurly","url":"https://example.com/x","linkCategory":"other"}""")), "linkCategory")

    @Test fun preferencesAcceptAndDedupeTags() {
        val result = validateUpdatePreferencesInput(json("""{"likes":["저산미","저산미"],"dislikes":["고산미"]}"""))
        assertTrue(result.ok)
        assertEquals(listOf("저산미"), result.value!!.likes)
    }

    @Test fun preferencesRejectUnknownTag() = assertError(validateUpdatePreferencesInput(json("""{"likes":["초코비"]}""")), "unknown taste tag")

    @TestFactory
    fun beanIntegerBoundaryGoldens(): List<DynamicTest> = listOf(
        BeanBoundary("roastLevelOrd", 1, true, "roastLevelOrd must be an integer 1-5"),
        BeanBoundary("roastLevelOrd", 0, false, "roastLevelOrd must be an integer 1-5"),
        BeanBoundary("roastLevelOrd", 5, true, "roastLevelOrd must be an integer 1-5"),
        BeanBoundary("roastLevelOrd", 6, false, "roastLevelOrd must be an integer 1-5"),
        BeanBoundary("acidity", 1, true, "acidity must be an integer 1-5"),
        BeanBoundary("acidity", 0, false, "acidity must be an integer 1-5"),
        BeanBoundary("acidity", 5, true, "acidity must be an integer 1-5"),
        BeanBoundary("acidity", 6, false, "acidity must be an integer 1-5"),
        BeanBoundary("body", 1, true, "body must be an integer 1-5"),
        BeanBoundary("body", 0, false, "body must be an integer 1-5"),
        BeanBoundary("body", 5, true, "body must be an integer 1-5"),
        BeanBoundary("body", 6, false, "body must be an integer 1-5"),
        BeanBoundary("agtronMin", 0, true, "agtronMin must be an integer 0-150"),
        BeanBoundary("agtronMin", -1, false, "agtronMin must be an integer 0-150"),
        BeanBoundary("agtronMin", 150, true, "agtronMin must be an integer 0-150"),
        BeanBoundary("agtronMin", 151, false, "agtronMin must be an integer 0-150"),
        BeanBoundary("agtronMax", 0, true, "agtronMax must be an integer 0-150"),
        BeanBoundary("agtronMax", -1, false, "agtronMax must be an integer 0-150"),
        BeanBoundary("agtronMax", 150, true, "agtronMax must be an integer 0-150"),
        BeanBoundary("agtronMax", 151, false, "agtronMax must be an integer 0-150")
    ).map { boundary ->
        DynamicTest.dynamicTest("${boundary.field}=${boundary.value} is ${if (boundary.accepted) "accepted" else "rejected"}") {
            val result = validateUpdateBeanAttributesInput(json("""{"${boundary.field}":${boundary.value}}"""))
            assertEquals(boundary.accepted, result.ok, result.errors.joinToString(" | "))
            if (!boundary.accepted) assertEquals(listOf(boundary.error), result.errors)
        }
    }

    @TestFactory
    fun purchaseLinkIntegerBoundaryGoldens(): List<DynamicTest> = listOf(
        PurchaseBoundary("priceKrw", 0, true, "priceKrw must be a non-negative integer"),
        PurchaseBoundary("priceKrw", -1, false, "priceKrw must be a non-negative integer"),
        PurchaseBoundary("sortOrder", Int.MIN_VALUE, true, "sortOrder must be an integer"),
        PurchaseBoundary("sortOrder", -1, true, "sortOrder must be an integer"),
        PurchaseBoundary("sortOrder", 0, true, "sortOrder must be an integer"),
        PurchaseBoundary("sortOrder", Int.MAX_VALUE, true, "sortOrder must be an integer")
    ).map { boundary ->
        DynamicTest.dynamicTest("${boundary.field}=${boundary.value} follows the shared rule") {
            val result = validateCreateBeanPurchaseLinkInput(json("""
                {"vendor":"Kurly","url":"https://example.com/x","${boundary.field}":${boundary.value}}
            """))
            assertEquals(boundary.accepted, result.ok, result.errors.joinToString(" | "))
            if (!boundary.accepted) assertEquals(listOf(boundary.error), result.errors)
        }
    }

    private data class BeanBoundary(val field: String, val value: Int, val accepted: Boolean, val error: String)
    private data class PurchaseBoundary(val field: String, val value: Int, val accepted: Boolean, val error: String)

    private fun assertError(result: ValidationResult<*>, expected: String) {
        assertFalse(result.ok)
        assertTrue(result.errors.joinToString(" ").contains(expected), result.errors.joinToString(" | "))
    }
}
