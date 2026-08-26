package com.brewdial.api.purchase

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.DynamicInsert
import java.time.Instant
import java.util.UUID

@Entity
@DynamicInsert
@Table(name = "bean_purchase_links")
class BeanPurchaseLink {
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "bean_id", nullable = false)
    var beanId: String = ""

    @Column(name = "vendor", nullable = false)
    var vendor: String = ""

    @Column(name = "url", nullable = false)
    var url: String = ""

    @Column(name = "link_category", nullable = false, updatable = false)
    var linkCategory: String? = null

    @Column(name = "price_krw")
    var priceKrw: Int? = null

    @Column(name = "is_affiliate", nullable = false, updatable = false)
    var isAffiliate: Boolean? = null

    @Column(name = "active", nullable = false, updatable = false)
    var active: Boolean? = null

    @Column(name = "sort_order", nullable = false, updatable = false)
    var sortOrder: Int? = null

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
