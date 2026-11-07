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
| `GET /products/{id}/price-history?from&to&unit` [P1] → `{date, store?, unitPrice: Money, unit}[]` | UC-23 |

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
| `GET /stock?productId&categoryId&location&expiry=EXPIRED\|EXPIRING_SOON\|OK&status=ACTIVE&page&size` [P1] → `Page<StockItem>` | orden fijo FEFO: vencimiento asc (sin vencimiento al final), luego `addedAt` |
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

- BL-004: `api/openapi.yaml` (OpenAPI 3.1) pasa a ser la fuente de verdad de Fase 1. Aclaraciones sin cambio de comportamiento: `Page<T>` se modela como `Page` + `allOf` por tipo (`ProductPage`, `ExpensePage`, …); `Problem.code` es el enum `ProblemCode`; `ShoppingListStatus` = `OPEN|COMPLETED|ARCHIVED` y `ExpenseSource` = `MANUAL|PURCHASE`; `ExpenseInput` omite los campos de reparto (`shared`, `splitMode`, `customSplits`) hasta Fase 2.

- BL-102: `POST /auth/register-owner` responde `409 CONFLICT` (no 422 `HOUSEHOLD_EXISTS`) si ya existe un hogar o el email, según UC-01 y el backlog. `POST /auth/logout` es idempotente (204 aunque el refresh token sea desconocido) y requiere access token. Access token: claims `sub`=memberId, `hid`=householdId, `role`.

- BL-103: `PATCH /members/{id}` responde `409 CONFLICT` si el OWNER intenta desactivarse a sí mismo (evita dejar el hogar sin owner activo). Al desactivar un miembro se revocan sus refresh tokens (el access token vigente sigue válido hasta expirar, `accessTtl`). `POST /members` siempre crea rol `MEMBER`; `PATCH`/`PUT` con campos ausentes los dejan sin cambios. `GET /members` devuelve activos e inactivos (el histórico los necesita).

- BL-104: Catálogo. Cualquier miembro autenticado puede leer y escribir categorías y productos (no hay restricción OWNER). `name` se normaliza con `trim` y es único por hogar sin distinguir mayúsculas (`409 CONFLICT`, también al renombrar; el nombre sigue reservado mientras el producto esté archivado). `DELETE /categories/{id}` → `409` si tiene productos (archivados incluidos). `POST/PUT /products` con `categoryId` inexistente (o de otro hogar) → `404 NOT_FOUND`; `POST/PUT /products` suman `404` y `409` al contrato. `GET /categories` ordena por nombre sin distinguir mayúsculas. `GET /products`: `q` filtra por nombre con "contiene" sin distinguir mayúsculas; `sort` admite `name` (default `name,asc`).

- BL-107: Gastos. `GET /expenses` acepta `shared` (boolean; en MVP todo es `false`), `sort` admite `expenseDate` (default `expenseDate,desc`), `amountMinor` y `createdAt`; `from`/`to` inclusivos y `from > to` → `400`; `q` busca en la descripción (contiene, sin distinguir mayúsculas); `totalFiltered` suma todo el filtro (no solo la página), una entrada por moneda. `Expense` devuelve `shared` (siempre `false` hasta Fase 2). `PUT/DELETE` de un gasto `PURCHASE` → `409 CONFLICT`; borrado lógico (luego `404`). `amount.currency` ≠ moneda base del hogar → `422 UNSUPPORTED_CURRENCY`; `amount.amountMinor <= 0`, `paidBy` que no sea miembro activo del hogar o `categoryId` inexistente → `400 VALIDATION_ERROR`.

- BL-107 (revisión): `description` de gasto: máx. 255 caracteres. `GET /expenses` declara `400` (rango `from > to`, `size` fuera de 1..100, `sort` inválido). `DELETE /expenses/{id}` no devuelve `422` (solo `404` y `409`). Edición/borrado concurrentes del mismo gasto usan bloqueo optimista: el perdedor recibe `409 CONFLICT` (reintentar). `PUT /expenses/{id}` exige que `paidBy` sea miembro activo solo si cambia (un gasto histórico con pagador desactivado sigue editable). `DELETE /categories/{id}` → `409 CONFLICT` también si la categoría tiene gastos (incluidos los borrados lógicamente).

