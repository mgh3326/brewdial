package com.brewdial.api.brew

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.DynamicInsert
import java.time.Instant

@Entity
@DynamicInsert
@Table(name = "xbloom_recipe_links")
class XBloomRecipeLink {
    @Id
    @Column(name = "xbloom_recipe_id", nullable = false, updatable = false)
    var xbloomRecipeId: String = ""

    @Column(name = "recipe_code", nullable = false)
    var recipeCode: String = ""

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, insertable = false)
    var updatedAt: Instant? = null
}
