package ar.hogar.report

import ar.hogar.catalog.Unit
import ar.hogar.expense.MoneyDto
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import java.time.LocalDate
import java.util.UUID

/** Agregaciones de solo lectura (UC-23). Los gastos con soft delete se excluyen siempre. */
@Repository
class ReportRepository(
    private val jdbc: NamedParameterJdbcTemplate,
) {
    fun summary(
        householdId: UUID,
        from: LocalDate?,
        to: LocalDate?,
        groupBy: SummaryGroupBy,
    ): List<SummaryRowDto> {
        val params = MapSqlParameterSource("householdId", householdId)
        val range = StringBuilder()
        if (from != null) {
            range.append(" and e.expense_date >= :from")
            params.addValue("from", java.sql.Date.valueOf(from))
        }
        if (to != null) {
            range.append(" and e.expense_date <= :to")
            params.addValue("to", java.sql.Date.valueOf(to))
        }
        val (select, join, group, order) =
            when (groupBy) {
                SummaryGroupBy.MONTH ->
                    Sql(
                        "to_char(e.expense_date, 'YYYY-MM') as k, to_char(e.expense_date, 'YYYY-MM') as label",
                        "",
                        "to_char(e.expense_date, 'YYYY-MM')",
                        "k asc, e.currency asc",
                    )
                SummaryGroupBy.CATEGORY ->
                    Sql(
                        "coalesce(cast(c.id as text), 'uncategorized') as k, coalesce(c.name, 'Sin categoría') as label",
                        "left join category c on c.id = e.category_id",
                        "c.id, c.name",
                        "e.currency asc, total desc, label asc, k asc",
                    )
                // El comercio sale de las compras: los gastos manuales no tienen comercio y no entran.
                SummaryGroupBy.STORE ->
                    Sql(
                        "coalesce(nullif(lower(trim(p.store)), ''), '') as k, " +
                            "coalesce(min(nullif(trim(p.store), '')), 'Sin comercio') as label",
                        "join purchase p on p.expense_id = e.id",
                        "coalesce(nullif(lower(trim(p.store)), ''), '')",
                        "e.currency asc, total desc, label asc, k asc",
                    )
            }
        val sourceFilter = if (groupBy == SummaryGroupBy.STORE) " and e.source = 'PURCHASE'" else ""
        val sql =
            "select $select, trim(e.currency) as currency, sum(e.amount_minor) as total " +
                "from expense e $join " +
                "where e.household_id = :householdId and e.deleted_at is null$sourceFilter$range " +
                "group by $group, e.currency order by $order"
        return jdbc.query(sql, params) { rs, _ ->
            SummaryRowDto(
                key = rs.getString("k"),
                label = rs.getString("label"),
                total = MoneyDto(rs.getLong("total"), rs.getString("currency")),
            )
        }
    }

    /** Un punto por línea de compra; el gasto asociado no puede estar borrado. */
    fun priceHistory(
        householdId: UUID,
        productId: UUID,
        from: LocalDate?,
        to: LocalDate?,
        unit: Unit?,
    ): List<PricePointDto> {
        val params =
            MapSqlParameterSource()
                .addValue("householdId", householdId)
                .addValue("productId", productId)
        val range = StringBuilder()
        if (from != null) {
            range.append(" and p.purchase_date >= :from")
            params.addValue("from", java.sql.Date.valueOf(from))
        }
        if (to != null) {
            range.append(" and p.purchase_date <= :to")
            params.addValue("to", java.sql.Date.valueOf(to))
        }
        if (unit != null) {
            range.append(" and i.unit = :unit")
            params.addValue("unit", unit.name)
        }
        val sql =
            "select p.purchase_date, p.store, trim(p.currency) as currency, i.unit_price_minor, i.unit " +
                "from purchase_item i join purchase p on p.id = i.purchase_id " +
                "join expense e on e.id = p.expense_id " +
                "where p.household_id = :householdId and i.product_id = :productId " +
                "and e.deleted_at is null$range " +
                "order by p.purchase_date asc, p.created_at asc, i.position asc"
        return jdbc.query(sql, params) { rs, _ ->
            PricePointDto(
                date = rs.getDate("purchase_date").toLocalDate(),
                store = rs.getString("store"),
                unitPrice = MoneyDto(rs.getLong("unit_price_minor"), rs.getString("currency")),
                unit = Unit.valueOf(rs.getString("unit")),
            )
        }
    }

    private data class Sql(
        val select: String,
        val join: String,
        val group: String,
        val order: String,
    )
}
