package ar.hogar.purchase

import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.LocalDate
import java.util.UUID

/** Fila de listado con el contador de ítems calculado en la consulta. */
data class PurchaseSummaryRow(
    val id: UUID,
    val store: String?,
    val purchaseDate: LocalDate,
    val totalMinor: Long,
    val currency: String,
    val paidBy: UUID,
    val itemCount: Long,
)

interface PurchaseRepository : JpaRepository<Purchase, UUID> {
    fun findByIdAndHouseholdId(
        id: UUID,
        householdId: UUID,
    ): Purchase?

    /** Bloquea la fila: dos ediciones concurrentes de la misma compra se serializan. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findWithLockByIdAndHouseholdId(
        id: UUID,
        householdId: UUID,
    ): Purchase?

    /** `pattern` es un patrón LIKE ya escapado y en minúsculas (o null). */
    @Query(
        """
        select new ar.hogar.purchase.PurchaseSummaryRow(
            p.id, p.store, p.purchaseDate, p.totalMinor, p.currency, p.paidBy,
            (select count(i) from PurchaseItem i where i.purchaseId = p.id))
        from Purchase p
        where p.householdId = :householdId
          and (cast(:from as LocalDate) is null or p.purchaseDate >= :from)
          and (cast(:to as LocalDate) is null or p.purchaseDate <= :to)
          and (:pattern is null or lower(p.store) like :pattern escape '\')
        """,
        countQuery =
            """
            select count(p) from Purchase p
            where p.householdId = :householdId
              and (cast(:from as LocalDate) is null or p.purchaseDate >= :from)
              and (cast(:to as LocalDate) is null or p.purchaseDate <= :to)
              and (:pattern is null or lower(p.store) like :pattern escape '\')
            """,
    )
    fun search(
        @Param("householdId") householdId: UUID,
        @Param("from") from: LocalDate?,
        @Param("to") to: LocalDate?,
        @Param("pattern") pattern: String?,
        pageable: Pageable,
    ): Page<PurchaseSummaryRow>
}

interface PurchaseItemRepository : JpaRepository<PurchaseItem, UUID> {
    @Query("select i from PurchaseItem i where i.purchaseId = :purchaseId order by i.position")
    fun findByPurchase(
        @Param("purchaseId") purchaseId: UUID,
    ): List<PurchaseItem>

    /** Los lotes de stock vinculados quedan con `purchase_item_id = NULL` (FK `ON DELETE SET NULL`). */
    @Modifying
    @Query("delete from PurchaseItem i where i.purchaseId = :purchaseId")
    fun deleteByPurchase(
        @Param("purchaseId") purchaseId: UUID,
    ): Int
}
