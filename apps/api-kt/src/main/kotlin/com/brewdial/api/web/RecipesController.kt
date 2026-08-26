package com.brewdial.api.web

import com.brewdial.api.identity.IdentityFilter
import com.brewdial.api.read.ReadRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping(value = ["/api/recipes", "/recipes"])
class RecipesController(
    private val readRepository: ReadRepository
) {
    @GetMapping
    fun listRecipes(
        request: HttpServletRequest,
        @RequestParam(name = "limit", required = false) rawLimit: String?,
        @RequestParam(name = "beanId", required = false) beanId: String?
    ): List<LinkedHashMap<String, Any?>> {
        val appUserId = IdentityFilter.appUserId(request)
        return if (!beanId.isNullOrEmpty()) {
            readRepository.listRecipesByBean(beanId, appUserId)
        } else {
            readRepository.listRecentRecipes(parseLimit(rawLimit))
        }
    }

    @GetMapping("/{code}")
    fun recipe(
        request: HttpServletRequest,
        @PathVariable("code") code: String
    ): ResponseEntity<Any> = readRepository.findVisibleRecipe(code, IdentityFilter.appUserId(request))
        ?.let { ResponseEntity.ok(it) }
        ?: ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiErrors.notFound())

    private fun parseLimit(value: String?): Int = value?.trim()?.toIntOrNull()?.coerceIn(1, 100) ?: 20
}
