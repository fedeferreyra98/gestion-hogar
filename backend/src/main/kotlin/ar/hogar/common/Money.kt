package ar.hogar.common

import java.util.Currency

/** Monto en unidades menores (centavos) + moneda. Nunca usa floats (ADR-004). */
data class Money(
    val amountMinor: Long,
    val currency: Currency,
) : Comparable<Money> {
    operator fun plus(other: Money): Money {
        requireSameCurrency(other)
        return Money(Math.addExact(amountMinor, other.amountMinor), currency)
    }

    operator fun minus(other: Money): Money {
        requireSameCurrency(other)
        return Money(Math.subtractExact(amountMinor, other.amountMinor), currency)
    }

    operator fun unaryMinus(): Money = Money(Math.negateExact(amountMinor), currency)

    override operator fun compareTo(other: Money): Int {
        requireSameCurrency(other)
        return amountMinor.compareTo(other.amountMinor)
    }

    val isZero: Boolean get() = amountMinor == 0L
    val isNegative: Boolean get() = amountMinor < 0L

    private fun requireSameCurrency(other: Money) {
        require(currency == other.currency) {
            "Currency mismatch: ${currency.currencyCode} vs ${other.currency.currencyCode}"
        }
    }

    companion object {
        fun of(
            amountMinor: Long,
            currencyCode: String,
        ): Money = Money(amountMinor, currencyOf(currencyCode))

        fun zero(currency: Currency): Money = Money(0, currency)

        /** Parsea un código ISO 4217; un código inválido es un error de validación (400). */
        fun currencyOf(currencyCode: String): Currency =
            try {
                Currency.getInstance(currencyCode)
            } catch (e: IllegalArgumentException) {
                throw ValidationException(
                    "Invalid currency code",
                    listOf(FieldError("currency", "must be a valid ISO 4217 code")),
                )
            }
    }
}
