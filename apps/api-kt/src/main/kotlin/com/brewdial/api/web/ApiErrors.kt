package com.brewdial.api.web

object ApiErrors {
    fun notFound(): LinkedHashMap<String, String> = linkedMapOf("error" to "not found")

    fun recipeNotFound(): LinkedHashMap<String, String> = linkedMapOf("error" to "recipe not found")
}
