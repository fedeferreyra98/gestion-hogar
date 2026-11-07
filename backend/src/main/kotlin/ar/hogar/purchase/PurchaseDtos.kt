package ar.hogar.purchase

import ar.hogar.catalog.Unit
import ar.hogar.shopping.MoneyDto
import ar.hogar.shopping.RefDto
import com.fasterxml.jackson.annotation.JsonFormat
import jakarta.validation.Valid
import jakarta.validation.constraints.Digits
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Positive
import jakarta.validation.constraints.Size
import java.math.BigDecimal
import java.time.LocalDate
import java.util.UUID

enum class LeftoverAction { NEW_LIST, DISCARD }

data class PurchaseItemInput(
    @field:NotNull val productId: UUID?,
    @field:NotNull @field:Positive @field:Digits(integer = 9, fraction = 3) val quantity: BigDecimal?,
    @field:NotNull val unit: Unit?,
    @field:NotNull @field:Valid val unitPrice: MoneyDto?,
    val expiryDate: LocalDate? = null,
)

/** Ítem de "completar lista": `listItemId` lo vincula con un ítem de la lista; sin él es un extra no listado. */
data class CompleteListItem(
    val listItemId: UUID? = null,
    @field:NotNull val productId: UUID?,
    @field:NotNull @field:Positive @field:Digits(integer = 9, fraction = 3) val quantity: BigDecimal?,
    @field:NotNull val unit: Unit?,
    @field:NotNull @field:Valid val unitPrice: MoneyDto?,
    val expiryDate: LocalDate? = null,
) {
    fun toInput() = PurchaseItemInput(productId, quantity, unit, unitPrice, expiryDate)
}

data class CompleteListRequest(
    @field:NotNull val purchaseDate: LocalDate?,
    @field:Size(max = 160) val store: String? = null,
    @field:NotNull val paidBy: UUID?,
    @field:NotNull @field:Valid val total: MoneyDto?,
    @field:NotEmpty @field:Valid val items: List<CompleteListItem>?,
    @field:NotNull val leftoverAction: LeftoverAction?,
    // Fase 2: se acepta pero el MVP no reparte gastos.
    val shared: Boolean? = null,
)

data class CreatePurchaseRequest(
    @field:NotNull val purchaseDate: LocalDate?,
    @field:Size(max = 160) val store: String? = null,
    @field:NotNull val paidBy: UUID?,
    @field:NotNull @field:Valid val total: MoneyDto?,
    @field:NotEmpty @field:Valid val items: List<PurchaseItemInput>?,
    val shared: Boolean? = null,
)

/** Campos ausentes = sin cambios; `items` reemplaza los ítems de la compra. */
data class UpdatePurchaseRequest(
    @field:Size(max = 160) val store: String? = null,
    val purchaseDate: LocalDate? = null,
    val paidBy: UUID? = null,
    @field:Valid val total: MoneyDto? = null,
    @field:NotEmpty @field:Valid val items: List<PurchaseItemInput>?,
)

data class MemberRefDto(
    val id: UUID,
    val displayName: String,
)

data class PurchaseItemDto(
    val id: UUID,
    val product: RefDto,
    @field:JsonFormat(shape = JsonFormat.Shape.STRING) val quantity: BigDecimal,
    val unit: Unit,
    val unitPrice: MoneyDto,
    val total: MoneyDto,
    val expiryDate: LocalDate?,
)

data class PurchaseDto(
    val id: UUID,
    val shoppingListId: UUID?,
    val store: String?,
    val purchaseDate: LocalDate,
    val total: MoneyDto,
    val paidBy: MemberRefDto,
    val expenseId: UUID,
    val items: List<PurchaseItemDto>,
)

data class PurchaseSummaryDto(
    val id: UUID,
    val store: String?,
    val purchaseDate: LocalDate,
    val total: MoneyDto,
    val itemCount: Int,
    val paidBy: MemberRefDto,
)
