package ar.hogar.stock

import ar.hogar.catalog.Unit
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Size
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class ProductRefDto(
    val id: UUID,
    val name: String,
)

/** Cantidades como string decimal con 3 decimales (`"1.500"`), según docs/04. */
data class StockItemDto(
    val id: UUID,
    val product: ProductRefDto,
    val quantity: String,
    val initialQuantity: String,
    val unit: Unit,
    val expiryDate: LocalDate?,
    val expiryStatus: ExpiryStatus,
    val location: String?,
    val status: StockStatus,
    val addedAt: Instant,
)

data class CreateStockItemRequest(
    @field:NotNull val productId: UUID?,
    @field:NotNull val quantity: String?,
    @field:NotNull val unit: Unit?,
    val expiryDate: LocalDate? = null,
    @field:Size(max = 120) val location: String? = null,
)

/** Campos ausentes/null = sin cambios. `quantity` es el nuevo remanente (ajuste). */
data class UpdateStockItemRequest(
    val expiryDate: LocalDate? = null,
    @field:Size(max = 120) val location: String? = null,
    val quantity: String? = null,
)

data class ConsumeByProductRequest(
    @field:NotNull val productId: UUID?,
    @field:NotNull val quantity: String?,
    @field:NotNull val unit: Unit?,
)

data class ConsumeItemRequest(
    @field:NotNull val quantity: String?,
)

data class ConsumedLotDto(
    val stockItemId: UUID,
    val quantity: String,
)

data class ConsumeResultDto(
    val consumed: List<ConsumedLotDto>,
)

data class DiscardRequest(
    @field:Size(max = 500) val reason: String? = null,
)

data class StockAlertsDto(
    val expired: List<StockItemDto>,
    val expiringSoon: List<StockItemDto>,
)

data class StockSummaryRowDto(
    val product: ProductRefDto,
    val totalQuantity: String,
    val unit: Unit,
    val nearestExpiry: LocalDate?,
)
