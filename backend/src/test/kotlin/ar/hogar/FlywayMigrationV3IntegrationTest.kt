package ar.hogar

import org.junit.jupiter.api.Test
import org.springframework.dao.DataIntegrityViolationException
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FlywayMigrationV3IntegrationTest : IntegrationTestBase() {
    private val household = UUID.randomUUID()
    private val member = UUID.randomUUID()
    private val product = UUID.randomUUID()

    private fun seed() {
        jdbc.update(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Casa mock', now(), now())",
            household,
        )
        jdbc.update(
            "INSERT INTO member (id, household_id, email, password_hash, display_name, role, created_at, updated_at) " +
                "VALUES (?, ?, 'm@example.test', 'x', 'Mock', 'OWNER', now(), now())",
            member,
            household,
        )
        jdbc.update(
            "INSERT INTO product (id, household_id, name, default_unit, created_at, updated_at) " +
                "VALUES (?, ?, 'Leche', 'L', now(), now())",
            product,
            household,
        )
    }

    private fun list(status: String = "OPEN"): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO shopping_list (id, household_id, name, status, created_by, created_at, updated_at) " +
                    "VALUES (?, ?, 'L', ?, ?, now(), now())",
                it,
                household,
                status,
                member,
            )
        }

    private fun item(
        list: UUID,
        qty: String = "1",
        unit: String = "L",
    ) = jdbc.update(
        "INSERT INTO shopping_list_item (id, list_id, product_id, quantity, unit, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?::numeric, ?, now(), now())",
        UUID.randomUUID(),
        list,
        product,
        qty,
        unit,
    )

    @Test
    fun `status and item constraints`() {
        seed()
        assertFailsWith<DataIntegrityViolationException> { list("DONE") }
        val l = list()
        assertFailsWith<DataIntegrityViolationException> { item(l, qty = "0") }
        assertFailsWith<DataIntegrityViolationException> { item(l, unit = "BOX") }
        item(l)
        assertFailsWith<DataIntegrityViolationException> { item(l) } // UNIQUE(list, product, unit)
        item(l, unit = "KG")
    }

    @Test
    fun `deleting a list cascades to its items`() {
        seed()
        val l = list()
        item(l)
        jdbc.update("DELETE FROM shopping_list WHERE id = ?", l)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM shopping_list_item", Int::class.java))
    }

    @Test
    fun `estimated price needs amount and currency together`() {
        seed()
        val l = list()
        assertFailsWith<DataIntegrityViolationException> {
            jdbc.update(
                "INSERT INTO shopping_list_item (id, list_id, product_id, quantity, unit, estimated_price_minor, " +
                    "created_at, updated_at) VALUES (?, ?, ?, 1, 'L', 100, now(), now())",
                UUID.randomUUID(),
                l,
                product,
            )
        }
    }
}
