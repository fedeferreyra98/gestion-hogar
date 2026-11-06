package ar.hogar.catalog

import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/** Unidades permitidas (UC-04). */
enum class Unit { UNIT, KG, G, L, ML, PACK }

@Entity
@Table(name = "category")
class Category(
    @Id val id: UUID,
    val householdId: UUID,
    var name: String,
    val createdAt: Instant,
    var updatedAt: Instant,
)

@Entity
@Table(name = "product")
class Product(
    @Id val id: UUID,
    val householdId: UUID,
    var name: String,
    var categoryId: UUID?,
    @Enumerated(EnumType.STRING) var defaultUnit: Unit,
    var defaultShelfLifeDays: Int?,
    var archived: Boolean = false,
    val createdAt: Instant,
    var updatedAt: Instant,
)
