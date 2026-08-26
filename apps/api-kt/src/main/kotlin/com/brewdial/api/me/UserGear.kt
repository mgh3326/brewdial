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
@Table(name = "user_gear")
class UserGear {
    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "app_user_id", nullable = false)
    var appUserId: UUID? = null

    @Column(name = "kind", nullable = false)
    var kind: String = ""

    @Column(name = "grinder_id")
    var grinderId: UUID? = null

    @Column(name = "dripper_id")
    var dripperId: UUID? = null

    @Column(name = "label", nullable = false)
    var label: String = ""

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "details", nullable = false, columnDefinition = "jsonb")
    var details: String = "{}"

    @Column(name = "is_default", nullable = false)
    var isDefault: Boolean = false

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
