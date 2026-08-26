package com.brewdial.api.read

/**
 * Ordered response columns are deliberately local to the HTTP contract. The
 * persistence model keeps Kotlin-style property names; these lists preserve the
 * Hono API's snake_case keys without enabling a global naming strategy.
 */
object ApiResponseShape {
    val recipeColumns: List<String> = listOf(
        "id", "code", "method", "title", "version", "params", "steps", "bean_id",
        "bean_snapshot", "intent", "notes", "adjustment_from_previous", "created_by",
        "owner_id", "is_official", "dripper_portability", "status", "supersedes",
        "superseded_by", "parent_code", "created_at", "updated_at"
    )

    val feedbackColumns: List<String> = listOf(
        "id", "recipe_code", "bean_id", "owner_id", "ratings", "actual", "comment",
        "raw_comment", "quick_tags", "desired_direction", "next_hint", "source",
        "created_at", "updated_at"
    )

    val beanColumns: List<String> = listOf(
        "id", "name", "roaster", "origin", "process", "roast_level", "notes",
        "recipe_count", "latest_recipe_at", "has_ai", "roast_level_ord", "agtron_min",
        "agtron_max", "acidity", "body", "decaf", "flavor_categories", "attrs_source",
        "source_url", "attrs_notes"
    )

    val purchaseLinkColumns: List<String> = listOf(
        "id", "bean_id", "vendor", "url", "link_category", "price_krw", "is_affiliate",
        "active", "sort_order"
    )

    val grinderColumns: List<String> = listOf(
        "id", "name", "um_per_click_est", "um_per_click_source", "zero_ref", "stepless",
        "brew_method_ranges", "anchor_point", "notes", "created_at", "updated_at"
    )

    val dripperColumns: List<String> = listOf(
        "id", "name", "class", "geometry", "continuum_position", "hole_spec", "filter_type",
        "recommended_dose_range", "size_models", "notes", "created_at", "updated_at"
    )

    val savedRecipeColumns: List<String> = listOf(
        "id", "app_user_id", "recipe_code", "snapshot", "note", "created_at"
    )

    val savedBeanColumns: List<String> = listOf(
        "id", "app_user_id", "bean_id", "note", "created_at"
    )

    val userGearColumns: List<String> = listOf(
        "id", "app_user_id", "kind", "grinder_id", "dripper_id", "label", "details",
        "is_default", "created_at", "updated_at"
    )

    val calibrationColumns: List<String> = listOf(
        "id", "app_user_id", "from_grinder_id", "to_grinder_id", "from_label", "to_label",
        "anchor_method", "samples", "source", "notes", "created_at", "updated_at"
    )

    fun linkedRow(columns: List<String>, values: List<Any?>): LinkedHashMap<String, Any?> {
        require(columns.size == values.size) { "Response values must align with contract columns" }
        return LinkedHashMap<String, Any?>(columns.size).also { row ->
            columns.indices.forEach { index -> row[columns[index]] = values[index] }
        }
    }
}
