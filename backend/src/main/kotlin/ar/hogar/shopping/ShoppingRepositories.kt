package ar.hogar.shopping

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

    /**
     * Alta atómica: inserta o suma la cantidad sobre el UNIQUE(list, product, unit) (sin lost update).
     * Devuelve el id del ítem, o null si la suma superaría [MAX_QUANTITY] (nada se modifica).
     * `price*` / `note` solo pisan el valor existente si vienen (`noteProvided` para poder vaciarla).
     */
    @Query(
        """
        INSERT INTO shopping_list_item AS i
            (id, list_id, product_id, quantity, unit, estimated_price_minor, estimated_price_currency, note,
             created_at, updated_at)
        VALUES (:id, :listId, :productId, :quantity, :unit, CAST(:priceMinor AS bigint),
                CAST(:priceCurrency AS char(3)), CAST(:note AS text), :now, :now)
        ON CONFLICT (list_id, product_id, unit) DO UPDATE SET
            quantity = i.quantity + excluded.quantity,
            estimated_price_minor = COALESCE(excluded.estimated_price_minor, i.estimated_price_minor),
            estimated_price_currency = COALESCE(excluded.estimated_price_currency, i.estimated_price_currency),
            note = CASE WHEN :noteProvided THEN excluded.note ELSE i.note END,
            updated_at = excluded.updated_at
        WHERE i.quantity + excluded.quantity < $MAX_QUANTITY
        RETURNING i.id
        """,
        nativeQuery = true,
    )
    fun upsertAddingQuantity(
        @Param("id") id: UUID,
        @Param("listId") listId: UUID,
        @Param("productId") productId: UUID,
        @Param("quantity") quantity: java.math.BigDecimal,
        @Param("unit") unit: String,
        @Param("priceMinor") priceMinor: Long?,
        @Param("priceCurrency") priceCurrency: String?,
        @Param("note") note: String?,
        @Param("noteProvided") noteProvided: Boolean,
        @Param("now") now: java.time.Instant,
    ): UUID?
}

/** Límite exclusivo de `quantity` (NUMERIC(12,3) admite hasta 9 dígitos enteros). */
const val MAX_QUANTITY = "1000000000"
