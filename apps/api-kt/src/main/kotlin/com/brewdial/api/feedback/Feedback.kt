package com.brewdial.api.feedback

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.DynamicInsert
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@DynamicInsert
@Table(name = "feedback")
class Feedback {
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "recipe_code", nullable = false)
    var recipeCode: String = ""

    @Column(name = "bean_id")
    var beanId: String? = null

    @Column(name = "owner_id")
    var ownerId: UUID? = null

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ratings")
    var ratings: String? = null

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "actual")
    var actual: String? = null

    @Column(name = "comment")
    var comment: String? = null

    @Column(name = "raw_comment")
    var rawComment: String? = null

    @Column(name = "quick_tags")
    var quickTags: List<String>? = null

    @Column(name = "desired_direction")
    var desiredDirection: List<String>? = null

    @Column(name = "next_hint")
    var nextHint: List<String>? = null

    @Column(name = "source", nullable = false, updatable = false)
    var source: String = "web"

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
