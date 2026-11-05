package ar.hogar.common

import java.util.Currency
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class MoneyUnitTest {
    private val ars = Currency.getInstance("ARS")
    private val usd = Currency.getInstance("USD")

    @Test
    fun `adds and subtracts in minor units`() {
        assertEquals(Money(150_050, ars), Money(100_000, ars) + Money(50_050, ars))
        assertEquals(Money(-5, ars), Money(10, ars) - Money(15, ars))
        assertEquals(Money(-10, ars), -Money(10, ars))
    }

    @Test
    fun `rejects operations across currencies`() {
        assertFailsWith<IllegalArgumentException> { Money(1, ars) + Money(1, usd) }
        assertFailsWith<IllegalArgumentException> { Money(1, ars) - Money(1, usd) }
        assertFailsWith<IllegalArgumentException> { Money(1, ars) < Money(1, usd) }
    }

    @Test
    fun `overflow throws instead of wrapping`() {
        assertFailsWith<ArithmeticException> { Money(Long.MAX_VALUE, ars) + Money(1, ars) }
    }

    @Test
    fun `compares and flags zero and negative`() {
        assertTrue(Money(1, ars) < Money(2, ars))
        assertTrue(Money.zero(ars).isZero)
        assertTrue(Money(-1, ars).isNegative)
    }

    @Test
    fun `of parses ISO code and rejects invalid ones with a validation error`() {
        assertEquals(Money(100, ars), Money.of(100, "ARS"))
        assertFailsWith<ValidationException> { Money.of(100, "XX") }
    }

    @Test
    fun `currency policy accepts only the base currency`() {
        val policy = CurrencyPolicy(ars)
        policy.requireSupported(Money(1, ars))
        val ex = assertFailsWith<BusinessRuleException> { policy.requireSupported(usd) }
        assertEquals("UNSUPPORTED_CURRENCY", ex.code)
    }
}
