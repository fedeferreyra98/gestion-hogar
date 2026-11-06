package ar.hogar.expense

import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.LocalDate
import java.util.UUID

/** Suma por moneda de un filtro (`currency` + `total` en unidades menores). */
interface CurrencyTotal {
    val currency: String
    val total: Long
}

interface ExpenseRepository : JpaRepository<Expense, UUID> {
    fun findByIdAndHouseholdIdAndDeletedAtIsNull(
        id: UUID,
        householdId: UUID,
    ): Expense?

    /** `pattern` es un patrón LIKE ya escapado y en minúsculas (o null). */
    @Query(
        """
        select e from Expense e
        where e.householdId = :householdId and e.deletedAt is null
          and (cast(:from as LocalDate) is null or e.expenseDate >= :from)
          and (cast(:to as LocalDate) is null or e.expenseDate <= :to)
          and (:categoryId is null or e.categoryId = :categoryId)
          and (:paidBy is null or e.paidBy = :paidBy)
          and (:source is null or e.source = :source)
          and (:shared is null or e.shared = :shared)
          and (:pattern is null or lower(e.description) like :pattern escape '\')
        """,
    )
    fun search(
        @Param("householdId") householdId: UUID,
        @Param("from") from: LocalDate?,
        @Param("to") to: LocalDate?,
        @Param("categoryId") categoryId: UUID?,
        @Param("paidBy") paidBy: UUID?,
        @Param("source") source: ExpenseSource?,
        @Param("shared") shared: Boolean?,
        @Param("pattern") pattern: String?,
        pageable: Pageable,
    ): Page<Expense>

    @Query(
        """
        select e.currency as currency, sum(e.amountMinor) as total from Expense e
        where e.householdId = :householdId and e.deletedAt is null
          and (cast(:from as LocalDate) is null or e.expenseDate >= :from)
          and (cast(:to as LocalDate) is null or e.expenseDate <= :to)
          and (:categoryId is null or e.categoryId = :categoryId)
          and (:paidBy is null or e.paidBy = :paidBy)
          and (:source is null or e.source = :source)
          and (:shared is null or e.shared = :shared)
          and (:pattern is null or lower(e.description) like :pattern escape '\')
        group by e.currency order by e.currency
        """,
    )
    fun totalsByCurrency(
        @Param("householdId") householdId: UUID,
        @Param("from") from: LocalDate?,
        @Param("to") to: LocalDate?,
        @Param("categoryId") categoryId: UUID?,
        @Param("paidBy") paidBy: UUID?,
        @Param("source") source: ExpenseSource?,
        @Param("shared") shared: Boolean?,
        @Param("pattern") pattern: String?,
    ): List<CurrencyTotal>
}
