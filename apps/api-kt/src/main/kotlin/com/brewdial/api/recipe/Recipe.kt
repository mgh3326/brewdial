package com.brewdial.api.recipe

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.DynamicInsert
import org.hibernate.annotations.DynamicUpdate
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@DynamicInsert
@DynamicUpdate
@Table(name = "recipes")
class Recipe {
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "code", nullable = false, insertable = false, updatable = false)
    var code: String = ""

    @Column(name = "method", nullable = false)
    var method: String = ""

    @Column(name = "title", nullable = false)
    var title: String? = ""

    // This is a domain version, not Hibernate optimistic locking.
    @Column(name = "version", nullable = false)
    var version: Int = 1

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "params", nullable = false, columnDefinition = "jsonb")
    var params: String? = "{}"

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "steps", nullable = false, columnDefinition = "jsonb")
    var steps: String? = "[]"

    @Column(name = "bean_id")
    var beanId: String? = null

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "bean_snapshot", columnDefinition = "jsonb")
    var beanSnapshot: String? = null

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "intent", columnDefinition = "text[]")
    var intent: List<String>? = null

    @Column(name = "notes")
    var notes: String? = null

    @Column(name = "adjustment_from_previous")
    var adjustmentFromPrevious: String? = null

    @Column(name = "created_by", nullable = false, updatable = false)
    var createdBy: String = "manual"

    @Column(name = "owner_id", updatable = false)
    var ownerId: UUID? = null

    @Column(name = "is_official", nullable = false, updatable = false)
    var isOfficial: Boolean = false

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "dripper_portability", columnDefinition = "jsonb")
    var dripperPortability: String? = null

    @Column(name = "status", nullable = false)
    var status: String = "active"

    @Column(name = "supersedes")
    var supersedes: String? = null

    @Column(name = "superseded_by")
    var supersededBy: String? = null

    @Column(name = "parent_code")
    var parentCode: String? = null

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
