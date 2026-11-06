package ar.hogar

import org.junit.jupiter.api.Test
import org.springframework.dao.DataIntegrityViolationException
import java.util.UUID
import kotlin.test.assertFailsWith

class FlywayMigrationV4IntegrationTest : IntegrationTestBase() {
    private val household = UUID.randomUUID()
    private val product = UUID.randomUUID()
    private val member = UUID.randomUUID()

    private fun seed() {
        jdbc.update(
            "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Casa mock', now(), now())",
            household,
        )
        jdbc.update(
            "INSERT INTO product (id, household_id, name, default_unit, created_at, updated_at) " +
                "VALUES (?, ?, 'Leche', 'L', now(), now())",
            product,
            household,
        )
        jdbc.update(
            "INSERT INTO member (id, household_id, email, password_hash, display_name, role, created_at, updated_at) " +
                "VALUES (?, ?, 'm@example.test', 'x', 'M', 'OWNER', now(), now())", // allow-secret: dato mock
            member,
            household,
        )
    }

    private fun item(
        quantity: String = "1",
        initial: String = "1",
        unit: String = "L",
        status: String = "ACTIVE",
    ) = jdbc.update(
        "INSERT INTO stock_item " +
            "(id, household_id, product_id, quantity, initial_quantity, unit, status, added_at, updated_at) " +
            "VALUES (?, ?, ?, ?::numeric, ?::numeric, ?, ?, now(), now())",
        UUID.randomUUID(),
        household,
        product,
        quantity,
        initial,
        unit,
        status,
    )

    @Test
    fun `stock_item constraints`() {
        seed()
        item()
        item(quantity = "0", status = "CONSUMED")
        item(quantity = "2", status = "DISCARDED")
        assertFailsWith<DataIntegrityViolationException> { item(quantity = "-1") }
        assertFailsWith<DataIntegrityViolationException> { item(initial = "0") }
        assertFailsWith<DataIntegrityViolationException> { item(unit = "BOX") }
        assertFailsWith<DataIntegrityViolationException> { item(status = "LOST") }
        assertFailsWith<DataIntegrityViolationException> { item(quantity = "0", status = "ACTIVE") }
        assertFailsWith<DataIntegrityViolationException> { item(quantity = "1", status = "CONSUMED") }
    }

    @Test
    fun `stock_movement type check and foreign keys`() {
        seed()
        item()
        val itemId = jdbc.queryForObject("SELECT id FROM stock_item LIMIT 1", UUID::class.java)

        fun movement(
            type: String,
            by: UUID = member,
        ) = jdbc.update(
            "INSERT INTO stock_movement (id, stock_item_id, type, quantity, created_by, created_at) VALUES (?, ?, ?, -1, ?, now())",
            UUID.randomUUID(),
            itemId,
            type,
            by,
        )
        movement("ADJUST")
        assertFailsWith<DataIntegrityViolationException> { movement("MOVE") }
        assertFailsWith<DataIntegrityViolationException> { movement("IN", by = UUID.randomUUID()) }
    }
}
