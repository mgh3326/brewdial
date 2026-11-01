package com.brewdial.api.bean

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.DynamicUpdate
import java.time.OffsetDateTime

@Entity
@DynamicUpdate
@Table(name = "beans")
class Bean {
    @Id
    @Column(name = "id", nullable = false)
    var id: String? = null

    @Column(name = "name", nullable = false, updatable = false)
    var name: String = ""

    @Column(name = "roaster", updatable = false)
    var roaster: String? = null

    @Column(name = "origin")
    var origin: String? = null

    @Column(name = "process")
    var process: String? = null

    @Column(name = "roast_level")
    var roastLevel: String? = null

    @Column(name = "notes")
    var notes: String? = null

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    lateinit var createdAt: OffsetDateTime

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    lateinit var updatedAt: OffsetDateTime

    @Column(name = "roast_level_ord")
    var roastLevelOrd: Short? = null

    @Column(name = "acidity")
    var acidity: Short? = null

    @Column(name = "body")
    var body: Short? = null

    @Column(name = "agtron_min")
    var agtronMin: Int? = null

    @Column(name = "agtron_max")
    var agtronMax: Int? = null

    @Column(name = "decaf")
    var decaf: Boolean? = null

    @Column(name = "flavor_categories")
    var flavorCategories: List<String>? = null

    @Column(name = "attrs_source")
    var attrsSource: String? = null

    @Column(name = "source_url")
    var sourceUrl: String? = null

    @Column(name = "attrs_notes")
    var attrsNotes: String? = null
}
