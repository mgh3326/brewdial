package com.brewdial.api.summary

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import org.hibernate.annotations.Immutable
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.annotations.Subselect
import org.hibernate.type.SqlTypes
import java.time.Instant

@Entity
@Immutable
@Subselect(
    """
    select id, name, roaster, origin, process, roast_level, notes,
           recipe_count, latest_recipe_at, has_ai,
           roast_level_ord, agtron_min, agtron_max, acidity, body, decaf,
           flavor_categories, attrs_source, source_url, attrs_notes
    from bean_summaries
    """
)
class BeanSummary {
    @Id
    @Column(name = "id", nullable = false)
    var id: String = ""

    @Column(name = "name", nullable = false)
    var name: String = ""

    @Column(name = "roaster")
    var roaster: String? = null

    @Column(name = "origin")
    var origin: String? = null

    @Column(name = "process")
    var process: String? = null

    @Column(name = "roast_level")
    var roastLevel: String? = null

    @Column(name = "notes")
    var notes: String? = null

    @Column(name = "recipe_count", nullable = false)
    var recipeCount: Long = 0

    @Column(name = "latest_recipe_at", columnDefinition = "timestamptz")
    var latestRecipeAt: Instant? = null

    @Column(name = "has_ai", nullable = false)
    var hasAi: Boolean = false

    @Column(name = "roast_level_ord", columnDefinition = "smallint")
    var roastLevelOrd: Short? = null

    @Column(name = "agtron_min")
    var agtronMin: Int? = null

    @Column(name = "agtron_max")
    var agtronMax: Int? = null

    @Column(name = "acidity", columnDefinition = "smallint")
    var acidity: Short? = null

    @Column(name = "body", columnDefinition = "smallint")
    var body: Short? = null

    @Column(name = "decaf")
    var decaf: Boolean? = null

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "flavor_categories", columnDefinition = "text[]")
    var flavorCategories: List<String>? = null

    @Column(name = "attrs_source")
    var attrsSource: String? = null

    @Column(name = "source_url")
    var sourceUrl: String? = null

    @Column(name = "attrs_notes")
    var attrsNotes: String? = null
}
