package com.brewdial.api.bean

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.util.UUID

@SpringBootTest
class SchemaValidateTest {
    @Autowired
    private lateinit var beanRepository: BeanRepository

    @Test
    fun validatesSchemaAndRoundTripsOneSelfCleaningBean() {
        val id = UUID.randomUUID().toString()
        val bean = Bean().apply {
            this.id = id
            name = "kt-p0-${UUID.randomUUID()}"
            roaster = "kt-p0"
            roastLevelOrd = 2
            acidity = 3
            body = 4
            agtronMin = 55
            agtronMax = 65
            decaf = false
            flavorCategories = listOf("fruity", "floral")
        }

        try {
            beanRepository.saveAndFlush(bean)
            val loaded = beanRepository.findById(id)

            assertTrue(loaded.isPresent)
            assertEquals(id, loaded.get().id)
            assertEquals(bean.name, loaded.get().name)
        } finally {
            beanRepository.findById(id).ifPresent {
                beanRepository.delete(it)
                beanRepository.flush()
            }
        }
    }
}
