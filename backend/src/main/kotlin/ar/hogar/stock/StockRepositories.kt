package ar.hogar.stock

import ar.hogar.catalog.Unit
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.LocalDate
import java.util.UUID

interface StockItemRepository : JpaRepository<StockItem, UUID> {
    /**
     * Listado en orden FEFO. Si `filterExpiry` es true se exige fecha de vencimiento dentro de
     * `[minExpiry, maxExpiry]` (inclusive); el servicio pasa fechas centinela para los extremos abiertos.
     */
    @Query(
        """
        select s from StockItem s
        where s.householdId = :householdId
          and s.status = :status
          and (:productId is null or s.productId = :productId)
          and (:location is null or lower(s.location) = :location)
          and (:categoryId is null or s.productId in (select p.id from Product p where p.categoryId = :categoryId))
          and (:filterExpiry = false or (s.expiryDate is not null and s.expiryDate between :minExpiry and :maxExpiry))
        order by case when s.expiryDate is null then 1 else 0 end, s.expiryDate, s.addedAt, s.id
        """,
    )
    fun search(
        @Param("householdId") householdId: UUID,
        @Param("status") status: StockStatus,
        @Param("productId") productId: UUID?,
        @Param("categoryId") categoryId: UUID?,
        @Param("location") location: String?,
        @Param("filterExpiry") filterExpiry: Boolean,
        @Param("minExpiry") minExpiry: LocalDate,
        @Param("maxExpiry") maxExpiry: LocalDate,
        pageable: Pageable,
    ): Page<StockItem>

    /** Lotes activos de un producto/unidad, bloqueados para que dos consumos concurrentes no se pisen. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
        "select s from StockItem s where s.householdId = :householdId and s.productId = :productId " +
            "and s.unit = :unit and s.status = ar.hogar.stock.StockStatus.ACTIVE",
    )
    fun lockActive(
        @Param("householdId") householdId: UUID,
        @Param("productId") productId: UUID,
        @Param("unit") unit: Unit,
    ): List<StockItem>

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findWithLockByIdAndHouseholdId(
        id: UUID,
        householdId: UUID,
    ): StockItem?

    @Query(
        """
        select s.productId, s.unit, sum(s.quantity), min(s.expiryDate) from StockItem s
        where s.householdId = :householdId and s.status = ar.hogar.stock.StockStatus.ACTIVE
        group by s.productId, s.unit
        """,
    )
    fun summarize(
        @Param("householdId") householdId: UUID,
    ): List<Array<Any?>>
}

interface StockMovementRepository : JpaRepository<StockMovement, UUID>
