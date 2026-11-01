package com.brewdial.api.me

import com.brewdial.api.config.DatabaseVendor
import com.brewdial.api.config.VendorSql
import com.brewdial.api.read.ApiRowMapper
import com.brewdial.api.recommend.BeanAttributes
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import java.sql.ResultSet
import java.util.UUID

@Repository
class MeRepository(
    private val jdbcTemplate: JdbcTemplate,
    private val rows: ApiRowMapper,
    private val sql: VendorSql
) {
    private val savedRecipeRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.savedRecipe(resultSet) }
    private val savedBeanRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.savedBean(resultSet) }
    private val userGearRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.userGear(resultSet) }
    private val calibrationRow = RowMapper<LinkedHashMap<String, Any?>> { resultSet, _ -> rows.calibration(resultSet) }
    private val attributeRow = RowMapper<BeanAttributes> { resultSet, _ -> attributes(resultSet) }

    fun saveRecipe(appUserId: String, code: String) {
        jdbcTemplate.update(
            when (sql.vendor) {
                DatabaseVendor.POSTGRESQL -> """
                    insert into saved_recipes (app_user_id, recipe_code, snapshot)
                    select cast(? as uuid), r.code, to_jsonb(r)
                      from recipes r where r.code = ? and r.status not in ('test', 'reference')
                    on conflict (app_user_id, recipe_code) do update set snapshot = excluded.snapshot
                """
                // to_jsonb(r): every recipes column under its own name, timestamps as
                // ISO-8601 UTC strings, is_official as a JSON boolean.
                DatabaseVendor.MYSQL -> """
                    insert into saved_recipes (id, app_user_id, recipe_code, snapshot)
                    select uuid(), incoming.app_user_id, incoming.code, incoming.snapshot from (
                      select ? as app_user_id, r.code, json_object(
                        'id', r.id, 'code', r.code, 'method', r.method, 'title', r.title,
                        'version', r.version, 'params', r.params, 'steps', r.steps,
                        'bean_id', r.bean_id, 'bean_snapshot', r.bean_snapshot, 'intent', r.intent,
                        'notes', r.notes, 'adjustment_from_previous', r.adjustment_from_previous,
                        'created_by', r.created_by, 'status', r.status, 'supersedes', r.supersedes,
                        'superseded_by', r.superseded_by, 'parent_code', r.parent_code,
                        'created_at', date_format(r.created_at, '%Y-%m-%dT%H:%i:%s.%f+00:00'),
                        'updated_at', date_format(r.updated_at, '%Y-%m-%dT%H:%i:%s.%f+00:00'),
                        'owner_id', r.owner_id, 'is_official', r.is_official is true,
                        'dripper_portability', r.dripper_portability
                      ) as snapshot
                      from recipes r where r.code = ? and r.status not in ('test', 'reference')
                    ) as incoming
                    on duplicate key update snapshot = incoming.snapshot
                """
            }.trimIndent(),
            appUserId,
            code
        )
    }

    fun saveBean(appUserId: String, beanId: String) {
        jdbcTemplate.update(
            when (sql.vendor) {
                DatabaseVendor.POSTGRESQL -> """
                    insert into saved_beans (app_user_id, bean_id)
                    values (cast(? as uuid), ?)
                    on conflict (app_user_id, bean_id) do nothing
                """
                // A self-assignment is the MySQL "do nothing"; unlike INSERT IGNORE it
                // still raises foreign-key errors for an unknown bean.
                DatabaseVendor.MYSQL -> """
                    insert into saved_beans (app_user_id, bean_id)
                    values (?, ?)
                    on duplicate key update app_user_id = app_user_id
                """
            }.trimIndent(),
            appUserId,
            beanId
        )
    }

    fun collections(appUserId: String): LinkedHashMap<String, Any> = linkedMapOf(
        "savedRecipes" to jdbcTemplate.query(
            """
            select id, app_user_id, recipe_code, snapshot, note, created_at
            from saved_recipes where app_user_id = ${sql.uuid}
            order by created_at desc
            """.trimIndent(),
            savedRecipeRow,
            appUserId
        ),
        "savedBeans" to jdbcTemplate.query(
            """
            select id, app_user_id, bean_id, note, created_at
            from saved_beans where app_user_id = ${sql.uuid}
            order by created_at desc
            """.trimIndent(),
            savedBeanRow,
            appUserId
        ),
        "gear" to jdbcTemplate.query(
            """
            select id, app_user_id, kind, grinder_id, dripper_id, label, details, is_default, created_at, updated_at
            from user_gear where app_user_id = ${sql.uuid}
            """.trimIndent(),
            userGearRow,
            appUserId
        ),
        "calibration" to jdbcTemplate.query(
            """
            select id, app_user_id, from_grinder_id, to_grinder_id, from_label, to_label, anchor_method,
                   samples, source, notes, created_at, updated_at
            from grinder_calibration where app_user_id = ${sql.uuid}
            """.trimIndent(),
            calibrationRow,
            appUserId
        ),
        "myRecipes" to jdbcTemplate.queryForList(
            "select code from recipes where owner_id = ${sql.uuid} and status <> 'reference'",
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
            where saved_beans.app_user_id = ${sql.uuid}
            """.trimIndent(),
            attributeRow,
            appUserId
        )
        val overallRating = when (sql.vendor) {
            DatabaseVendor.POSTGRESQL -> "(feedback.ratings->>'overall')::int"
            DatabaseVendor.MYSQL -> "cast(json_unquote(json_extract(feedback.ratings, '$.overall')) as signed)"
        }
        val rated = jdbcTemplate.query(
            """
            select $ATTRIBUTE_COLUMNS
            from feedback
            inner join beans on beans.id = feedback.bean_id
            where feedback.owner_id = ${sql.uuid}
              and coalesce($overallRating, 0) >= 4
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
                where app_user_id = ${sql.uuid} and kind = ? and is_default = true
                """.trimIndent(),
                appUserId,
                kind
            )
        }
        // The id is minted here (as gen_random_uuid() would) so no RETURNING is needed.
        val id = UUID.randomUUID().toString()
        jdbcTemplate.update(
            """
            insert into user_gear (id, app_user_id, kind, grinder_id, dripper_id, label, details, is_default)
            values (${sql.uuid}, ${sql.uuid}, ?, ${sql.uuid}, ${sql.uuid}, ?, ${sql.json}, ?)
            """.trimIndent(),
            id,
            appUserId,
            kind,
            grinderId,
            dripperId,
            label,
            details,
            isDefault
        )
        return id
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
    ): String = when (sql.vendor) {
        DatabaseVendor.POSTGRESQL -> upsertCalibrationPostgres(
            appUserId, fromLabel, toLabel, anchorMethod, fromGrinderId, toGrinderId, samples, source, notes
        )
        DatabaseVendor.MYSQL -> upsertCalibrationMySql(
            appUserId, fromLabel, toLabel, anchorMethod, fromGrinderId, toGrinderId, samples, source, notes
        )
    }

    private fun upsertCalibrationPostgres(
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

    /**
     * ON DUPLICATE KEY UPDATE hits grinder_calibration_pair_uidx, the same
     * expression key as the PostgreSQL ON CONFLICT target. MySQL has no
     * RETURNING, so the surviving row is read back by that key afterwards.
     */
    private fun upsertCalibrationMySql(
        appUserId: String,
        fromLabel: String,
        toLabel: String,
        anchorMethod: String?,
        fromGrinderId: String?,
        toGrinderId: String?,
        samples: String,
        source: String,
        notes: String?
    ): String {
        jdbcTemplate.update(
            """
            insert into grinder_calibration
              (id, app_user_id, from_grinder_id, to_grinder_id, from_label, to_label, anchor_method, samples, source, notes)
            values (?, ?, ?, ?, ?, ?, ?, cast(? as json), ?, ?) as incoming
            on duplicate key update
              samples = incoming.samples,
              source = incoming.source,
              notes = incoming.notes
            """.trimIndent(),
            UUID.randomUUID().toString(),
            appUserId,
            fromGrinderId,
            toGrinderId,
            fromLabel,
            toLabel,
            anchorMethod,
            samples,
            source,
            notes
        )
        return jdbcTemplate.queryForObject(
            """
            select id from grinder_calibration
            where app_user_id = ?
              and coalesce(from_grinder_id, lower(from_label)) = coalesce(?, lower(?))
              and coalesce(to_grinder_id, lower(to_label)) = coalesce(?, lower(?))
              and coalesce(anchor_method, '') = coalesce(?, '')
            """.trimIndent(),
            String::class.java,
            appUserId,
            fromGrinderId,
            fromLabel,
            toGrinderId,
            toLabel,
            anchorMethod
        ) ?: error("grinder_calibration upsert could not be read back")
    }

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

    private fun nullableTextArray(resultSet: ResultSet, column: String): List<String>? =
        rows.textArray(resultSet, column)

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
