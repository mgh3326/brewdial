package com.brewdial.api.web

import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.servlet.resource.NoResourceFoundException

@RestControllerAdvice
class ApiExceptionHandler {
    // Hono treats a method without a mapped handler as a route miss (404), not 405.
    @ExceptionHandler(HttpRequestMethodNotSupportedException::class)
    fun methodNotAllowed(): ResponseEntity<LinkedHashMap<String, String>> =
        ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiErrors.notFound())

    @ExceptionHandler(NoResourceFoundException::class)
    fun resourceNotFound(): ResponseEntity<LinkedHashMap<String, String>> =
        ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiErrors.notFound())
}
