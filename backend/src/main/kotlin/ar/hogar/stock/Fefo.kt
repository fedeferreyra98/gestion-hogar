package ar.hogar.stock

import ar.hogar.common.BusinessRuleException
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class FefoLot(
    val id: UUID,
    val expiryDate: LocalDate?,
    val addedAt: Instant,
    val quantity: BigDecimal,
)

/** Cuánto se toma de un lote; [depleted] = el lote queda en 0 (pasa a `CONSUMED`). */
data class FefoAllocation(
    val lotId: UUID,
    val quantity: BigDecimal,
    val depleted: Boolean,
)

/** FEFO (docs/03 §Stock): vence antes primero, los sin vencimiento al final, desempate por `addedAt` e id. */
object Fefo {
    private val order =
        compareBy<FefoLot, LocalDate?>(nullsLast()) { it.expiryDate }
            .thenBy { it.addedAt }
            .thenBy { it.id }

    /** Función pura: no muta nada. Lanza `INSUFFICIENT_STOCK` (422) si los lotes no cubren [requested]. */
    fun allocate(
        lots: List<FefoLot>,
        requested: BigDecimal,
    ): List<FefoAllocation> {
        require(requested.signum() > 0) { "requested must be > 0" }
        var remaining = requested
        val result = mutableListOf<FefoAllocation>()
        for (lot in lots.filter { it.quantity.signum() > 0 }.sortedWith(order)) {
            if (remaining.signum() == 0) break
            val take = lot.quantity.min(remaining)
            result += FefoAllocation(lot.id, take, take.compareTo(lot.quantity) == 0)
            remaining -= take
        }
        if (remaining.signum() > 0) {
            throw BusinessRuleException("INSUFFICIENT_STOCK", "Not enough stock to consume $requested")
        }
        return result
    }
}

object ExpiryPolicy {
    /** `hoy` debe estar calculado en la zona del hogar. */
    fun statusOf(
        expiryDate: LocalDate?,
        today: LocalDate,
        warningDays: Int,
    ): ExpiryStatus =
        when {
            expiryDate == null -> ExpiryStatus.NO_EXPIRY
            expiryDate.isBefore(today) -> ExpiryStatus.EXPIRED
            !expiryDate.isAfter(today.plusDays(warningDays.toLong())) -> ExpiryStatus.EXPIRING_SOON
            else -> ExpiryStatus.OK
        }
}
