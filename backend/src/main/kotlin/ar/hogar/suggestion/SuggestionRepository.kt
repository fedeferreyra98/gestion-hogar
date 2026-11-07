package ar.hogar.suggestion

import ar.hogar.catalog.Product
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.LocalDate
import java.util.UUID

/** Consultas de solo lectura de UC-12; todas acotadas al hogar, a productos activos y fuera de la lista destino. */
interface SuggestionRepository : JpaRepository<Product, UUID> {
    /** Productos comprados alguna vez y sin ningún lote `ACTIVE`. Devuelve `[id, name]`. */
    @Query(
        """
        select p.id, p.name from Product p
        where p.householdId = :householdId and p.archived = false
          and p.id not in (select i.productId from ShoppingListItem i where i.listId = :listId)
          and exists (
            select 1 from PurchaseItem pi, Purchase pu
            where pi.productId = p.id and pu.id = pi.purchaseId and pu.householdId = :householdId)
          and not exists (
            select 1 from StockItem s
            where s.productId = p.id and s.householdId = :householdId
              and s.status = ar.hogar.stock.StockStatus.ACTIVE)
        """,
    )
    fun outOfStock(
        @Param("householdId") householdId: UUID,
        @Param("listId") listId: UUID,
    ): List<Array<Any?>>

    /** Productos con lotes `ACTIVE` que vencen hasta `limit` (inclusive). Devuelve `[id, name, min(expiry)]`. */
    @Query(
        """
        select p.id, p.name, min(s.expiryDate) from Product p, StockItem s
        where s.productId = p.id and s.householdId = :householdId and p.householdId = :householdId
          and p.archived = false
          and s.status = ar.hogar.stock.StockStatus.ACTIVE
          and s.expiryDate is not null and s.expiryDate <= :limit
          and p.id not in (select i.productId from ShoppingListItem i where i.listId = :listId)
        group by p.id, p.name
        """,
    )
    fun expiring(
        @Param("householdId") householdId: UUID,
        @Param("listId") listId: UUID,
        @Param("limit") limit: LocalDate,
    ): List<Array<Any?>>
}
