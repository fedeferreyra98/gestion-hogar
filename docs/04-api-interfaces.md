# 04 — Contrato de API REST

Base: `/api/v1`. JSON UTF-8. Auth: `Authorization: Bearer <accessToken>` salvo endpoints marcados `público`. Esta doc es el borrador legible; la fuente de verdad final es `api/openapi.yaml` (tarea BL-004 la genera a partir de este documento).

## Convenciones

- **IDs**: UUID string. **Fechas**: `YYYY-MM-DD` (date) o ISO-8601 UTC (timestamp).
- **Dinero**: `Money = { "amountMinor": integer, "currency": "ARS" }`.
- **Cantidades**: string decimal (`"1.500"`) para evitar float en JSON; unidades enum `UNIT|KG|G|L|ML|PACK`.
- **Paginación**: query `page` (0-based), `size` (default 20, máx 100), `sort` (`campo,asc|desc`). Respuesta `Page<T>`:
  `{ "content": [...], "page": 0, "size": 20, "totalElements": 134, "totalPages": 7 }`.
- **Errores** (RFC 7807, `application/problem+json`):
  ```json
  { "type": "about:blank", "title": "Validation failed", "status": 400,
    "code": "VALIDATION_ERROR", "detail": "...",
    "errors": [{ "field": "quantity", "message": "must be greater than 0" }] }
  ```
  Códigos: `VALIDATION_ERROR`(400), `UNAUTHORIZED`(401), `FORBIDDEN`(403), `NOT_FOUND`(404), `CONFLICT`(409), `BUSINESS_RULE`(422 con `code` específico: `LIST_NOT_OPEN`, `INSUFFICIENT_STOCK`, `CONTRIBUTION_INCOMPLETE`, `UNSUPPORTED_CURRENCY`, `SPLIT_SUM_MISMATCH`, `HOUSEHOLD_EXISTS`).
- **Idempotencia**: `POST /shopping-lists/{id}/complete` es seguro de reintentar (409/422 `LIST_NOT_OPEN` si ya se completó).
- **Fase**: P1/P2/P3 entre corchetes.

## Auth y miembros

| Método y ruta | Descripción | Request → Response |
|---|---|---|
| `POST /auth/register-owner` público [P1] | Crea hogar + owner (solo si no hay hogar) | `{householdName, email, password, displayName}` → `201 AuthTokens` |
| `POST /auth/login` público [P1] | | `{email, password}` → `AuthTokens` |
| `POST /auth/refresh` público [P1] | Rota refresh token | `{refreshToken}` → `AuthTokens` |
| `POST /auth/logout` [P1] | Revoca refresh | `{refreshToken}` → `204` |
| `GET /me` [P1] | Perfil + hogar | → `Me` |
| `GET /members` [P1] | Miembros del hogar | → `Member[]` |
| `POST /members` [P1, OWNER] | Crear miembro | `{email, displayName, password}` → `201 Member` |
| `PATCH /members/{id}` [P1, OWNER] | Editar nombre/activo | `{displayName?, active?}` → `Member` |
| `PUT /household` [P1, OWNER] | Config del hogar | `{name?, expiryWarningDays?, sharePurchasesByDefault?}` → `Household` |

```
AuthTokens = { accessToken, refreshToken, expiresInSeconds }
Member     = { id, email, displayName, role: "OWNER"|"MEMBER", active }
Household  = { id, name, baseCurrency, timezone, expiryWarningDays, sharePurchasesByDefault }
Me         = { member: Member, household: Household }
```

## Catálogo

| Ruta | Descripción |
|---|---|
| `GET /categories` [P1] → `Category[]` · `POST /categories` `{name}` · `PUT /categories/{id}` · `DELETE /categories/{id}` (409 si tiene productos) | |
| `GET /products?q=&categoryId=&includeArchived=false&page&size` [P1] → `Page<Product>` | Búsqueda por nombre |
| `POST /products` [P1] `ProductInput` → `201 Product` · `PUT /products/{id}` · `POST /products/{id}/archive` · `POST /products/{id}/unarchive` | |

