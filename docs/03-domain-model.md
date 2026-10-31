# 03 — Modelo de dominio y datos

Convenciones SQL: PKs `UUID` (generados en app, UUIDv7 si es posible), `created_at`/`updated_at` `TIMESTAMPTZ NOT NULL`, nombres en `snake_case`, montos `amount_minor BIGINT` + `currency CHAR(3)`. Fase indica en qué migración se crea cada tabla.

## Diagrama de relaciones (resumen)

```
household 1─* member 1─* income
household 1─* category 1─* product
household 1─* shopping_list 1─* shopping_list_item *─1 product
shopping_list 0..1─1 purchase 1─* purchase_item *─1 product
purchase 1─1 expense
expense 1─* expense_split *─1 member
product 1─* stock_item
purchase_item 0..1─1 stock_item
member *─* settlement(from,to)
```

## Tablas

### Fase 1

**household**: `id`, `name`, `base_currency CHAR(3) DEFAULT 'ARS'`, `timezone TEXT DEFAULT 'America/Argentina/Buenos_Aires'`, `expiry_warning_days INT DEFAULT 3`, `share_purchases_by_default BOOLEAN DEFAULT TRUE`.

**member**: `id`, `household_id FK`, `email UNIQUE (lower)`, `password_hash`, `display_name`, `role` (`OWNER|MEMBER`), `active BOOLEAN DEFAULT TRUE`.

**refresh_token**: `id`, `member_id FK`, `token_hash UNIQUE`, `expires_at`, `revoked_at NULL`.

**category**: `id`, `household_id FK`, `name`, `UNIQUE(household_id, lower(name))`.

**product**: `id`, `household_id FK`, `name`, `category_id FK NULL`, `default_unit` (enum), `default_shelf_life_days INT NULL`, `archived BOOLEAN DEFAULT FALSE`, `UNIQUE(household_id, lower(name))`.

**shopping_list**: `id`, `household_id FK`, `name`, `status` (`OPEN|COMPLETED|ARCHIVED`), `created_by FK member`, `completed_at NULL`.

**shopping_list_item**: `id`, `list_id FK ON DELETE CASCADE`, `product_id FK`, `quantity NUMERIC(12,3) > 0`, `unit`, `estimated_price_minor BIGINT NULL`, `note TEXT NULL`, `checked BOOLEAN DEFAULT FALSE`, `checked_at NULL`. `UNIQUE(list_id, product_id, unit)`.

**purchase**: `id`, `household_id FK`, `shopping_list_id FK NULL UNIQUE`, `store TEXT NULL`, `purchase_date DATE`, `total_minor BIGINT > 0`, `currency CHAR(3)`, `paid_by FK member`, `expense_id FK UNIQUE`.

**purchase_item**: `id`, `purchase_id FK ON DELETE CASCADE`, `product_id FK`, `quantity NUMERIC(12,3)`, `unit`, `unit_price_minor BIGINT`, `total_minor BIGINT`, `expiry_date DATE NULL`. Invariante: `total_minor = round(quantity × unit_price_minor)`; `Σ total_minor` puede ser ≠ `purchase.total_minor` (descuentos/ítems no listados) y está permitido.

**expense**: `id`, `household_id FK`, `description`, `amount_minor BIGINT > 0`, `currency CHAR(3)`, `expense_date DATE`, `category_id FK NULL`, `paid_by FK member`, `source` (`PURCHASE|MANUAL`), `shared BOOLEAN DEFAULT FALSE`, `split_mode` (`CONTRIBUTION|EQUAL|CUSTOM`) `NULL` si no compartido, `created_by FK`, `deleted_at NULL`. Índices: `(household_id, expense_date DESC)`, `(category_id)`.

**stock_item**: `id`, `household_id FK`, `product_id FK`, `quantity NUMERIC(12,3) >= 0` (restante), `initial_quantity NUMERIC(12,3)`, `unit`, `expiry_date DATE NULL`, `location TEXT NULL`, `purchase_item_id FK NULL`, `status` (`ACTIVE|CONSUMED|DISCARDED`), `discard_reason NULL`, `added_at`. Índices: `(household_id, status, expiry_date)`, `(product_id)`.

**stock_movement** (trazabilidad): `id`, `stock_item_id FK`, `type` (`IN|CONSUME|DISCARD|ADJUST`), `quantity NUMERIC(12,3)`, `created_by FK`, `created_at`.

### Fase 2

**expense_split**: `id`, `expense_id FK ON DELETE CASCADE`, `member_id FK`, `share_minor BIGINT >= 0`. `UNIQUE(expense_id, member_id)`. Invariante: `Σ share_minor = expense.amount_minor`.

**income**: `id`, `member_id FK`, `amount_minor BIGINT > 0` (mensual), `currency CHAR(3)`, `effective_from DATE`, `UNIQUE(member_id, effective_from)`.

**settlement**: `id`, `household_id FK`, `from_member FK`, `to_member FK`, `amount_minor BIGINT > 0`, `currency CHAR(3)`, `settled_on DATE`, `note NULL`, `deleted_at NULL`. Check: `from_member <> to_member`.

