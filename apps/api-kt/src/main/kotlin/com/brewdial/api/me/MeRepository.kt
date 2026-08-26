package com.brewdial.api.me

import com.brewdial.api.read.ApiRowMapper
import com.brewdial.api.recommend.BeanAttributes
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import java.sql.ResultSet

@Repository
class MeRepository(
    private val jdbcTemplate: JdbcTemplate,
    private val rows: ApiRowMapper
) {
    private val savedRecipeRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.savedRecipe(resultSet) }
    private val savedBeanRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.savedBean(resultSet) }
    private val userGearRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.userGear(resultSet) }
    private val calibrationRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.calibration(resultSet) }
    private val attributeRow = RowMapper<BeanAttributes> { resultSet, _ -> attributes(resultSet) }

    fun saveRecipe(appUserId: String, code: String) {
        jdbcTemplate.update(
            """
            insert into saved_recipes (app_user_id, recipe_code, snapshot)
            select cast(? as uuid), r.code, to_jsonb(r)
              from recipes r where r.code = ? and r.status <> 'test'
            on conflict (app_user_id, recipe_code) do update set snapshot = excluded.snapshot
            """.trimIndent(),
            appUserId,
            code
        )
    }

    fun saveBean(appUserId: String, beanId: String) {
        jdbcTemplate.update(
            """
            insert into saved_beans (app_user_id, bean_id)
            values (cast(? as uuid), ?)
            on conflict (app_user_id, bean_id) do nothing
            """.trimIndent(),
            appUserId,
            beanId
        )
    }

    fun collections(appUserId: String): LinkedHashMap<String, Any> = linkedMapOf(
        "savedRecipes" to jdbcTemplate.query(
            """
            select id, app_user_id, recipe_code, snapshot, note, created_at
            from saved_recipes where app_user_id = cast(? as uuid)
            order by created_at desc
            """.trimIndent(),
            savedRecipeRow,
            appUserId
        ),
        "savedBeans" to jdbcTemplate.query(
            """
            select id, app_user_id, bean_id, note, created_at
            from saved_beans where app_user_id = cast(? as uuid)
            order by created_at desc
            """.trimIndent(),
            savedBeanRow,
            appUserId
        ),
        "gear" to jdbcTemplate.query(
            """
            select id, app_user_id, kind, grinder_id, dripper_id, label, details, is_default, created_at, updated_at
            from user_gear where app_user_id = cast(? as uuid)
            """.trimIndent(),
            userGearRow,
            appUserId
        ),
        "calibration" to jdbcTemplate.query(
            """
            select id, app_user_id, from_grinder_id, to_grinder_id, from_label, to_label, anchor_method,
                   samples, source, notes, created_at, updated_at
            from grinder_calibration where app_user_id = cast(? as uuid)
            """.trimIndent(),
            calibrationRow,
            appUserId
        ),
        "myRecipes" to jdbcTemplate.queryForList(
            "select code from recipes where owner_id = cast(? as uuid)",
            String::class.java,
            appUserId
        )
    )

    fun tasteSignals(appUserId: String?): TasteSignalRows {
        if (appUserId == null) return TasteSignalRows(emptyList(), emptyList())
        val saved = jdbcTemplate.query(
            """
            select $ATTRIBUTE_COLUMNS
            from saved_beans
            inner join beans on beans.id = saved_beans.bean_id
            where saved_beans.app_user_id = cast(? as uuid)
            """.trimIndent(),
            attributeRow,
            appUserId
        )
        val rated = jdbcTemplate.query(
            """
            select $ATTRIBUTE_COLUMNS
            from feedback
            inner join beans on beans.id = feedback.bean_id
            where feedback.owner_id = cast(? as uuid)
              and coalesce((feedback.ratings->>'overall')::int, 0) >= 4
            """.trimIndent(),
            attributeRow,
            appUserId
        )
        return TasteSignalRows(saved, rated)
    }

    fun globalPreference(): PreferenceValues {
        val values = jdbcTemplate.query(
            "select likes, dislikes from preferences where id = 'global'",
            RowMapper { resultSet, _ -> PreferenceValues(textArray(resultSet, "likes"), textArray(resultSet, "dislikes")) }
        )
        return values.firstOrNull() ?: PreferenceValues(emptyList(), emptyList())
    }

    @Transactional
    fun upsertGear(
        appUserId: String,
        kind: String,
        label: String,
        grinderId: String?,
        dripperId: String?,
        details: String,
        isDefault: Boolean
    ): String {
        if (isDefault) {
            jdbcTemplate.update(
                """
                update user_gear set is_default = false
                where app_user_id = cast(? as uuid) and kind = ? and is_default = true
                """.trimIndent(),
                appUserId,
                kind
            )
        }
        return jdbcTemplate.query(
            """
            insert into user_gear (app_user_id, kind, grinder_id, dripper_id, label, details, is_default)
            values (cast(? as uuid), ?, cast(? as uuid), cast(? as uuid), ?, cast(? as jsonb), ?)
            returning id
            """.trimIndent(),
            RowMapper { resultSet, _ -> resultSet.getObject("id").toString() },
            appUserId,
            kind,
            grinderId,
            dripperId,
            label,
            details,
            isDefault
        ).single()
    }

    fun upsertCalibration(
        appUserId: String,
        fromLabel: String,
        toLabel: String,
        anchorMethod: String?,
        fromGrinderId: String?,
        toGrinderId: String?,
        samples: String,
        source: String,
        notes: String?
    ): String = jdbcTemplate.query(
        """
        insert into grinder_calibration
          (app_user_id, from_grinder_id, to_grinder_id, from_label, to_label, anchor_method, samples, source, notes)
        values (
          cast(? as uuid),
          cast(? as uuid),
          cast(? as uuid),
          ?, ?, ?, cast(? as jsonb), ?, ?
        )
        on conflict (
          app_user_id,
          coalesce(from_grinder_id::text, lower(from_label)),
          coalesce(to_grinder_id::text, lower(to_label)),
          coalesce(anchor_method, '')
        )
        do update set
          samples = excluded.samples,
          source = excluded.source,
          notes = excluded.notes
        returning id
        """.trimIndent(),
        RowMapper { resultSet, _ -> resultSet.getObject("id").toString() },
        appUserId,
        fromGrinderId,
        toGrinderId,
        fromLabel,
        toLabel,
        anchorMethod,
        samples,
        source,
        notes
    ).single()

    private fun attributes(resultSet: ResultSet): BeanAttributes = BeanAttributes(
        roastLevelOrd = number(resultSet, "roast_level_ord"),
        agtronMin = number(resultSet, "agtron_min"),
        agtronMax = number(resultSet, "agtron_max"),
        acidity = number(resultSet, "acidity"),
        body = number(resultSet, "body"),
        decaf = resultSet.getObject("decaf") as? Boolean,
        flavorCategories = nullableTextArray(resultSet, "flavor_categories"),
        attrsSource = resultSet.getString("attrs_source")
    )

    private fun number(resultSet: ResultSet, column: String): Int? =
        (resultSet.getObject(column) as? Number)?.toInt()

    private fun nullableTextArray(resultSet: ResultSet, column: String): List<String>? {
        val array = resultSet.getArray(column) ?: return null
        return try {
            (array.array as? Array<*>)?.map { value -> value?.toString().orEmpty() } ?: emptyList()
        } finally {
            array.free()
        }
    }

    private fun textArray(resultSet: ResultSet, column: String): List<String> =
        nullableTextArray(resultSet, column).orEmpty()

    private companion object {
        const val ATTRIBUTE_COLUMNS = """
            beans.roast_level_ord, beans.agtron_min, beans.agtron_max, beans.acidity, beans.body,
            beans.decaf, beans.flavor_categories, beans.attrs_source
        """
    }
}

class TasteSignalRows(
    val savedBeanAttrs: List<BeanAttributes>,
    val ratedBeanAttrs: List<BeanAttributes>
)

class PreferenceValues(
    val likes: List<String>,
    val dislikes: List<String>
)
