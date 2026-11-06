package ar.hogar

import org.junit.jupiter.api.Test
import org.springframework.dao.DataIntegrityViolationException
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FlywayMigrationV2IntegrationTest : IntegrationTestBase() {
    private fun household(): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Casa mock', now(), now())",
                it,
            )
        }

    private fun category(
        h: UUID,
        name: String,
    ): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO category (id, household_id, name, created_at, updated_at) VALUES (?, ?, ?, now(), now())",
                it,
                h,
                name,
            )
        }

    private fun product(
        h: UUID,
        name: String,
        unit: String = "UNIT",
        shelfLife: Int? = null,
        categoryId: UUID? = null,
    ) = jdbc.update(
        "INSERT INTO product " +
            "(id, household_id, name, category_id, default_unit, default_shelf_life_days, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, now(), now())",
        UUID.randomUUID(),
        h,
        name,
        categoryId,
        unit,
        shelfLife,
    )

    @Test
    fun `category and product names are unique per household ignoring case`() {
        val h1 = household()
        val h2 = household()
        category(h1, "Lácteos")
        assertFailsWith<DataIntegrityViolationException> { category(h1, "lácteos") }
        category(h2, "Lácteos")

        product(h1, "Leche")
        assertFailsWith<DataIntegrityViolationException> { product(h1, "LECHE") }
        product(h2, "Leche")
    }

    @Test
    fun `product constraints on unit and shelf life`() {
        val h = household()
        assertFailsWith<DataIntegrityViolationException> { product(h, "A", unit = "BOX") }
        assertFailsWith<DataIntegrityViolationException> { product(h, "B", shelfLife = -1) }
        product(h, "C", unit = "PACK", shelfLife = 0)
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM product", Int::class.java))
    }

    @Test
    fun `category with products cannot be deleted at the database level`() {
        val h = household()
        val c = category(h, "Lácteos")
        product(h, "Leche", categoryId = c)
        assertFailsWith<DataIntegrityViolationException> { jdbc.update("DELETE FROM category WHERE id = ?", c) }
    }
}