- BL-105: Listas de compra (CRUD). Solo una lista `OPEN` admite cambios: renombrar, archivar y alta/edición/baja de ítems sobre una lista `ARCHIVED`/`COMPLETED` → `422 LIST_NOT_OPEN` (`GET` y `duplicate` siempre funcionan). `PATCH /shopping-lists/{id}` con `status` distinto de `ARCHIVED` → `400`; body vacío es no-op. `duplicate` copia solo ítems sin tildar (cantidad, unidad, precio estimado, nota) a una lista `OPEN` nueva; nombre por defecto `"<nombre> (copia)"`; `createdBy` = quien duplica. `POST …/items` con mismo producto+unidad suma cantidades y responde `201` con el ítem existente (el estado `checked` no cambia; `estimatedPrice`/`note` se pisan solo si vienen). `PATCH …/items/{itemId}` que dejaría dos ítems con igual producto+unidad → `409`; `estimatedPrice` no se puede borrar (solo reemplazar), `note` vacía la borra. `quantity` es un decimal positivo con hasta 3 decimales (se devuelve siempre con 3, p. ej. `"1.500"`); `estimatedPrice` es `Money` con `amountMinor >= 0` y moneda base del hogar (otra → `422 UNSUPPORTED_CURRENCY`); producto inexistente o de otro hogar → `404`. `GET /shopping-lists` ordena por `createdAt desc` por defecto (`sort`: `createdAt`, `name`); los ítems del detalle van sin tildar primero, luego tildados (UC-11). Se agrega `409` a `POST/PATCH` de ítems y `422` a `DELETE` de ítem en `openapi.yaml`. Migración V3 agrega `estimated_price_currency` a `shopping_list_item` (el modelo de datos solo listaba `estimated_price_minor`) y `created_at`/`updated_at`.

- BL-106: Stock. Orden de `GET /stock` fijo (FEFO), por eso se quita el parámetro `sort`; `status` default `ACTIVE`; `location` compara sin distinguir mayúsculas; `expiry` excluye ítems sin vencimiento. `expiryStatus` y los filtros/alertas usan "hoy" en la zona del hogar. Cantidades se devuelven con 3 decimales (`"1.500"`) y se validan como decimal ≤ 3 decimales, `> 0` (en `PATCH` se admite `0`). Sin stock suficiente (por producto o por lote) → `422 INSUFFICIENT_STOCK` (UC-32 decía 400; manda el contrato). Consumo por producto solo usa lotes de la misma `unit` (sin conversión de unidades); si hay otras unidades no cuentan. Operar (`PATCH`, `consume`, `discard`) sobre un lote que no está `ACTIVE` → `409 CONFLICT`; producto o lote inexistente/de otro hogar → `404`. `PATCH`: campos ausentes = sin cambios (no permite borrar `expiryDate`/`location`), `quantity` es el nuevo remanente y registra un `ADJUST` con la diferencia con signo; llegar a 0 pasa el lote a `CONSUMED`. `discard` conserva el remanente en el lote (estadísticas de desperdicio) y el body es opcional. `GET /stock/summary` agrupa lotes `ACTIVE` por producto **y unidad**, ordenado por nombre. `stock_item.purchase_item_id` queda sin FK en V4; BL-108 la agrega junto con `purchase_item` (V6).

