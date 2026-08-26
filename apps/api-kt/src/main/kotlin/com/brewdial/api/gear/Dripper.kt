package com.brewdial.api.gear

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.Immutable
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

@Entity
@Immutable
@Table(name = "drippers")
class Dripper {
    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "name", nullable = false)
    var name: String = ""

    @Column(name = "class", nullable = false)
    var clazz: String = ""

    @Column(name = "geometry")
    var geometry: String? = null

    @Column(name = "continuum_position")
    var continuumPosition: BigDecimal? = null

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "hole_spec", nullable = false, columnDefinition = "jsonb", insertable = false, updatable = false)
    var holeSpec: String = "{}"

    @Column(name = "filter_type")
    var filterType: String? = null

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recommended_dose_range", nullable = false, columnDefinition = "jsonb", insertable = false, updatable = false)
    var recommendedDoseRange: String = "{}"

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "size_models", nullable = false, columnDefinition = "jsonb", insertable = false, updatable = false)
    var sizeModels: String = "[]"

    @Column(name = "notes")
    var notes: String? = null

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
