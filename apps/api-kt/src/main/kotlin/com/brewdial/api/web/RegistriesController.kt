package com.brewdial.api.web

import com.brewdial.api.read.ReadRepository
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping(value = ["/api", ""])
class RegistriesController(
    private val readRepository: ReadRepository
) {
    @GetMapping("/grinders")
    fun grinders(): List<LinkedHashMap<String, Any?>> = readRepository.listGrinders()

    @GetMapping("/drippers")
    fun drippers(): List<LinkedHashMap<String, Any?>> = readRepository.listDrippers()
}
