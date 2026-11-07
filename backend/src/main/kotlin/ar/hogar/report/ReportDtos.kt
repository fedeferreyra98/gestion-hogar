package ar.hogar.report

import ar.hogar.expense.MoneyDto
import java.time.LocalDate

/** Una fila por (grupo, moneda): los totales de monedas distintas nunca se mezclan. */
data class SummaryRowDto(
    val key: String,
    val label: String,
    val total: MoneyDto,
)

data class PricePointDto(
    val date: LocalDate,
    val store: String?,
    val unitPrice: MoneyDto,
)

enum class SummaryGroupBy(
    val param: String,
) {
    MONTH("month"),
    CATEGORY("category"),
    STORE("store"),
    ;

    companion object {
        fun parse(value: String): SummaryGroupBy? = entries.firstOrNull { it.param == value }
    }
}
