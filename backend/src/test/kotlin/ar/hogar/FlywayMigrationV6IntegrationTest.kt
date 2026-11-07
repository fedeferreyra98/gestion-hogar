package ar.hogar

import org.junit.jupiter.api.Test
import org.springframework.dao.DataIntegrityViolationException
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FlywayMigrationV6IntegrationTest : IntegrationTestBase() {
    private val h = UUID.randomUUID()
    private val m = UUID.randomUUID()

    private fun seed(): Pair<UUID, UUID> {
        jdbc.update("INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Casa mock', now(), now())", h)
        jdbc.update(
            "INSERT INTO member (id, household_id, email, password_hash, display_name, role, created_at, updated_at) " +
                "VALUES (?, ?, 'm@example.test', 'x', 'Mock', 'OWNER', now(), now())",
            m,
            h,
        )
        val expense = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO expense (id, household_id, description, amount_minor, currency, expense_date, paid_by, " +
                "source, created_by, created_at, updated_at) " +
                "VALUES (?, ?, 'Compra', 100, 'ARS', current_date, ?, 'PURCHASE', ?, now(), now())",
            expense,
            h,
            m,
            m,
        )
        val product = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO product (id, household_id, name, default_unit, created_at, updated_at) " +
                "VALUES (?, ?, 'Pan', 'UNIT', now(), now())",
            product,
            h,
        )
        return expense to product
    }

    private fun purchase(
        expense: UUID,
        total: Long = 100,
        list: UUID? = null,
    ): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO purchase (id, household_id, shopping_list_id, purchase_date, total_minor, currency, " +
                    "paid_by, expense_id, created_by, created_at, updated_at) " +
                    "VALUES (?, ?, ?, current_date, ?, 'ARS', ?, ?, ?, now(), now())",
                it,
                h,
                list,
                total,
                m,
                expense,
                m,
            )
        }

    private fun item(
        purchase: UUID,
        product: UUID,
        qty: String = "1",
        unit: String = "UNIT",
    ): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO purchase_item " +
                    "(id, purchase_id, position, product_id, quantity, unit, unit_price_minor, total_minor) " +
                    "VALUES (?, ?, 0, ?, ?::numeric, ?, 100, 100)",
                it,
                purchase,
                product,
                qty,
                unit,
            )
        }

    private fun stock(
        product: UUID,
        purchaseItem: UUID?,
    ) = jdbc.update(
        "INSERT INTO stock_item (id, household_id, product_id, quantity, initial_quantity, unit, purchase_item_id, " +
            "added_at, updated_at) VALUES (?, ?, ?, 1, 1, 'UNIT', ?, now(), now())",
        UUID.randomUUID(),
        h,
        product,
        purchaseItem,
    )

    @Test
    fun `purchase constraints`() {
        val (expense, _) = seed()
        assertFailsWith<DataIntegrityViolationException> { purchase(expense, total = 0) }
        val p = purchase(expense)
        // un gasto pertenece a una sola compra
        assertFailsWith<DataIntegrityViolationException> { purchase(expense) }
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM purchase WHERE id = ?", Long::class.java, p))
    }

    @Test
    fun `purchase_item constraints and cascade`() {
        val (expense, product) = seed()
        val p = purchase(expense)
        item(p, product)
        assertFailsWith<DataIntegrityViolationException> { item(p, product, qty = "0") }
        assertFailsWith<DataIntegrityViolationException> { item(p, product, unit = "BAD") }
        jdbc.update("DELETE FROM purchase WHERE id = ?", p)
        assertEquals(0L, jdbc.queryForObject("SELECT count(*) FROM purchase_item", Long::class.java))
    }

    @Test
    fun `stock_item purchase_item_id is a foreign key that is nulled when the item goes away`() {
        val (expense, product) = seed()
        val p = purchase(expense)
        val pi = item(p, product)
        assertFailsWith<DataIntegrityViolationException> { stock(product, UUID.randomUUID()) }
        stock(product, pi)
        stock(product, null)
        jdbc.update("DELETE FROM purchase_item WHERE id = ?", pi)
        assertEquals(
            2L,
            jdbc.queryForObject("SELECT count(*) FROM stock_item WHERE purchase_item_id IS NULL", Long::class.java),
        )
    }
}