- BL-108: Compras. `POST /shopping-lists/{id}/complete` y `POST /purchases` son transaccionales (ADR-007): gasto `PURCHASE`, compra + ítems, lotes de stock (con movimiento `IN`) y lista `COMPLETED` se persisten juntos o no se persiste nada. La lista se bloquea durante la operación: dos "completar" simultáneos → uno `201` y el otro `422 LIST_NOT_OPEN`; lista de otro hogar → `404`. `listItemId` debe ser un ítem de esa lista y no repetirse (si no, `400`); un ítem sin `listItemId` es un extra no listado. Con `leftoverAction=NEW_LIST` la lista nueva (`"<nombre> (pendientes)"`) recibe los ítems **sin tildar que no se compraron**; si no hay ninguno no se crea lista (el contrato de `Purchase` no devuelve su id: se obtiene con `GET /shopping-lists?status=OPEN`). `total` y `unitPrice` deben estar en la moneda base (`422 UNSUPPORTED_CURRENCY`); `total <= 0`, `items` vacío, `paidBy` que no sea miembro activo del hogar → `400`; producto inexistente/de otro hogar → `404`. Total de cada línea = `round(quantity × unitPrice)` (half-up, en unidades menores). Vencimiento del lote: `expiryDate` informado o `purchaseDate + defaultShelfLifeDays`; sin ninguno, sin vencimiento. Descripción del gasto: `"Compra <store | nombre de la lista>"`. `shared` se acepta pero se ignora hasta Fase 2. `GET /purchases`: `from`/`to` inclusivos sobre `purchaseDate` (`from > to` → `400`), `store` busca por contiene sin distinguir mayúsculas, `sort` admite `purchaseDate` (default `purchaseDate,desc`), `totalMinor` y `createdAt`. `PUT /purchases/{id}`: campos ausentes = sin cambios (no permite borrar `store`), `items` (obligatorio, no vacío) **reemplaza** los ítems y recalcula el gasto (monto, fecha, pagador, descripción). Los lotes de stock ya creados no se modifican al editar (reflejan lo que hay en la alacena): quedan con `purchase_item_id = NULL` (FK `ON DELETE SET NULL`, V6). Cambio de modelo: `purchase_item.position` (orden de las líneas) y `purchase.created_by/created_at/updated_at`.

- BL-108 (revisión): toda mutación de una lista (renombrar/archivar, alta/edición/baja de ítems) toma el mismo lock de fila que "completar": una operación concurrente espera y, si la lista ya se completó, responde `422 LIST_NOT_OPEN` (no pisa el estado ni agrega ítems a una lista `COMPLETED`). Un `listItemId` debe ir con el mismo `productId` del ítem de la lista (si no, `400` sobre `items[i].productId`). `PUT /purchases/{id}` con `store` en blanco → `400` (ausente = sin cambios; el comercio no se puede borrar). `purchaseDate` debe estar entre 1900-01-01 y 2100-12-31 (`400`); el `expiryDate` informado debe estar en rango también al editar, y un vencimiento calculado por `defaultShelfLifeDays` fuera de rango → `400` sobre `items[i].expiryDate` (hay que informarlo). `api/openapi.yaml` declara `400` en `GET /purchases`, `404` en `POST /purchases` y `minItems: 1` en `items`. Se pueden comprar productos archivados.

- BL-110: Reportes (UC-23). `GET /expenses/summary` devuelve **una fila por (grupo, moneda)** (nunca suma monedas distintas) y excluye gastos borrados. `groupBy` es obligatorio (`month|category|store`; otro valor o ausente → `400`), `from`/`to` inclusivos sobre `expenseDate` (`from > to` → `400`). `month`: `key`/`label` = `YYYY-MM`, orden cronológico. `category`: `key` = id de la categoría, `label` = nombre; sin categoría → `key=uncategorized`, `label="Sin categoría"`: como los gastos de compras no tienen categoría propia (`category_id` null), **todo el gasto de compras cae en esa fila** (el modelo no cambia; solo los gastos manuales con categoría se reparten). `store`: solo gastos `source=PURCHASE` (el comercio sale de la compra; los manuales no entran), agrupa sin distinguir mayúsculas ni espacios en los bordes (`key` en minúsculas, `label` = una de las grafías); compra sin comercio → `key=""` (vacía: no puede colisionar con un comercio real, que siempre tiene texto), `label="Sin comercio"`. Σ por comercio ≤ Σ por mes: los gastos manuales no tienen comercio y no se listan. `month` no rellena los meses sin gastos (el front completa los huecos). `category`/`store` ordenan por moneda y total descendente. Las fechas son `DATE` de calendario (ya en la zona del hogar), por lo que el agrupado por mes no requiere conversión de zona. `GET /products/{id}/price-history`: un punto por línea de compra (`unitPrice` de la línea, `date` = `purchaseDate`, `store` de la compra, moneda de la compra), orden cronológico ascendente; sin compras → `[]`; `from > to` → `400` (se agrega al contrato); producto de otro hogar o inexistente → `404`; incluye productos archivados. `PricePoint` lleva `unit` (la de la línea de compra) y el precio es por esa unidad: **no se convierte** KG↔G ni L↔ML; el parámetro opcional `unit` filtra la serie a una unidad (`unit` inválida → `400`). Sin paginación (una fila por compra del producto).
