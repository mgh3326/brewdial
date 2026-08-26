package com.brewdial.api.purchase

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.Immutable
import java.time.Instant
import java.util.UUID

@Entity
@Immutable
@Table(name = "bean_purchase_links")
class BeanPurchaseLink {
    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    var id: UUID? = null

    @Column(name = "bean_id", nullable = false)
    var beanId: String = ""

    @Column(name = "vendor", nullable = false)
    var vendor: String = ""

    @Column(name = "url", nullable = false)
    var url: String = ""

    @Column(name = "link_category", nullable = false, insertable = false, updatable = false)
    var linkCategory: String = "product"

    @Column(name = "price_krw")
    var priceKrw: Int? = null

    @Column(name = "is_affiliate", nullable = false, insertable = false, updatable = false)
    var isAffiliate: Boolean = false

    @Column(name = "active", nullable = false, insertable = false, updatable = false)
    var active: Boolean = true

    @Column(name = "sort_order", nullable = false, insertable = false, updatable = false)
    var sortOrder: Int = 0

    @Column(name = "created_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var createdAt: Instant? = null

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz", insertable = false, updatable = false)
    var updatedAt: Instant? = null
}
