package ar.hogar.stock

import ar.hogar.catalog.Unit
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

enum class StockStatus { ACTIVE, CONSUMED, DISCARDED }

enum class MovementType { IN, CONSUME, DISCARD, ADJUST }

/** Estado de vencimiento: se calcula al leer, nunca se persiste. */
enum class ExpiryStatus { EXPIRED, EXPIRING_SOON, OK, NO_EXPIRY }

@Entity
@Table(name = "stock_item")
class StockItem(
    @Id val id: UUID,
    val householdId: UUID,
    val productId: UUID,
    var quantity: BigDecimal,
    val initialQuantity: BigDecimal,
    @Enumerated(EnumType.STRING) val unit: Unit,
    var expiryDate: LocalDate?,
    var location: String?,
    val purchaseItemId: UUID? = null,
    @Enumerated(EnumType.STRING) var status: StockStatus = StockStatus.ACTIVE,
    var discardReason: String? = null,
    val addedAt: Instant,
    var updatedAt: Instant,
)

@Entity
@Table(name = "stock_movement")
class StockMovement(
    @Id val id: UUID,
    val stockItemId: UUID,
    @Enumerated(EnumType.STRING) val type: MovementType,
    val quantity: BigDecimal,
    val createdBy: UUID,
    val createdAt: Instant,
)
