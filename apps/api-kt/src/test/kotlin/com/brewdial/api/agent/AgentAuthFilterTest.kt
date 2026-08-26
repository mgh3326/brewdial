package com.brewdial.api.agent

import org.junit.jupiter.api.Test
import org.springframework.http.ResponseEntity
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.ObjectMapper

class AgentAuthFilterTest {
    @Test
    fun noAuthorizationHeaderReturns401() {
        mvc("test-token")
            .perform(get("/api/agent/probe"))
            .andExpect(status().isUnauthorized)
            .andExpect(content().string("{\"ok\":false,\"error\":\"agent auth required\"}"))
    }

    @Test
    fun wrongTokenReturns401() {
        mvc("test-token")
            .perform(get("/api/agent/probe").header("Authorization", "Bearer wrong-token"))
            .andExpect(status().isUnauthorized)
            .andExpect(content().string("{\"ok\":false,\"error\":\"agent auth required\"}"))
    }

    @Test
    fun matchingTokenPassesThrough() {
        mvc("test-token")
            .perform(get("/agent/probe").header("Authorization", "Bearer test-token"))
            .andExpect(status().isOk)
            .andExpect(content().string("{\"ok\":true}"))
    }

    @Test
    fun unconfiguredTokenReturns503BeforeHeaderValidation() {
        mvc(null)
            .perform(get("/api/agent/probe").header("Authorization", "Bearer test-token"))
            .andExpect(status().isServiceUnavailable)
            .andExpect(content().string("{\"ok\":false,\"error\":\"agent auth not configured\"}"))
    }

    private fun mvc(token: String?): MockMvc = MockMvcBuilders.standaloneSetup(ProbeController())
        .addFilters<StandaloneMockMvcBuilder>(AgentAuthFilter(AgentTokenSupplier { token }, ObjectMapper()))
        .build()

    @RestController
    private class ProbeController {
        @GetMapping("/api/agent/probe", "/agent/probe")
        fun probe(): ResponseEntity<LinkedHashMap<String, Boolean>> = ResponseEntity.ok(linkedMapOf("ok" to true))
    }
}
