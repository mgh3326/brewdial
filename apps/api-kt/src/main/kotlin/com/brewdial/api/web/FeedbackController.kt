package com.brewdial.api.web

import com.brewdial.api.identity.IdentityFilter
import com.brewdial.api.read.ReadRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping(value = ["/api/recipes", "/recipes"])
class FeedbackController(
    private val readRepository: ReadRepository
) {
    @GetMapping("/{code}/feedback")
    fun listFeedback(
        request: HttpServletRequest,
        @PathVariable("code") code: String
    ): ResponseEntity<Any> {
        if (readRepository.findVisibleRecipe(code, IdentityFilter.appUserId(request)) == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiErrors.recipeNotFound())
        }
        return ResponseEntity.ok(readRepository.listFeedback(code))
    }
}