```
Category     = { id, name }
ProductInput = { name, categoryId?, defaultUnit, defaultShelfLifeDays? }
Product      = ProductInput + { id, archived }
```

## Listas de compra

| Método y ruta | Descripción |
|---|---|
| `GET /shopping-lists?status=OPEN&page&size` [P1] → `Page<ShoppingListSummary>` | |
| `POST /shopping-lists` `{name}` [P1] → `201 ShoppingList` | |
| `GET /shopping-lists/{id}` [P1] → `ShoppingList` | |
| `PATCH /shopping-lists/{id}` `{name?, status?: "ARCHIVED"}` [P1] | Solo `OPEN`→`ARCHIVED` o renombrar |
| `POST /shopping-lists/{id}/duplicate` `{name?}` [P1] → `201 ShoppingList` | Copia ítems sin tildar |
| `POST /shopping-lists/{id}/items` `ShoppingListItemInput` [P1] → `201 ShoppingListItem` | Suma cantidad si ya existe (mismo producto+unidad) |
| `PATCH /shopping-lists/{id}/items/{itemId}` `{quantity?, unit?, estimatedPrice?, note?, checked?}` [P1] | |
| `DELETE /shopping-lists/{id}/items/{itemId}` [P1] → `204` | |
| `GET /shopping-lists/suggestions` [P1] → `Suggestion[]` | UC-12 |
| `POST /shopping-lists/{id}/complete` [P1] `CompleteListRequest` → `201 Purchase` | UC-13 |

```
ShoppingListItemInput = { productId, quantity, unit, estimatedPrice?: Money, note? }
ShoppingListItem = { id, product: {id,name}, quantity, unit, estimatedPrice?: Money, note?, checked, checkedAt? }
ShoppingList     = { id, name, status, createdBy, createdAt, completedAt?, items: ShoppingListItem[] }
ShoppingListSummary = { id, name, status, itemCount, checkedCount, createdAt }
Suggestion       = { product: {id,name}, reason: "OUT_OF_STOCK"|"EXPIRING"|"EXPIRED", detail? }

CompleteListRequest = {
  purchaseDate, store?, paidBy: memberId, total: Money,
  items: [{ listItemId?, productId, quantity, unit, unitPrice: Money, expiryDate? }],
  leftoverAction: "NEW_LIST" | "DISCARD",
  shared?: boolean          // default según household (P2)
}
```

## Compras

| Ruta | Descripción |
|---|---|
| `POST /purchases` [P1] `CreatePurchaseRequest` (= `CompleteListRequest` sin listItemId/leftoverAction) → `201 Purchase` | UC-14 |
| `GET /purchases?from&to&store&page&size` [P1] → `Page<PurchaseSummary>` | |
| `GET /purchases/{id}` [P1] → `Purchase` | |
| `PUT /purchases/{id}` [P1] `{store?, purchaseDate?, paidBy?, total?, items[]}` → `Purchase` | Recalcula el gasto asociado |

```
Purchase = { id, shoppingListId?, store?, purchaseDate, total: Money, paidBy: Member-ref, expenseId,
             items: [{ id, product:{id,name}, quantity, unit, unitPrice: Money, total: Money, expiryDate? }] }
PurchaseSummary = { id, store?, purchaseDate, total: Money, itemCount, paidBy }
```

## Gastos

| Ruta | Descripción |
|---|---|
| `GET /expenses?from&to&categoryId&paidBy&source&q&shared&page&size` [P1] → `ExpensePage` | Incluye `totalFiltered: Money[]` (por moneda) |
| `POST /expenses` [P1] `ExpenseInput` → `201 Expense` | Manual |
| `GET /expenses/{id}` [P1] → `Expense` | |
| `PUT /expenses/{id}` [P1] | 409/422 si `source=PURCHASE` (editar la compra) |
| `DELETE /expenses/{id}` [P1] → `204` | Soft delete; igual restricción |
| `GET /expenses/summary?from&to&groupBy=month\|category\|store` [P1] → `SummaryRow[]` | UC-23 |
| `GET /products/{id}/price-history?from&to` [P1] → `{date, store?, unitPrice: Money}[]` | UC-23 |

