package ar.hogar.common

import java.util.Currency

/**
 * Única validación de moneda soportada (ADR-004). MVP: solo la moneda base del hogar.
 * Para habilitar multimoneda (fase 3) basta ampliar esta política.
 */
class CurrencyPolicy(
    val baseCurrency: Currency,
) {
    fun isSupported(currency: Currency): Boolean = currency == baseCurrency

    fun requireSupported(currency: Currency) {
        if (!isSupported(currency)) {
            throw BusinessRuleException(
                code = "UNSUPPORTED_CURRENCY",
                message = "Currency ${currency.currencyCode} is not supported; use ${baseCurrency.currencyCode}",
            )
        }
    }

    fun requireSupported(money: Money) = requireSupported(money.currency)
}
