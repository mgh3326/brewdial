package com.brewdial.api.me

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "saved_recipes")
class SavedRecipe {
    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "app_user_id", nullable = false)
    var appUserId: UUID? = null

    @Column(name = "recipe_code", nullable = false)
    var recipeCode: String = ""

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "snapshot", columnDefinition = "jsonb")
    var snapshot: String? = null

    @Column(name = "note")
    var note: String? = null

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null
}
