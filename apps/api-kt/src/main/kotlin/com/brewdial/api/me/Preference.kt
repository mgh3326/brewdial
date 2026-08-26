package com.brewdial.api.me

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant

@Entity
@Table(name = "preferences")
class Preference {
    @Id
    @Column(name = "id", nullable = false)
    var id: String = "global"

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "likes", nullable = false, columnDefinition = "text[]")
    var likes: List<String> = emptyList()

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "dislikes", nullable = false, columnDefinition = "text[]")
    var dislikes: List<String> = emptyList()

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "default_params", nullable = false, columnDefinition = "jsonb")
    var defaultParams: String = "{}"

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
