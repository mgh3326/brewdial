package com.brewdial.api.bean

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.OffsetDateTime
import java.util.UUID

@Entity
@Table(name = "beans")
class Bean {
    @Id
    @Column(name = "id", nullable = false, columnDefinition = "text")
    var id: String = UUID.randomUUID().toString()

    @Column(name = "name", nullable = false)
    var name: String = ""

    @Column(name = "roaster")
    var roaster: String? = null

    @Column(name = "origin")
    var origin: String? = null

    @Column(name = "process")
    var process: String? = null

    @Column(name = "roast_level")
    var roastLevel: String? = null

    @Column(name = "notes")
    var notes: String? = null

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false, columnDefinition = "timestamptz")
    lateinit var createdAt: OffsetDateTime

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false, columnDefinition = "timestamptz")
    lateinit var updatedAt: OffsetDateTime

    @Column(name = "roast_level_ord", columnDefinition = "smallint")
    var roastLevelOrd: Short? = null

    @Column(name = "acidity", columnDefinition = "smallint")
    var acidity: Short? = null

    @Column(name = "body", columnDefinition = "smallint")
    var body: Short? = null

    @Column(name = "agtron_min")
    var agtronMin: Int? = null

    @Column(name = "agtron_max")
    var agtronMax: Int? = null

    @Column(name = "decaf")
    var decaf: Boolean? = null

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "flavor_categories", columnDefinition = "text[]")
    var flavorCategories: List<String>? = null

    @Column(name = "attrs_source")
    var attrsSource: String? = null

    @Column(name = "source_url")
    var sourceUrl: String? = null

    @Column(name = "attrs_notes")
    var attrsNotes: String? = null
}
