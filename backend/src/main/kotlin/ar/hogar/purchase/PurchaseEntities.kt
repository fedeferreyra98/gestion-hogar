package ar.hogar.purchase

import ar.hogar.catalog.Unit
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** Ida de compras realizada; genera un [ar.hogar.expense.Expense] `PURCHASE` (`expenseId`) y lotes de stock. */
@Entity
@Table(name = "purchase")
class Purchase(
    @Id val id: UUID,
    val householdId: UUID,
    val shoppingListId: UUID?,
    var store: String?,
    var purchaseDate: LocalDate,
    var totalMinor: Long,
    @JdbcTypeCode(SqlTypes.CHAR) @Column(length = 3) var currency: String,
    var paidBy: UUID,
    val expenseId: UUID,
    val createdBy: UUID,
    val createdAt: Instant,
    var updatedAt: Instant,
)

@Entity
@Table(name = "purchase_item")
class PurchaseItem(
    @Id val id: UUID,
    val purchaseId: UUID,
    val position: Int,
    val productId: UUID,
    val quantity: BigDecimal,
    @Enumerated(EnumType.STRING) val unit: Unit,
    val unitPriceMinor: Long,
    val totalMinor: Long,
    val expiryDate: LocalDate?,
)
