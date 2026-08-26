package com.brewdial.api.read

import org.springframework.stereotype.Component
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.math.BigDecimal
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.time.OffsetDateTime

@Component
class ApiRowMapper(
    private val objectMapper: ObjectMapper
) {
    fun recipe(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.recipeColumns,
        listOf(
            uuid(resultSet, "id"), resultSet.getString("code"), resultSet.getString("method"),
            resultSet.getString("title"), resultSet.getInt("version"), json(resultSet, "params"),
            json(resultSet, "steps"), resultSet.getString("bean_id"), json(resultSet, "bean_snapshot"),
            textArray(resultSet, "intent"), resultSet.getString("notes"),
            resultSet.getString("adjustment_from_previous"), resultSet.getString("created_by"),
            uuid(resultSet, "owner_id"), boolean(resultSet, "is_official"),
            json(resultSet, "dripper_portability"), resultSet.getString("status"),
            resultSet.getString("supersedes"), resultSet.getString("superseded_by"),
            resultSet.getString("parent_code"), timestamp(resultSet, "created_at"),
            timestamp(resultSet, "updated_at")
        )
    )

    fun feedback(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.feedbackColumns,
        listOf(
            uuid(resultSet, "id"), resultSet.getString("recipe_code"), resultSet.getString("bean_id"),
            uuid(resultSet, "owner_id"), json(resultSet, "ratings"), json(resultSet, "actual"),
            resultSet.getString("comment"), resultSet.getString("raw_comment"),
            textArray(resultSet, "quick_tags"), textArray(resultSet, "desired_direction"),
            textArray(resultSet, "next_hint"), resultSet.getString("source"),
            timestamp(resultSet, "created_at"), timestamp(resultSet, "updated_at")
        )
    )

    fun bean(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.beanColumns,
        listOf(
            resultSet.getString("id"), resultSet.getString("name"), resultSet.getString("roaster"),
            resultSet.getString("origin"), resultSet.getString("process"), resultSet.getString("roast_level"),
            resultSet.getString("notes"), long(resultSet, "recipe_count"),
            timestamp(resultSet, "latest_recipe_at"), boolean(resultSet, "has_ai"),
            number(resultSet, "roast_level_ord"), number(resultSet, "agtron_min"),
            number(resultSet, "agtron_max"), number(resultSet, "acidity"), number(resultSet, "body"),
            boolean(resultSet, "decaf"), textArray(resultSet, "flavor_categories"),
            resultSet.getString("attrs_source"), resultSet.getString("source_url"),
            resultSet.getString("attrs_notes")
        )
    )

    fun purchaseLink(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.purchaseLinkColumns,
        listOf(
            uuid(resultSet, "id"), resultSet.getString("bean_id"), resultSet.getString("vendor"),
            resultSet.getString("url"), resultSet.getString("link_category"), number(resultSet, "price_krw"),
            boolean(resultSet, "is_affiliate"), boolean(resultSet, "active"), number(resultSet, "sort_order")
        )
    )

    fun grinder(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.grinderColumns,
        listOf(
            uuid(resultSet, "id"), resultSet.getString("name"), decimal(resultSet, "um_per_click_est"),
            resultSet.getString("um_per_click_source"), resultSet.getString("zero_ref"),
            boolean(resultSet, "stepless"), json(resultSet, "brew_method_ranges"),
            json(resultSet, "anchor_point"), resultSet.getString("notes"),
            timestamp(resultSet, "created_at"), timestamp(resultSet, "updated_at")
        )
    )

    fun dripper(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.dripperColumns,
        listOf(
            uuid(resultSet, "id"), resultSet.getString("name"), resultSet.getString("class"),
            resultSet.getString("geometry"), decimal(resultSet, "continuum_position"),
            json(resultSet, "hole_spec"), resultSet.getString("filter_type"),
            json(resultSet, "recommended_dose_range"), json(resultSet, "size_models"),
            resultSet.getString("notes"), timestamp(resultSet, "created_at"),
            timestamp(resultSet, "updated_at")
        )
    )

    fun savedRecipe(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.savedRecipeColumns,
        listOf(
            uuid(resultSet, "id"), uuid(resultSet, "app_user_id"), resultSet.getString("recipe_code"),
            json(resultSet, "snapshot"), resultSet.getString("note"), timestamp(resultSet, "created_at")
        )
    )

    fun savedBean(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.savedBeanColumns,
        listOf(
            uuid(resultSet, "id"), uuid(resultSet, "app_user_id"), resultSet.getString("bean_id"),
            resultSet.getString("note"), timestamp(resultSet, "created_at")
        )
    )

    fun userGear(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.userGearColumns,
        listOf(
            uuid(resultSet, "id"), uuid(resultSet, "app_user_id"), resultSet.getString("kind"),
            uuid(resultSet, "grinder_id"), uuid(resultSet, "dripper_id"), resultSet.getString("label"),
            json(resultSet, "details"), boolean(resultSet, "is_default"), timestamp(resultSet, "created_at"),
            timestamp(resultSet, "updated_at")
        )
    )

    fun calibration(resultSet: ResultSet): LinkedHashMap<String, Any?> = ApiResponseShape.linkedRow(
        ApiResponseShape.calibrationColumns,
        listOf(
            uuid(resultSet, "id"), uuid(resultSet, "app_user_id"), uuid(resultSet, "from_grinder_id"),
            uuid(resultSet, "to_grinder_id"), resultSet.getString("from_label"), resultSet.getString("to_label"),
            resultSet.getString("anchor_method"), json(resultSet, "samples"), resultSet.getString("source"),
            resultSet.getString("notes"), timestamp(resultSet, "created_at"), timestamp(resultSet, "updated_at")
        )
    )

    private fun uuid(resultSet: ResultSet, column: String): String? = resultSet.getObject(column)?.toString()

    private fun boolean(resultSet: ResultSet, column: String): Boolean? = resultSet.getObject(column) as? Boolean

    private fun number(resultSet: ResultSet, column: String): Number? = resultSet.getObject(column) as? Number

    private fun long(resultSet: ResultSet, column: String): Long? = (resultSet.getObject(column) as? Number)?.toLong()

    private fun decimal(resultSet: ResultSet, column: String): BigDecimal? = resultSet.getBigDecimal(column)

    private fun textArray(resultSet: ResultSet, column: String): List<String>? {
        val array = resultSet.getArray(column) ?: return null
        return try {
            (array.array as? Array<*>)?.map { value -> value?.toString().orEmpty() } ?: emptyList()
        } finally {
            array.free()
        }
    }

    private fun json(resultSet: ResultSet, column: String): JsonNode? {
        val raw = resultSet.getObject(column) ?: return null
        val text = when (raw) {
            is String -> raw
            else -> raw.toString()
        }
        return objectMapper.readTree(text)
    }

    private fun timestamp(resultSet: ResultSet, column: String): String? {
        val raw = resultSet.getObject(column) ?: return null
        return when (raw) {
            is Instant -> raw.toString()
            is OffsetDateTime -> raw.toInstant().toString()
            is Timestamp -> raw.toInstant().toString()
            else -> resultSet.getObject(column, OffsetDateTime::class.java).toInstant().toString()
        }
    }
}
