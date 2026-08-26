package com.brewdial.api.me

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "saved_beans")
class SavedBean {
    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "app_user_id", nullable = false)
    var appUserId: UUID? = null

    @Column(name = "bean_id", nullable = false, columnDefinition = "text")
    var beanId: String = ""

    @Column(name = "note")
    var note: String? = null

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null
}
