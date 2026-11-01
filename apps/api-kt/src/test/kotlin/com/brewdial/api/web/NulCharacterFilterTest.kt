package com.brewdial.api.web

import jakarta.servlet.http.HttpServletRequest
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RestController

private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

class NulCharacterFilterTest {
    @RestController
    private class EchoController {
        // Answers with the bytes the handler received, so a response charset cannot hide a change.
        @PostMapping("/echo")
        fun post(request: HttpServletRequest): String = hex(request.inputStream.readAllBytes())

        @PostMapping("/echo-reader")
        fun reader(request: HttpServletRequest): String = hex(request.reader.readText().toByteArray())

        @PutMapping("/echo")
        fun put(request: HttpServletRequest): String = hex(request.inputStream.readAllBytes())

        @GetMapping("/echo")
        fun get() = "read"
    }

    private val mvc: MockMvc = MockMvcBuilders.standaloneSetup(EchoController()).addFilters<org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder>(NulCharacterFilter()).build()

    private fun refused(body: ByteArray) {
        mvc.perform(put("/echo").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest)
            .andExpect(content().json("""{"error":"invalid body"}"""))
    }

    private fun echoed(body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        mvc.perform(post("/echo").contentType(MediaType.APPLICATION_JSON).content(bytes))
            .andExpect(status().isOk)
            .andExpect(content().string(hex(bytes)))
        mvc.perform(post("/echo-reader").characterEncoding("UTF-8").contentType(MediaType.APPLICATION_JSON).content(bytes))
            .andExpect(status().isOk)
            .andExpect(content().string(hex(bytes)))
    }

    @Test
    fun aJsonEscapedNulCharacterIsRefused() {
        refused("""{"label":"a\u0000b"}""".toByteArray())
        refused("""{"details":{"nested":["\u0000"]}}""".toByteArray())
    }

    @Test
    fun anEscapedBackslashBeforeTheEscapeDoesNotHideIt() {
        // JSON text \\\u0000 is one literal backslash, then a real NUL.
        refused("{\"label\":\"a\\\\\\u0000b\"}".toByteArray())
    }

    @Test
    fun aRawNulByteIsRefused() {
        refused(byteArrayOf('{'.code.toByte(), 0, '}'.code.toByte()))
    }

    @Test
    fun ordinaryBodiesReachTheHandlerUnchanged() {
        echoed("""{"label":"로빈 커피","note":"line\nbreak"}""")
        echoed("{}")
    }

    @Test
    fun theLiteralTextOfAnEscapeIsNotANulCharacter() {
        // JSON text \\u0000 is a backslash followed by the letters u0000.
        echoed("{\"label\":\"a\\\\u0000b\"}")
    }

    @Test
    fun aBodyOverTheLimitIsRefusedBeforeTheHandler() {
        mvc.perform(post("/echo").contentType(MediaType.APPLICATION_JSON).content(ByteArray(NulCharacterFilter.MAX_BODY_BYTES + 1) { 'x'.code.toByte() }))
            .andExpect(status().isPayloadTooLarge)
            .andExpect(content().json("""{"error":"body too large"}"""))
    }

    @Test
    fun aBodyAtTheLimitReachesTheHandlerUnchanged() {
        val body = ByteArray(NulCharacterFilter.MAX_BODY_BYTES) { 'x'.code.toByte() }
        mvc.perform(post("/echo").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk)
            .andExpect(content().string(hex(body)))
    }

    @Test
    fun readsAreNotInspected() {
        mvc.perform(get("/echo")).andExpect(status().isOk).andExpect(content().string("read"))
    }
}
