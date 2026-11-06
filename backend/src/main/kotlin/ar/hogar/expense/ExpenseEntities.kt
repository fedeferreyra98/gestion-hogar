package ar.hogar.expense

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import org.hibernate.annotations.DynamicUpdate
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

enum class ExpenseSource { MANUAL, PURCHASE }

enum class SplitMode { CONTRIBUTION, EQUAL, CUSTOM }

/** `@Version`: PUT/DELETE concurrentes no se pisan (el perdedor recibe 409); `@DynamicUpdate` solo escribe lo modificado. */
@Entity
@DynamicUpdate
@Table(name = "expense")
class Expense(
    @Id val id: UUID,
    val householdId: UUID,
    var description: String,
    var amountMinor: Long,
    @JdbcTypeCode(SqlTypes.CHAR) @Column(length = 3) var currency: String,
    var expenseDate: LocalDate,
    var categoryId: UUID?,
    var paidBy: UUID,
    @Enumerated(EnumType.STRING) val source: ExpenseSource,
    // Fase 2: se persisten pero el MVP siempre crea gastos no compartidos.
    var shared: Boolean = false,
    @Enumerated(EnumType.STRING) var splitMode: SplitMode? = null,
    val createdBy: UUID,
    var deletedAt: Instant? = null,
    val createdAt: Instant,
    var updatedAt: Instant,
    @Version var version: Long = 0,
)
