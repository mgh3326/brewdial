package com.brewdial.api.read

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import tools.jackson.databind.ObjectMapper

class ApiResponseShapeTest {
    private val objectMapper = ObjectMapper()

    @Test
    fun serializedRowsHaveTheExactHonoColumnKeysInOrder() {
        // Copied from the Hono repository column lists; do not derive these from production constants.
        val recipeColumns = listOf(
            "id", "code", "method", "title", "version", "params", "steps", "bean_id",
            "bean_snapshot", "intent", "notes", "adjustment_from_previous", "created_by",
            "owner_id", "is_official", "dripper_portability", "status", "supersedes",
            "superseded_by", "parent_code", "created_at", "updated_at"
        )
        val feedbackColumns = listOf(
            "id", "recipe_code", "bean_id", "owner_id", "ratings", "actual", "comment",
            "raw_comment", "quick_tags", "desired_direction", "next_hint", "source",
            "created_at", "updated_at"
        )
        val beanColumns = listOf(
            "id", "name", "roaster", "origin", "process", "roast_level", "notes",
            "recipe_count", "latest_recipe_at", "has_ai", "roast_level_ord", "agtron_min",
            "agtron_max", "acidity", "body", "decaf", "flavor_categories", "attrs_source",
            "source_url", "attrs_notes"
        )
        val purchaseLinkColumns = listOf(
            "id", "bean_id", "vendor", "url", "link_category", "price_krw", "is_affiliate",
            "active", "sort_order"
        )

        assertEquals(recipeColumns, ApiResponseShape.recipeColumns)
        assertEquals(feedbackColumns, ApiResponseShape.feedbackColumns)
        assertEquals(beanColumns, ApiResponseShape.beanColumns)
        assertEquals(purchaseLinkColumns, ApiResponseShape.purchaseLinkColumns)

        assertEquals(recipeColumns, serializedKeys(recipeColumns))
        assertEquals(feedbackColumns, serializedKeys(feedbackColumns))
        assertEquals(beanColumns, serializedKeys(beanColumns))
        assertEquals(purchaseLinkColumns, serializedKeys(purchaseLinkColumns))
    }

    private fun serializedKeys(columns: List<String>): List<String> {
        val row = ApiResponseShape.linkedRow(columns, List(columns.size) { null })
        return objectMapper.readTree(objectMapper.writeValueAsString(row)).propertyNames().toList()
    }
}
