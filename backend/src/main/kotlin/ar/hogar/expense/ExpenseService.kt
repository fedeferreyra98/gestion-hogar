package ar.hogar.expense

import ar.hogar.auth.HouseholdRepository
import ar.hogar.auth.MemberRepository
import ar.hogar.catalog.CategoryRepository
import ar.hogar.common.ConflictException
import ar.hogar.common.CurrencyPolicy
import ar.hogar.common.FieldError
import ar.hogar.common.Money
import ar.hogar.common.NotFoundException
import ar.hogar.common.PageRequests
import ar.hogar.common.ValidationException
import ar.hogar.common.toPageResponse
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.util.Currency
import java.util.UUID

/** UC-20 (histórico) y UC-21 (gasto manual). Los gastos `PURCHASE` se gestionan desde la compra (BL-108). */
@Service
class ExpenseService(
    private val expenses: ExpenseRepository,
    private val households: HouseholdRepository,
    private val members: MemberRepository,
    private val categories: CategoryRepository,
    private val clock: Clock,
) {
    @Transactional(readOnly = true)
    fun search(
        householdId: UUID,
        filter: ExpenseFilter,
        page: Int?,
        size: Int?,
        sort: String?,
    ): ExpensePageResponse {
        if (filter.from != null && filter.to != null && filter.from.isAfter(filter.to)) {
            throw ValidationException("Invalid range", listOf(FieldError("from", "must not be after to")))
        }
        val pageable =
            PageRequests.of(
                page,
                size,
                sort,
                setOf("expenseDate", "amountMinor", "createdAt"),
                Sort.by(Sort.Order.desc("expenseDate"), Sort.Order.desc("createdAt"), Sort.Order.asc("id")),
            )
        val pattern =
            filter.q
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let { "%" + escapeLike(it.lowercase()) + "%" }
        val result =
            expenses.search(
                householdId,
                filter.from,
                filter.to,
                filter.categoryId,
                filter.paidBy,
                filter.source,
                filter.shared,
                pattern,
                pageable,
            )
        val totals =
            expenses
                .totalsByCurrency(
                    householdId,
                    filter.from,
                    filter.to,
                    filter.categoryId,
                    filter.paidBy,
                    filter.source,
                    filter.shared,
                    pattern,
                ).map { MoneyDto(it.total, it.currency) }
        return ExpensePageResponse(result.toPageResponse { it.toDto() }, totals)
    }

    @Transactional(readOnly = true)
    fun get(
        householdId: UUID,
        id: UUID,
    ): ExpenseDto = expense(householdId, id).toDto()

    @Transactional
    fun create(
        householdId: UUID,
        createdBy: UUID,
        req: ExpenseInput,
    ): ExpenseDto {
        val money = validated(householdId, req)
        val now = clock.instant()
        val expense =
            Expense(
                id = UUID.randomUUID(),
                householdId = householdId,
                description = req.description.trim(),
                amountMinor = money.amountMinor,
                currency = money.currency.currencyCode,
                expenseDate = req.expenseDate!!,
                categoryId = req.categoryId,
                paidBy = req.paidBy!!,
                source = ExpenseSource.MANUAL,
                createdBy = createdBy,
                createdAt = now,
                updatedAt = now,
            )
        return expenses.saveAndFlush(expense).toDto()
    }

    @Transactional
    fun update(
        householdId: UUID,
        id: UUID,
        req: ExpenseInput,
    ): ExpenseDto {
        val expense = manualExpense(householdId, id)
        val money = validated(householdId, req)
        expense.description = req.description.trim()
        expense.amountMinor = money.amountMinor
        expense.currency = money.currency.currencyCode
        expense.expenseDate = req.expenseDate!!
        expense.categoryId = req.categoryId
        expense.paidBy = req.paidBy!!
        expense.updatedAt = clock.instant()
        return expenses.saveAndFlush(expense).toDto()
    }

    @Transactional
    fun delete(
        householdId: UUID,
        id: UUID,
    ) {
        val expense = manualExpense(householdId, id)
        val now = clock.instant()
        expense.deletedAt = now
        expense.updatedAt = now
    }

    /** Valida el input y devuelve el monto; moneda distinta a la base del hogar → 422 `UNSUPPORTED_CURRENCY`. */
    private fun validated(
        householdId: UUID,
        req: ExpenseInput,
    ): Money {
        val input = req.amount!!
        val money = Money.of(input.amountMinor!!, input.currency!!)
        if (money.amountMinor <= 0) {
            throw ValidationException("Invalid amount", listOf(FieldError("amount.amountMinor", "must be > 0")))
        }
        val household =
            households.findById(householdId).orElseThrow { NotFoundException("Household not found") }
        CurrencyPolicy(Currency.getInstance(household.baseCurrency.trim())).requireSupported(money)
        req.categoryId?.let {
            if (categories.findById(it).filter { c -> c.householdId == householdId }.isEmpty) {
                throw ValidationException("Invalid category", listOf(FieldError("categoryId", "does not exist")))
            }
        }
        val payer = members.findById(req.paidBy!!).filter { it.householdId == householdId && it.active }
        if (payer.isEmpty) {
            throw ValidationException("Invalid payer", listOf(FieldError("paidBy", "must be an active member")))
        }
        return money
    }

    private fun expense(
        householdId: UUID,
        id: UUID,
    ): Expense =
        expenses.findByIdAndHouseholdIdAndDeletedAtIsNull(id, householdId)
            ?: throw NotFoundException("Expense not found")

    /** Un gasto `PURCHASE` no se edita ni elimina directo: se edita la compra → 409. */
    private fun manualExpense(
        householdId: UUID,
        id: UUID,
    ): Expense =
        expense(householdId, id).also {
            if (it.source == ExpenseSource.PURCHASE) {
                throw ConflictException("Expense comes from a purchase; edit the purchase instead")
            }
        }

    private fun escapeLike(s: String) = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    private fun Expense.toDto() =
        ExpenseDto(
            id = id,
            description = description,
            amount = MoneyDto(amountMinor, currency.trim()),
            expenseDate = expenseDate,
            categoryId = categoryId,
            paidBy = paidBy,
            source = source,
            // Reparto: Fase 2. En el MVP siempre se devuelve false.
            shared = false,
            createdAt = createdAt,
        )
}

data class ExpenseFilter(
    val from: LocalDate?,
    val to: LocalDate?,
    val categoryId: UUID?,
    val paidBy: UUID?,
    val source: ExpenseSource?,
    val shared: Boolean?,
    val q: String?,
)
