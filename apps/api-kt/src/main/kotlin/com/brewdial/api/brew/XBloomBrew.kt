package com.brewdial.api.brew

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.DynamicInsert
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant

@Entity
@DynamicInsert
@Table(name = "brews")
class XBloomBrew {
    @Id
    @Column(name = "xbloom_brew_id", nullable = false, updatable = false)
    var xbloomBrewId: String = ""

    @Column(name = "brewed_at", nullable = false)
    var brewedAt: Instant = Instant.EPOCH

    @Column(name = "brew_time_sec", nullable = false)
    var brewTimeSec: Double = 0.0

    @Column(name = "recipe_name", nullable = false)
    var recipeName: String = ""

    @Column(name = "xbloom_recipe_id")
    var xbloomRecipeId: String? = null

    @Column(name = "total_water_ml", nullable = false)
    var totalWaterMl: Double = 0.0

    @Column(name = "final_cup_g", nullable = false)
    var finalCupG: Double = 0.0

    @Column(name = "retention_g", nullable = false)
    var retentionG: Double = 0.0

    @Column(name = "pour_end_sec", nullable = false)
    var pourEndSec: Int = 0

    @Column(name = "cup_at_pour_end_g", nullable = false)
    var cupAtPourEndG: Double = 0.0

    @Column(name = "drawdown_sec", nullable = false)
    var drawdownSec: Int = 0

    @Column(name = "early_drawdown_g_per_sec", nullable = false)
    var earlyDrawdownGPerSec: Double = 0.0

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recipe_snapshot", nullable = false)
    var recipeSnapshot: String = "{}"

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "curve", nullable = false)
    var curve: String = "[]"
}
