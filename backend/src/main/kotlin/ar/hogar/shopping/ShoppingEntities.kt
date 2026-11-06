package ar.hogar.shopping

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
import java.util.UUID

enum class ShoppingListStatus { OPEN, COMPLETED, ARCHIVED }

@Entity
@Table(name = "shopping_list")
class ShoppingList(
    @Id val id: UUID,
    val householdId: UUID,
    var name: String,
    @Enumerated(EnumType.STRING) var status: ShoppingListStatus = ShoppingListStatus.OPEN,
    val createdBy: UUID,
    var completedAt: Instant? = null,
    val createdAt: Instant,
    var updatedAt: Instant,
)

@Entity
@Table(name = "shopping_list_item")
class ShoppingListItem(
    @Id val id: UUID,
    val listId: UUID,
    val productId: UUID,
    var quantity: BigDecimal,
    @Enumerated(EnumType.STRING) var unit: Unit,
    var estimatedPriceMinor: Long? = null,
    @JdbcTypeCode(SqlTypes.CHAR) @Column(length = 3) var estimatedPriceCurrency: String? = null,
    var note: String? = null,
    var checked: Boolean = false,
    var checkedAt: Instant? = null,
    val createdAt: Instant,
    var updatedAt: Instant,
)
