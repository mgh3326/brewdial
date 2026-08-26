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
@Table(name = "grinder_calibration")
class GrinderCalibration {
    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "app_user_id", nullable = false)
    var appUserId: UUID? = null

    @Column(name = "from_grinder_id")
    var fromGrinderId: UUID? = null

    @Column(name = "to_grinder_id")
    var toGrinderId: UUID? = null

    @Column(name = "from_label", nullable = false)
    var fromLabel: String = ""

    @Column(name = "to_label", nullable = false)
    var toLabel: String = ""

    @Column(name = "anchor_method")
    var anchorMethod: String? = null

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "samples", nullable = false, columnDefinition = "jsonb")
    var samples: String = "[]"

    @Column(name = "source", nullable = false)
    var source: String = "measured"

    @Column(name = "notes")
    var notes: String? = null

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
