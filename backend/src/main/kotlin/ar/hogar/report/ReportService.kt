package ar.hogar.report

import ar.hogar.catalog.ProductRepository
import ar.hogar.common.FieldError
import ar.hogar.common.NotFoundException
import ar.hogar.common.ValidationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.LocalDate
import java.util.UUID

/**
 * UC-23: resumen de gastos y evolución de precios. Las fechas son fechas de calendario
 * (`DATE`, ya expresadas en la zona del hogar al cargarlas), por eso el agrupado por mes no necesita conversión de zona.
 */
@Service
class ReportService(
    private val reports: ReportRepository,
    private val products: ProductRepository,
) {
    @Transactional(readOnly = true)
    fun summary(
        householdId: UUID,
        from: LocalDate?,
        to: LocalDate?,
        groupBy: String,
    ): List<SummaryRowDto> {
        val group =
            SummaryGroupBy.parse(groupBy)
                ?: throw ValidationException(
                    "Invalid groupBy",
                    listOf(FieldError("groupBy", "must be one of month, category, store")),
                )
        requireRange(from, to)
        return reports.summary(householdId, from, to, group)
    }

    @Transactional(readOnly = true)
    fun priceHistory(
        householdId: UUID,
        productId: UUID,
        from: LocalDate?,
        to: LocalDate?,
    ): List<PricePointDto> {
        products.findById(productId).orElse(null)?.takeIf { it.householdId == householdId }
            ?: throw NotFoundException("Product not found")
        requireRange(from, to)
        return reports.priceHistory(householdId, productId, from, to)
    }

    private fun requireRange(
        from: LocalDate?,
        to: LocalDate?,
    ) {
        if (from != null && to != null && from.isAfter(to)) {
            throw ValidationException("Invalid range", listOf(FieldError("from", "must not be after to")))
        }
    }
}
