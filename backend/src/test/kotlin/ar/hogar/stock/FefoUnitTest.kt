package ar.hogar.stock

import ar.hogar.common.BusinessRuleException
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class FefoUnitTest {
    private val t0 = Instant.parse("2026-01-01T00:00:00Z")

    private fun lot(
        qty: String,
        expiry: String? = null,
        addedMinutes: Long = 0,
        id: UUID = UUID.randomUUID(),
    ) = FefoLot(id, expiry?.let(LocalDate::parse), t0.plusSeconds(60 * addedMinutes), BigDecimal(qty))

    private fun q(s: String) = BigDecimal(s)

    @Test
    fun `consumes the earliest expiring lot first`() {
        val late = lot("5", "2026-03-01")
        val soon = lot("5", "2026-02-01")
        val result = Fefo.allocate(listOf(late, soon), q("2"))
        assertEquals(listOf(soon.id), result.map { it.lotId })
        assertEquals(q("2"), result.single().quantity)
        assertEquals(false, result.single().depleted)
    }

    @Test
    fun `lots without expiry go last even if added first`() {
        val noExpiry = lot("5", null, addedMinutes = 0)
        val dated = lot("5", "2030-01-01", addedMinutes = 10)
        val result = Fefo.allocate(listOf(noExpiry, dated), q("7"))
        assertEquals(listOf(dated.id, noExpiry.id), result.map { it.lotId })
        assertEquals(listOf(q("5"), q("2")), result.map { it.quantity })
    }

    @Test
    fun `ties on expiry break by added_at and null expiries by added_at`() {
        val newer = lot("1", "2026-02-01", addedMinutes = 5)
        val older = lot("1", "2026-02-01", addedMinutes = 1)
        assertEquals(listOf(older.id, newer.id), Fefo.allocate(listOf(newer, older), q("2")).map { it.lotId })

        val n2 = lot("1", null, addedMinutes = 9)
        val n1 = lot("1", null, addedMinutes = 2)
        assertEquals(listOf(n1.id, n2.id), Fefo.allocate(listOf(n2, n1), q("2")).map { it.lotId })
    }

    @Test
    fun `consumption spans several lots and flags depleted ones`() {
        val a = lot("2", "2026-02-01")
        val b = lot("3", "2026-02-10")
        val c = lot("4", "2026-02-20")
        val noExp = lot("10", null)
        val result = Fefo.allocate(listOf(noExp, c, b, a), q("6.500"))
        assertEquals(listOf(a.id, b.id, c.id), result.map { it.lotId })
        assertEquals(listOf(q("2"), q("3"), q("1.500")), result.map { it.quantity })
        assertEquals(listOf(true, true, false), result.map { it.depleted })
        assertEquals(q("6.500"), result.fold(BigDecimal.ZERO) { acc, x -> acc + x.quantity })
    }

    @Test
    fun `exact total empties every lot`() {
        val result = Fefo.allocate(listOf(lot("1.250", "2026-02-01"), lot("0.750", null)), q("2.000"))
        assertTrue(result.all { it.depleted })
    }

    @Test
    fun `insufficient stock throws INSUFFICIENT_STOCK`() {
        val ex =
            assertFailsWith<BusinessRuleException> {
                Fefo.allocate(listOf(lot("1", "2026-02-01"), lot("1", null)), q("2.001"))
            }
        assertEquals("INSUFFICIENT_STOCK", ex.code)
        assertFailsWith<BusinessRuleException> { Fefo.allocate(emptyList(), q("1")) }
    }

    @Test
    fun `empty lots are ignored and input is not mutated`() {
        val empty = lot("0", "2026-01-01")
        val ok = lot("1", "2026-05-01")
        val input = listOf(ok, empty)
        assertEquals(listOf(ok.id), Fefo.allocate(input, q("1")).map { it.lotId })
        assertEquals(listOf(ok, empty), input)
    }
}
