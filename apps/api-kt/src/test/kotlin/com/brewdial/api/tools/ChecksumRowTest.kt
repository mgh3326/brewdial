package com.brewdial.api.tools

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test

class ChecksumRowTest {
    @Test
    fun aValueCannotImitateAColumnBoundary() {
        assertNotEquals(checksumRow(listOf("x\u001fy", "z")), checksumRow(listOf("x", "y\u001fz")))
        assertNotEquals(checksumRow(listOf("ab", "c")), checksumRow(listOf("a", "bc")))
        assertNotEquals(checksumRow(listOf("1:a", "b")), checksumRow(listOf("1", "a1:b")))
    }

    @Test
    fun aValueCannotImitateNull() {
        assertNotEquals(checksumRow(listOf(null, "a")), checksumRow(listOf("∅", "a")))
        assertNotEquals(checksumRow(listOf(null, "a")), checksumRow(listOf("-:", "a")))
        assertNotEquals(checksumRow(listOf(null)), checksumRow(listOf("")))
    }

    @Test
    fun aValueCannotImitateARowBoundary() {
        val oneRow = checksumRow(listOf("a\nb"))
        val twoRows = checksumRow(listOf("a")) + checksumRow(listOf("b"))
        assertNotEquals(oneRow, twoRows)
    }

    @Test
    fun equalValuesEncodeTheSame() {
        assertEquals(checksumRow(listOf("커피", null, "")), checksumRow(listOf("커피", null, "")))
    }
}
