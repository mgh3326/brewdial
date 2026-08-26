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
@Table(name = "grinders")
class Grinder {
    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "name", nullable = false)
    var name: String = ""

    @Column(name = "um_per_click_est")
    var umPerClickEst: BigDecimal? = null

    @Column(name = "um_per_click_source")
    var umPerClickSource: String? = null

    @Column(name = "zero_ref")
    var zeroRef: String? = null

    @Column(name = "stepless", nullable = false, insertable = false, updatable = false)
    var stepless: Boolean = false

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "brew_method_ranges", nullable = false, columnDefinition = "jsonb", insertable = false, updatable = false)
    var brewMethodRanges: String = "{}"

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "anchor_point", columnDefinition = "jsonb")
    var anchorPoint: String? = null

    @Column(name = "notes")
    var notes: String? = null

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
