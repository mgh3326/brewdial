package com.brewdial.api.web

import com.brewdial.api.read.ReadRepository
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping(value = ["/api/beans", "/beans"])
class BeansController(
    private val readRepository: ReadRepository
) {
    @GetMapping
    fun listBeans(
        @RequestParam(name = "q", required = false) query: String?,
        @RequestParam(name = "limit", required = false) rawLimit: String?
    ): List<LinkedHashMap<String, Any?>> = if (query != null && query.isNotEmpty()) {
        readRepository.findBeans(query, parseLimit(rawLimit, default = 10, maximum = 25))
    } else {
        readRepository.listBeans()
    }

    @GetMapping("/{id}/purchase-links")
    fun purchaseLinks(@PathVariable("id") id: String): List<LinkedHashMap<String, Any?>> =
        readRepository.listPurchaseLinks(id)

    @GetMapping("/{id}")
    fun bean(@PathVariable("id") id: String): ResponseEntity<Any> =
        readRepository.findBean(id)?.let { ResponseEntity.ok(it) }
            ?: ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiErrors.notFound())

    private fun parseLimit(value: String?, default: Int, maximum: Int): Int =
        value?.trim()?.toIntOrNull()?.coerceIn(1, maximum) ?: default
}
