package com.brewdial.api.read

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository

@Repository
class ReadRepository(
    private val jdbcTemplate: JdbcTemplate,
    private val rows: ApiRowMapper
) {
    private val beanRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.bean(resultSet) }
    private val recipeRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.recipe(resultSet) }
    private val feedbackRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.feedback(resultSet) }
    private val purchaseLinkRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.purchaseLink(resultSet) }
    private val grinderRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.grinder(resultSet) }
    private val dripperRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.dripper(resultSet) }

    fun listBeans(): List<LinkedHashMap<String, Any?>> = jdbcTemplate.query(
        """
        select $BEAN_SELECT from bean_summaries
        where recipe_count > 0 or attrs_source is not null
        order by latest_recipe_at desc nulls last, name asc
        """.trimIndent(),
        beanRow
    )

    fun findBeans(query: String, limit: Int): List<LinkedHashMap<String, Any?>> {
        val pattern = "%${query.trim()}%"
        return jdbcTemplate.query(
            """
            select $BEAN_SELECT from bean_summaries
            where (name ilike ? or roaster ilike ?)
              and (recipe_count > 0 or attrs_source is not null)
            order by recipe_count desc, name asc
            limit ?
            """.trimIndent(),
            beanRow,
            pattern,
            pattern,
            limit
        )
    }

    fun findBean(id: String): LinkedHashMap<String, Any?>? = queryOne(
        "select $BEAN_SELECT from bean_summaries where id = ?",
        beanRow,
        id
    )

    fun listPurchaseLinks(beanId: String): List<LinkedHashMap<String, Any?>> = jdbcTemplate.query(
        """
        select $PURCHASE_LINK_SELECT from bean_purchase_links
        where bean_id = ? and active = true
        order by sort_order asc
        """.trimIndent(),
        purchaseLinkRow,
        beanId
    )

    fun listRecentRecipes(limit: Int): List<LinkedHashMap<String, Any?>> = jdbcTemplate.query(
        """
        select $RECIPE_SELECT from recipes
        where status = 'active' and owner_id is null
        order by created_at desc
        limit ?
        """.trimIndent(),
        recipeRow,
        limit
    )

    fun listRecipesByBean(
        beanId: String,
        callerAppUserId: String?
    ): List<LinkedHashMap<String, Any?>> = if (callerAppUserId == null) {
        jdbcTemplate.query(
            """
            select $RECIPE_SELECT from recipes
            where bean_id = ? and status = 'active' and owner_id is null
            order by created_at desc
            """.trimIndent(),
            recipeRow,
            beanId
        )
    } else {
        jdbcTemplate.query(
            """
            select $RECIPE_SELECT from recipes
            where bean_id = ? and status = 'active'
              and (owner_id is null or owner_id = ?)
            order by created_at desc
            """.trimIndent(),
            recipeRow,
            beanId,
            callerAppUserId
        )
    }

    fun findVisibleRecipe(code: String, callerAppUserId: String?): LinkedHashMap<String, Any?>? =
        if (callerAppUserId == null) {
            queryOne(
                """
                select $RECIPE_SELECT from recipes
                where code = ? and status <> 'test' and owner_id is null
                """.trimIndent(),
                recipeRow,
                code
            )
        } else {
            queryOne(
                """
                select $RECIPE_SELECT from recipes
                where code = ? and status <> 'test'
                  and (owner_id is null or owner_id = ?)
                """.trimIndent(),
                recipeRow,
                code,
                callerAppUserId
            )
        }

    fun listFeedback(code: String): List<LinkedHashMap<String, Any?>> = jdbcTemplate.query(
        """
        select $FEEDBACK_SELECT from feedback
        where recipe_code = ?
        order by created_at desc
        """.trimIndent(),
        feedbackRow,
        code
    )

    fun listGrinders(): List<LinkedHashMap<String, Any?>> = jdbcTemplate.query(
        "select $GRINDER_SELECT from grinders order by name asc",
        grinderRow
    )

    fun listDrippers(): List<LinkedHashMap<String, Any?>> = jdbcTemplate.query(
        "select $DRIPPER_SELECT from drippers order by continuum_position asc",
        dripperRow
    )

    private fun <T> queryOne(sql: String, mapper: RowMapper<T>, vararg args: Any?): T? =
        jdbcTemplate.query(sql, mapper, *args).firstOrNull()

    private companion object {
        const val RECIPE_SELECT = """
            id, code, method, title, version, params, steps, bean_id, bean_snapshot, intent, notes,
            adjustment_from_previous, created_by, owner_id, is_official, dripper_portability, status,
            supersedes, superseded_by, parent_code, created_at, updated_at
        """
        const val FEEDBACK_SELECT = """
            id, recipe_code, bean_id, owner_id, ratings, actual, comment, raw_comment, quick_tags,
            desired_direction, next_hint, source, created_at, updated_at
        """
        const val BEAN_SELECT = """
            id, name, roaster, origin, process, roast_level, notes, recipe_count, latest_recipe_at,
            has_ai, roast_level_ord, agtron_min, agtron_max, acidity, body, decaf, flavor_categories,
            attrs_source, source_url, attrs_notes
        """
        const val PURCHASE_LINK_SELECT = """
            id, bean_id, vendor, url, link_category, price_krw, is_affiliate, active, sort_order
        """
        const val GRINDER_SELECT = """
            id, name, um_per_click_est, um_per_click_source, zero_ref, stepless, brew_method_ranges,
            anchor_point, notes, created_at, updated_at
        """
        const val DRIPPER_SELECT = """
            id, name, class, geometry, continuum_position, hole_spec, filter_type,
            recommended_dose_range, size_models, notes, created_at, updated_at
        """
    }
}
