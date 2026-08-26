package com.brewdial.api.identity

import jakarta.servlet.http.HttpServletRequest
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.ObjectMapper
import java.util.UUID

class IdentityFilterTest {
    @Test
    fun validHeaderAndJdbcFailureReturnsFailClosed503Body() {
        val jdbcTemplate = mock(JdbcTemplate::class.java)
        val key = "valid-identity-key-123456"
        doThrow(DataAccessResourceFailureException("database unavailable"))
            .`when`(jdbcTemplate)
            .queryForObject(
                eq("select resolve_app_user(?, ?)"),
                eq(UUID::class.java),
                eq("toss_anon"),
                eq(key)
            )

        mvc(JdbcIdentityResolver(jdbcTemplate))
            .perform(get("/probe").header(IdentityFilter.HEADER, "toss_anon:$key"))
            .andExpect(status().isServiceUnavailable)
            .andExpect(content().string("{\"ok\":false,\"error\":\"identity temporarily unavailable\"}"))

        verify(jdbcTemplate).queryForObject(
            "select resolve_app_user(?, ?)",
            UUID::class.java,
            "toss_anon",
            key
        )
    }

    @Test
    fun missingHeaderStaysAnonymousAndReturns200() {
        val jdbcTemplate = mock(JdbcTemplate::class.java)

        mvc(JdbcIdentityResolver(jdbcTemplate))
            .perform(get("/probe"))
            .andExpect(status().isOk)
            .andExpect(content().string("anonymous"))

        verifyNoInteractions(jdbcTemplate)
    }

    @Test
    fun malformedHeaderStaysAnonymousAndReturns200() {
        val jdbcTemplate = mock(JdbcTemplate::class.java)

        mvc(JdbcIdentityResolver(jdbcTemplate))
            .perform(get("/probe").header(IdentityFilter.HEADER, "bogus:short"))
            .andExpect(status().isOk)
            .andExpect(content().string("anonymous"))

        verifyNoInteractions(jdbcTemplate)
    }

    @Test
    fun optionsSkipsIdentityResolution() {
        val jdbcTemplate = mock(JdbcTemplate::class.java)

        mvc(JdbcIdentityResolver(jdbcTemplate))
            .perform(options("/probe").header(IdentityFilter.HEADER, "web_local:valid-identity-key-123456"))
            .andExpect(status().isOk)

        verifyNoInteractions(jdbcTemplate)
    }

    private fun mvc(resolver: IdentityResolver): MockMvc {
        val builder = MockMvcBuilders.standaloneSetup(ProbeController())
        builder.addFilters<StandaloneMockMvcBuilder>(IdentityFilter(resolver, ObjectMapper()))
        return builder.build()
    }

    @RestController
    private class ProbeController {
        @GetMapping("/probe")
        fun probe(request: HttpServletRequest): ResponseEntity<String> = ResponseEntity.ok(
            if (IdentityFilter.appUserId(request) == null) "anonymous" else "identified"
        )
    }
}
