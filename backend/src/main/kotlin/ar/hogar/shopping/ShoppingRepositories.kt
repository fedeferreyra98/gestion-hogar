package ar.hogar.shopping

import ar.hogar.catalog.Unit
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

/** Fila de listado con contadores calculados en la consulta. */
data class ListSummaryRow(
    val id: UUID,
    val name: String,
    val status: ShoppingListStatus,
    val createdAt: java.time.Instant,
    val itemCount: Long,
    val checkedCount: Long,
)

interface ShoppingListRepository : JpaRepository<ShoppingList, UUID> {
    @Query(
        """
        select new ar.hogar.shopping.ListSummaryRow(
            l.id, l.name, l.status, l.createdAt,
            (select count(i) from ShoppingListItem i where i.listId = l.id),
            (select count(i) from ShoppingListItem i where i.listId = l.id and i.checked = true))
        from ShoppingList l
        where l.householdId = :householdId and (:status is null or l.status = :status)
        """,
        countQuery =
            "select count(l) from ShoppingList l " +
                "where l.householdId = :householdId and (:status is null or l.status = :status)",
    )
    fun summaries(
        @Param("householdId") householdId: UUID,
        @Param("status") status: ShoppingListStatus?,
        pageable: Pageable,
    ): Page<ListSummaryRow>
}

interface ShoppingListItemRepository : JpaRepository<ShoppingListItem, UUID> {
    @Query("select i from ShoppingListItem i where i.listId = :listId order by i.checked, i.createdAt, i.id")
    fun findByList(
        @Param("listId") listId: UUID,
    ): List<ShoppingListItem>

    fun findByListIdAndProductIdAndUnit(
        listId: UUID,
        productId: UUID,
        unit: Unit,
    ): ShoppingListItem?
}
