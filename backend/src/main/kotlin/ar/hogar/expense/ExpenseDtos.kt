package ar.hogar.expense

import ar.hogar.common.PageResponse
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class MoneyDto(
    val amountMinor: Long,
    val currency: String,
)

data class MoneyInput(
    @field:NotNull val amountMinor: Long?,
    @field:NotNull @field:Pattern(regexp = "[A-Z]{3}") val currency: String?,
)

data class ExpenseInput(
    @field:NotBlank @field:Size(max = 255) val description: String,
    @field:NotNull @field:Valid val amount: MoneyInput?,
    @field:NotNull val expenseDate: LocalDate?,
    val categoryId: UUID? = null,
    @field:NotNull val paidBy: UUID?,
)

data class ExpenseDto(
    val id: UUID,
    val description: String,
    val amount: MoneyDto,
    val expenseDate: LocalDate,
    val categoryId: UUID?,
    val paidBy: UUID,
    val source: ExpenseSource,
    val shared: Boolean,
    val createdAt: Instant,
)

data class ExpensePageResponse(
    val content: List<ExpenseDto>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
    val totalFiltered: List<MoneyDto>,
) {
    constructor(p: PageResponse<ExpenseDto>, totalFiltered: List<MoneyDto>) :
        this(p.content, p.page, p.size, p.totalElements, p.totalPages, totalFiltered)
}
