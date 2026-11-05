package ar.hogar

import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestMethodOrder
import java.util.UUID
import kotlin.test.assertEquals

@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class CleanDatabaseIntegrationTest : IntegrationTestBase() {
    private fun households() = jdbc.queryForObject("SELECT count(*) FROM household", Long::class.java)

    @Test
    @Order(1)
    fun `writes data`() {
        jdbc.update(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Casa mock', now(), now())",
            UUID.randomUUID(),
        )
        assertEquals(1L, households())
    }

    @Test
    @Order(2)
    fun `next test starts with empty tables but keeps flyway history`() {
        assertEquals(0L, households())
        assertEquals(
            true,
            jdbc.queryForObject("SELECT count(*) > 0 FROM flyway_schema_history", Boolean::class.java),
        )
    }
}
