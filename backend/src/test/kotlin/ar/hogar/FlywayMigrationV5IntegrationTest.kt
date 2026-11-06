package ar.hogar

import org.junit.jupiter.api.Test
import org.springframework.dao.DataIntegrityViolationException
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class FlywayMigrationV5IntegrationTest : IntegrationTestBase() {
    private fun household(): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO household (id, name, created_at, updated_at) VALUES (?, 'Casa mock', now(), now())",
                it,
            )
        }

    private fun member(h: UUID): UUID =
        UUID.randomUUID().also {
            jdbc.update(
                "INSERT INTO member " +
                    "(id, household_id, email, password_hash, display_name, role, created_at, updated_at) " +
                    "VALUES (?, ?, ?, 'x', 'Mock', 'OWNER', now(), now())",
                it,
                h,
                "$it@example.test",
            )
        }

    private fun expense(
        h: UUID,
        m: UUID,
        amount: Long = 100,
        source: String = "MANUAL",
        shared: Boolean = false,
        splitMode: String? = null,
    ) = jdbc.update(
        "INSERT INTO expense (id, household_id, description, amount_minor, currency, expense_date, paid_by, " +
            "source, shared, split_mode, created_by, created_at, updated_at) " +
            "VALUES (?, ?, 'Luz', ?, 'ARS', current_date, ?, ?, ?, ?, ?, now(), now())",
        UUID.randomUUID(),
        h,
        amount,
        m,
        source,
        shared,
        splitMode,
        m,
    )

    @Test
    fun `expense constraints on amount source and split mode`() {
        val h = household()
        val m = member(h)
        expense(h, m)
        expense(h, m, source = "PURCHASE", shared = true, splitMode = "EQUAL")
        assertFailsWith<DataIntegrityViolationException> { expense(h, m, amount = 0) }
        assertFailsWith<DataIntegrityViolationException> { expense(h, m, source = "OTHER") }
        assertFailsWith<DataIntegrityViolationException> { expense(h, m, shared = true, splitMode = "BAD") }
        assertFailsWith<DataIntegrityViolationException> { expense(h, m, shared = false, splitMode = "EQUAL") }
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM expense", Int::class.java))
    }

    @Test
    fun `expense indexes exist`() {
        val indexes =
            jdbc.queryForList("SELECT indexdef FROM pg_indexes WHERE tablename = 'expense'", String::class.java)
        assertTrue(indexes.any { it.contains("(household_id, expense_date DESC)") }, "$indexes")
        assertTrue(indexes.any { it.contains("(category_id)") }, "$indexes")
    }
}
