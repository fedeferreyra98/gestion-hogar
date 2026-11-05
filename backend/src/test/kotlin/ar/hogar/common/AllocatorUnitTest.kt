package ar.hogar.common

import java.math.BigDecimal
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AllocatorUnitTest {
    private fun w(vararg values: Long) = values.mapIndexed { i, v -> "m$i" to BigDecimal.valueOf(v) }

    @Test
    fun `100 split in three equal weights gives 34-33-33`() {
        val result = Allocator.allocate(100, w(1, 1, 1))
        assertEquals(listOf(34L, 33L, 33L), result.values.toList())
    }

    @Test
    fun `sum is exact for random inputs`() {
        val rnd = Random(42)
        repeat(500) {
            val total = rnd.nextLong(0, 10_000_000)
            val weights =
                List(rnd.nextInt(1, 8)) {
                    "id$it" to
                        BigDecimal(rnd.nextInt(0, 1000)).movePointLeft(rnd.nextInt(0, 3))
                }
            if (weights.sumOf { it.second }.signum() == 0) return@repeat
            val result = Allocator.allocate(total, weights)
            assertEquals(total, result.values.sum())
        }
    }

    @Test
    fun `each part is within one unit of its exact share`() {
        val rnd = Random(7)
        repeat(200) {
            val total = rnd.nextLong(0, 1_000_000)
            val weights = List(rnd.nextInt(1, 6)) { "id$it" to BigDecimal(rnd.nextInt(1, 500)) }
            val sumW = weights.sumOf { it.second }
            val result = Allocator.allocate(total, weights)
            weights.forEach { (id, wi) ->
                val exact = BigDecimal(total).multiply(wi).divide(sumW, 20, java.math.RoundingMode.HALF_EVEN)
                assert(
                    (BigDecimal(result.getValue(id)) - exact).abs() < BigDecimal.ONE,
                ) { "part for $id too far from $exact" }
            }
        }
    }

    @Test
    fun `same input gives same output`() {
        val weights = w(3, 3, 5, 0, 7)
        assertEquals(Allocator.allocate(1001, weights), Allocator.allocate(1001, weights))
    }

    @Test
    fun `zero weight member gets zero`() {
        val result = Allocator.allocate(100, w(0, 1, 1))
        assertEquals(listOf(0L, 50L, 50L), result.values.toList())
    }

    @Test
    fun `zero total gives all zeros`() {
        assertEquals(listOf(0L, 0L), Allocator.allocate(0, w(2, 3)).values.toList())
    }

    @Test
    fun `ties on the remainder are broken by input order`() {
        val result = Allocator.allocate(2, w(1, 1, 1))
        assertEquals(listOf(1L, 1L, 0L), result.values.toList())
    }

    @Test
    fun `a tie on the fractional part leaves the extra unit to the first entry`() {
        // exact 2.5 / 2.5 / 5.0 -> floors 2/2/5, one unit left; the tie on .5 goes to the first
        val result = Allocator.allocate(10, w(1, 1, 2))
        assertEquals(listOf(3L, 2L, 5L), result.values.toList())
    }

    @Test
    fun `decimal weights are supported and income-like weights split 10000`() {
        val weights = listOf("a" to BigDecimal("1500.50"), "b" to BigDecimal("2500.25"))
        val result = Allocator.allocate(10_000, weights)
        assertEquals(10_000L, result.values.sum())
        // exact 3750.55 -> rounded up by largest remainder
        assertEquals(3751L, result.getValue("a"))
    }

    @Test
    fun `large totals do not overflow`() {
        val result = Allocator.allocate(Long.MAX_VALUE, w(1, 1))
        assertEquals(Long.MAX_VALUE, result.values.sum())
    }

    @Test
    fun `invalid inputs are rejected`() {
        assertFailsWith<IllegalArgumentException> { Allocator.allocate(100, emptyList<Pair<String, BigDecimal>>()) }
        assertFailsWith<IllegalArgumentException> { Allocator.allocate(100, w(0, 0)) }
        assertFailsWith<IllegalArgumentException> { Allocator.allocate(100, w(1, -1)) }
        assertFailsWith<IllegalArgumentException> { Allocator.allocate(-1, w(1, 1)) }
        assertFailsWith<IllegalArgumentException> {
            Allocator.allocate(10, listOf("x" to BigDecimal.ONE, "x" to BigDecimal.ONE))
        }
    }
}