```
ExpenseInput = { description, amount: Money, expenseDate, categoryId?, paidBy,
                 shared?: boolean, splitMode?: "CONTRIBUTION"|"EQUAL"|"CUSTOM",
                 customSplits?: [{memberId, share: Money}] }       // shared/split: P2
Expense = ExpenseInput(sin customSplits) + { id, source, splits?: [{memberId, share: Money}], createdAt }
ExpensePage = Page<Expense> + { totalFiltered: Money[] }
SummaryRow = { key: string, label: string, total: Money }
```

## Stock

| Ruta | Descripción |
|---|---|
| `GET /stock?productId&categoryId&location&expiry=EXPIRED\|EXPIRING_SOON\|OK&status=ACTIVE&page&size` [P1] → `Page<StockItem>` | orden: vencimiento asc |
| `POST /stock` [P1] `{productId, quantity, unit, expiryDate?, location?}` → `201 StockItem` | Alta manual |
| `PATCH /stock/{id}` [P1] `{expiryDate?, location?, quantity?}` → `StockItem` | `quantity` = ajuste (`ADJUST`) |
| `POST /stock/consume` [P1] `{productId, quantity, unit}` → `{consumed: [{stockItemId, quantity}]}` | FEFO; 422 `INSUFFICIENT_STOCK` |
| `POST /stock/{id}/consume` [P1] `{quantity}` → `StockItem` | Lote específico |
| `POST /stock/{id}/discard` [P1] `{reason?}` → `StockItem` | |
| `GET /stock/alerts` [P1] → `{expired: StockItem[], expiringSoon: StockItem[]}` | |
| `GET /stock/summary` [P1] → `{product, totalQuantity, unit, nearestExpiry?}[]` | agrupado por producto |

```
StockItem = { id, product:{id,name}, quantity, initialQuantity, unit, expiryDate?, expiryStatus: "EXPIRED"|"EXPIRING_SOON"|"OK"|"NO_EXPIRY",
              location?, status: "ACTIVE"|"CONSUMED"|"DISCARDED", addedAt }
```

## Contribución e ingresos [P2]

| Ruta | Descripción |
|---|---|
| `GET /members/{id}/incomes` → `Income[]` | Propio u OWNER |
| `POST /members/{id}/incomes` `{amount: Money, effectiveFrom}` → `201 Income` | |
| `DELETE /members/{id}/incomes/{incomeId}` → `204` | |
| `GET /contribution?asOf=YYYY-MM-DD&monthlyBudget=<minor>` → `Contribution` | Solo % (y cuota sugerida si hay budget) |

```
Income = { id, amount: Money, effectiveFrom }
Contribution = { asOf, members: [{ memberId, displayName, pct: "62.50", suggestedShare?: Money }], missingIncome: memberId[] }
```

## Balances y liquidaciones [P2]

| Ruta | Descripción |
|---|---|
| `GET /balances?from&to` → `Balance` | Por moneda |
| `GET /settlements?page&size` · `POST /settlements` `{fromMember, toMember, amount: Money, settledOn, note?}` · `DELETE /settlements/{id}` | |

```
Balance = { byCurrency: [{ currency, members: [{memberId, paid: Money, owed: Money, net: Money}],
                           transfers: [{from, to, amount: Money}] }] }
```

## Multimoneda [P3] (esbozo)

`GET/PUT /fx-rates`; `Expense` acepta `amount.currency` ≠ base y `fxRate?`. Se define en detalle al iniciar la fase.

## Autorización resumida

| Recurso | MEMBER | OWNER |
|---|---|---|
| Listas, productos, stock, gastos, compras | CRUD | CRUD |
| Miembros / hogar | solo lectura | CRUD |
| Ingresos | solo los propios | todos |
| Balances / contribución (porcentajes) | lectura | lectura |

## Cambios de contrato

_(registrar aquí cualquier ajuste posterior al contrato: fecha, tarea, cambio, motivo.)_