### Fase 3

**fx_rate**: `id`, `from_currency`, `to_currency`, `rate NUMERIC(18,8)`, `rate_date DATE`, `source` (`MANUAL|API`). `UNIQUE(from_currency, to_currency, rate_date, source)`.
**contribution_override**: `id`, `member_id FK`, `pct NUMERIC(5,2)`, `effective_from DATE`.
Columnas nuevas en `expense`: `original_currency`, `fx_rate_used NULL` (decidir en el diseño de la fase).

## Algoritmos

### Split / reparto (mayor resto) — `Allocator.allocate(total: Long, weights: List<Pair<Id, BigDecimal>>): Map<Id, Long>`

1. `sumW = Σ weights`; si `sumW = 0` o lista vacía → error.
2. Para cada `i`: `exact_i = total × w_i / sumW` (BigDecimal, sin redondear).
3. `base_i = floor(exact_i)`; `remainder = total − Σ base_i`.
4. Ordenar índices por parte fraccionaria `exact_i − base_i` descendente (desempate: orden estable por id). Sumar 1 unidad a los primeros `remainder`.
5. Resultado: `Σ result = total` exacto, cada `|result_i − exact_i| < 1`.

Tests obligatorios: total=100 con 3 pesos iguales → 34/33/33; propiedad `Σ = total` para entradas aleatorias; peso 0 → parte 0; determinismo.

### Porcentaje de contribución

- Entrada: miembros activos con ingreso vigente a la fecha `d` (mayor `effective_from <= d`).
- `pct_i` = allocate(10000, weights=ingreso_i) / 100 → 2 decimales, suma 100,00.
- Fase 3: si hay `contribution_override` vigente, reemplaza este cálculo.
- Mismo monto de ingreso con distinta moneda: fase 3 (convertir a moneda base).

### Split de gasto compartido

- `CONTRIBUTION`: pesos = ingresos vigentes en `expense_date` (miembros activos con ingreso). Sin ingresos cargados para alguien → error 422 `CONTRIBUTION_INCOMPLETE` (o fallback `EQUAL` si el hogar lo configura — no en MVP).
- `EQUAL`: pesos = 1 para cada miembro activo.
- `CUSTOM`: lista explícita `{memberId, shareMinor}`; validar `Σ = amount`.
- Siempre se persisten filas `expense_split` (incluidos los de monto 0).

### Balance entre miembros (por moneda)

Para cada moneda y rango de fechas opcional, con gastos `shared = true` y no eliminados:
- `paid_m` = Σ `amount` de gastos que pagó `m`.
- `owed_m` = Σ `share_minor` de `m` en splits.
- `settled_out_m` = Σ liquidaciones donde `m` es `from`; `settled_in_m` = Σ donde `m` es `to`.
- **`net_m = paid_m − owed_m + settled_out_m − settled_in_m`**. (net > 0: le deben; net < 0: debe.) Invariante: `Σ net_m = 0`.

**Simplificación de deudas (greedy)**: separar deudores (net<0) y acreedores (net>0), ordenar por magnitud desc, emparejar el mayor deudor con el mayor acreedor, transferir `min(|deudor|, acreedor)`, repetir hasta saldar. Máx. `n−1` transferencias.

### Stock: FEFO y estado de vencimiento

- Consumo de un producto: ítems `ACTIVE` ordenados por `expiry_date` asc (los `NULL` al final), luego `added_at` asc; descontar secuencialmente hasta cubrir la cantidad; ítems en 0 pasan a `CONSUMED`. Se registra un `stock_movement` por ítem tocado.
- Estado de vencimiento (calculado, no persistido): `EXPIRED` si `expiry_date < hoy`; `EXPIRING_SOON` si `hoy <= expiry_date <= hoy + expiry_warning_days`; `OK` si no; `NO_EXPIRY` si es null. "Hoy" en la zona del hogar.

### Sugerencias de lista

- `OUT_OF_STOCK`: productos con ≥ 1 compra histórica y stock activo total = 0.
- `EXPIRING` / `EXPIRED`: productos con algún ítem activo en ese estado.
- Excluir los que ya están en la lista abierta destino. Máximo 50 resultados, ordenados por motivo y luego nombre.

### Completar lista (UC-13) — pseudocódigo

```
completeList(listId, req):                        // @Transactional
  list = load(listId); require(list.status == OPEN)
  require(req.items ⊆ list.items.checked or explicit extras)
  expense = createExpense(source=PURCHASE, amount=req.total, paidBy=req.paidBy,
                          date=req.date, shared=household.sharePurchasesByDefault,
                          description="Compra " + (req.store ?: list.name))
  if expense.shared: createSplits(expense)       // fase 2
  purchase = createPurchase(list, expense, req)
  for item in req.items:
     pi = createPurchaseItem(purchase, item)
     expiry = item.expiryDate ?: product.defaultShelfLifeDays?.let { req.date + it }
     createStockItem(pi, expiry)                  // + stock_movement IN
  list.status = COMPLETED
  if req.leftoverAction == NEW_LIST: createListWith(unchecked items)
```
