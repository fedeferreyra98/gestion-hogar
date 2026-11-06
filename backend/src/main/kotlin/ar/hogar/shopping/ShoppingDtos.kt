package ar.hogar.shopping

import ar.hogar.catalog.Unit
import com.fasterxml.jackson.annotation.JsonFormat
import jakarta.validation.Valid
import jakarta.validation.constraints.Digits
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Positive
import jakarta.validation.constraints.Size
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** `Money` del contrato: unidades menores + moneda ISO 4217 (ADR-004). */
data class MoneyDto(
    @field:NotNull @field:Min(0) val amountMinor: Long?,
    @field:NotNull @field:Pattern(regexp = "^[A-Z]{3}$") val currency: String?,
)

data class RefDto(
    val id: UUID,
    val name: String,
)

data class ShoppingListInput(
    @field:NotBlank @field:Size(max = 160) val name: String,
)

data class UpdateShoppingListRequest(
    @field:Pattern(
        regexp = "(?s).*\\S.*",
        message = "must not be blank",
    ) @field:Size(max = 160) val name: String? = null,
    val status: ShoppingListStatus? = null,
)

data class DuplicateListRequest(
    @field:Pattern(
        regexp = "(?s).*\\S.*",
        message = "must not be blank",
    ) @field:Size(max = 160) val name: String? = null,
)

data class ShoppingListItemInput(
    @field:NotNull val productId: UUID?,
    @field:NotNull @field:Positive @field:Digits(integer = 9, fraction = 3) val quantity: BigDecimal?,
    @field:NotNull val unit: Unit?,
    @field:Valid val estimatedPrice: MoneyDto? = null,
    @field:Size(max = 500) val note: String? = null,
)

data class UpdateShoppingListItemRequest(
    @field:Positive @field:Digits(integer = 9, fraction = 3) val quantity: BigDecimal? = null,
    val unit: Unit? = null,
    @field:Valid val estimatedPrice: MoneyDto? = null,
    @field:Size(max = 500) val note: String? = null,
    val checked: Boolean? = null,
)

data class ShoppingListItemDto(
    val id: UUID,
    val product: RefDto,
    @field:JsonFormat(shape = JsonFormat.Shape.STRING) val quantity: BigDecimal,
    val unit: Unit,
    val estimatedPrice: MoneyDto?,
    val note: String?,
    val checked: Boolean,
    val checkedAt: Instant?,
)

data class ShoppingListDto(
    val id: UUID,
    val name: String,
    val status: ShoppingListStatus,
    val createdBy: UUID,
    val createdAt: Instant,
    val completedAt: Instant?,
    val items: List<ShoppingListItemDto>,
)

data class ShoppingListSummaryDto(
    val id: UUID,
    val name: String,
    val status: ShoppingListStatus,
    val itemCount: Int,
    val checkedCount: Int,
    val createdAt: Instant,
)
