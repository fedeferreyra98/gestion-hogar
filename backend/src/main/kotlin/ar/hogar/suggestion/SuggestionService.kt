package ar.hogar.suggestion

import ar.hogar.auth.HouseholdRepository
import ar.hogar.catalog.Unit
import ar.hogar.common.NotFoundException
import ar.hogar.shopping.ShoppingListRepository
import ar.hogar.stock.ProductRefDto
import com.fasterxml.jackson.annotation.JsonInclude
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

enum class SuggestionReason { OUT_OF_STOCK, EXPIRING, EXPIRED }

@JsonInclude(JsonInclude.Include.NON_NULL)
data class SuggestionDto(
    val product: ProductRefDto,
    val reason: SuggestionReason,
    val defaultUnit: Unit,
    val detail: String? = null,
)

/** UC-12. "Hoy" se calcula con el [Clock] inyectado en la zona horaria del hogar. */
@Service
class SuggestionService(
    private val repo: SuggestionRepository,
    private val lists: ShoppingListRepository,
    private val households: HouseholdRepository,
    private val clock: Clock,
) {
    private companion object {
        const val MAX_RESULTS = 50
    }

    @Transactional(readOnly = true)
    fun suggest(
        householdId: UUID,
        listId: UUID,
    ): List<SuggestionDto> {
        lists.findById(listId).orElse(null)?.takeIf { it.householdId == householdId }
            ?: throw NotFoundException("Shopping list not found")
        val household =
            households.findById(householdId).orElseThrow { NotFoundException("Household not found") }
        val today = LocalDate.now(clock.withZone(ZoneId.of(household.timezone)))

        // Un producto con lotes vencidos y por vencer sale una sola vez; EXPIRING/EXPIRED ya cubren "con stock",
        // y OUT_OF_STOCK exige stock 0, así que los conjuntos no se solapan.
        val expiring =
            repo.expiring(householdId, listId, today.plusDays(household.expiryWarningDays.toLong())).map {
                val earliest = it[3] as LocalDate
                SuggestionDto(
                    ProductRefDto(it[0] as UUID, it[1] as String),
                    if (earliest.isBefore(today)) SuggestionReason.EXPIRED else SuggestionReason.EXPIRING,
                    it[2] as Unit,
                    earliest.toString(),
                )
            }
        val outOfStock =
            repo.outOfStock(householdId, listId).map {
                SuggestionDto(
                    ProductRefDto(it[0] as UUID, it[1] as String),
                    SuggestionReason.OUT_OF_STOCK,
                    it[2] as Unit,
                )
            }
        // El corte a MAX_RESULTS es en memoria: hay que ordenar la unión de ambos conjuntos antes de cortar.
        return (outOfStock + expiring)
            .sortedWith(compareBy({ it.reason }, { it.product.name.lowercase() }, { it.product.id }))
            .take(MAX_RESULTS)
    }
}
