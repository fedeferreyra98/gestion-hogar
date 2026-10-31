# 01 — Casos de uso

Actores: **Miembro** (usuario autenticado del hogar), **Owner** (miembro que creó el hogar; puede invitar/desactivar miembros), **Sistema** (jobs programados).
Fase: **P1** = MVP, **P2** = gastos compartidos, **P3** = extras.

## Glosario

- **Producto**: ítem del catálogo (ej. "Leche"). Reutilizable entre listas, compras y stock.
- **Lista de compra**: conjunto de ítems a comprar. Estados: `OPEN`, `COMPLETED`, `ARCHIVED`.
- **Compra (Purchase)**: registro de una ida de compras realizada, con precios reales. Genera un gasto.
- **Gasto (Expense)**: egreso de dinero. Puede provenir de una compra o cargarse manualmente.
- **Ítem de stock**: unidad/lote de un producto en la casa, con cantidad y fecha de vencimiento opcional.
- **Monto**: siempre `(amountMinor: entero en unidades menores, currency: código ISO 4217)`. Ej. $1.500,50 ARS = `150050 ARS`.

---

## Autenticación y hogar

### UC-01 Registrar el hogar (P1)
- Primer arranque: si no existe hogar, `POST /auth/register-owner` crea el hogar y el primer miembro (Owner).
- **Reglas**: solo se permite si no existe ningún hogar. Email único. Password mín. 8 caracteres.
- **Aceptación**: tras registrar, se puede loguear; un segundo intento devuelve 409.

### UC-02 Login (P1)
- Email + password → access token JWT (1 h) + refresh token (30 d).
- **Aceptación**: credenciales inválidas → 401 genérico (sin revelar si el email existe).

### UC-03 Invitar / gestionar miembros (P1)
- Owner crea un miembro con email, nombre y password temporal (en local no hay envío de emails).
- Owner puede desactivar un miembro (no se borra: conserva histórico).
- **Aceptación**: un miembro desactivado no puede loguearse y no aparece en nuevos splits, pero sí en el histórico.

---

## Catálogo de productos

### UC-04 Gestionar productos y categorías (P1)
- CRUD de categorías (ej. Lácteos, Limpieza) y productos (nombre, categoría, unidad por defecto, `defaultShelfLifeDays` opcional).
- Unidades permitidas: `UNIT`, `KG`, `G`, `L`, `ML`, `PACK`.
- **Reglas**: nombre de producto único (case-insensitive) por hogar. No se borra un producto con referencias: se archiva (`archived=true`).
- **Aceptación**: búsqueda por nombre (`?q=`) con autocompletado por prefijo/contiene.

---

## 1) Listas de compra

### UC-10 Crear y editar lista (P1)
- Crear lista con nombre. Agregar ítems: eligiendo producto existente o texto libre (se crea el producto al vuelo si el usuario lo pide).
- Cada ítem: cantidad, unidad, precio estimado opcional, nota opcional.
- **Reglas**: si se agrega un producto que ya está en la lista, se suma la cantidad (misma unidad) en vez de duplicar.
- **Aceptación**: varios miembros ven la misma lista; los cambios se reflejan al refrescar (sin tiempo real en MVP).

### UC-11 Tildar ítems durante la compra (P1)
- Marcar/desmarcar ítem como comprado (`checked`). Funciona bien en móvil (PWA).
- **Aceptación**: ítems tildados se ordenan al final; contador "X de Y".

### UC-12 Sugerir ítems faltantes (P1)
- Al crear/editar una lista, el sistema sugiere: (a) productos con stock bajo/agotado (stock = 0 y comprados antes), (b) productos con stock vencido o por vencer en ≤ 3 días.
- **Aceptación**: `GET /shopping-lists/suggestions` devuelve productos con motivo (`OUT_OF_STOCK`, `EXPIRING`, `EXPIRED`). Agregar la sugerencia a la lista es una acción explícita del usuario.

### UC-13 Completar lista → registrar compra (P1) — caso de uso central
- Desde una lista `OPEN`, "Finalizar compra": el usuario confirma por cada ítem tildado cantidad real y precio real (precargados con los estimados), indica comercio, fecha y total (por defecto suma de ítems), y quién pagó.
- El sistema, **en una sola transacción**:
  1. Crea `Purchase` + `PurchaseItem`s.
  2. Crea un `Expense` (source=`PURCHASE`) por el total.
  3. Crea `StockItem`s por cada ítem comprado (vencimiento opcional informado por el usuario; si falta y el producto tiene `defaultShelfLifeDays`, se calcula `fecha_compra + días`).
  4. Marca la lista `COMPLETED`.
- Ítems no tildados: el usuario elige "dejar en nueva lista" (se crea lista nueva `OPEN` con ellos) o descartarlos.
- **Reglas**: si falla algún paso, no se persiste nada. El total de la compra debe ser > 0.
- **Aceptación**: tras completar, existe el gasto en el histórico, el stock refleja lo comprado y la lista queda de solo lectura.

### UC-14 Compra sin lista (P1)
- Registrar una compra directamente (sin lista previa) con los mismos efectos que UC-13.

### UC-15 Duplicar / archivar lista (P1)
- Duplicar una lista como plantilla (ej. "compra semanal"). Archivar listas viejas.

---

## 2) Histórico de gastos

### UC-20 Consultar histórico de gastos (P1)
- Listado paginado con filtros: rango de fechas, categoría, pagador, texto, fuente (`PURCHASE`/`MANUAL`). Orden por fecha desc.
- **Aceptación**: el total del filtro se muestra junto al listado.

### UC-21 Cargar gasto manual (P1)
- Gasto no asociado a una lista (ej. "Luz", "Alquiler", "Internet"): descripción, monto, fecha, categoría, pagador.
- Editable y eliminable (eliminar = soft delete). No se puede editar/eliminar el gasto de una compra directamente: se edita la compra.

### UC-22 Ver detalle de compra (P1)
- Ver ítems con precios, comercio y total. Corregir precios/cantidades de una compra recalcula su gasto asociado (no toca stock ya consumido).

### UC-23 Resumen y estadísticas (P1)
- Gasto total por mes, por categoría, por comercio; evolución de precio unitario de un producto.
- **Aceptación**: endpoints de agregación (ver `04`), gráficos simples en el front.

---

## 3) Stock con vencimientos

### UC-30 Ver stock (P1)
- Listado de ítems de stock activos agrupados por producto, ordenado por vencimiento más próximo. Indicadores: `OK`, `EXPIRING_SOON` (≤ N días, N configurable, default 3), `EXPIRED`.
- Filtros: categoría, ubicación (despensa/heladera/freezer, texto libre), estado de vencimiento.

### UC-31 Alta manual de stock (P1)
- Agregar stock sin compra (ej. lo que ya había en casa): producto, cantidad, unidad, vencimiento, ubicación.

### UC-32 Consumir stock (P1)
- Registrar consumo parcial o total de un ítem de stock. Si cantidad llega a 0 → estado `CONSUMED`.
- Al consumir un producto sin especificar lote, se descuenta primero del que vence antes (FEFO).
- **Reglas**: no se puede consumir más que la cantidad disponible (400).

### UC-33 Descartar stock (P1)
- Marcar ítem como `DISCARDED` (vencido/tirado) con motivo opcional. Se conserva para estadísticas de desperdicio.

### UC-34 Alertas de vencimiento (P1)
- Job diario (Sistema) calcula ítems por vencer/vencidos. En MVP se expone como endpoint `GET /stock/alerts` y badge en el front (sin push ni email).
- Fase P3: notificaciones web push.

---

## 4) Gastos compartidos (P2)

### UC-40 Marcar gasto como compartido (P2)
- Cada gasto tiene `shared` (bool), `paidBy` (miembro) y `splitMode`: `CONTRIBUTION` (default, según % de contribución), `EQUAL`, `CUSTOM` (montos manuales que deben sumar el total).
- Las compras (UC-13) son compartidas por defecto, configurable por hogar.
- **Reglas**: el reparto se calcula con el algoritmo de `03-domain-model.md` §Split; la suma de las partes = total exacto (sin pérdida de centavos). Los splits se guardan al crear el gasto (foto histórica: cambiar sueldos luego NO recalcula gastos pasados).

### UC-41 Ver balance entre miembros (P2)
- Para cada miembro: cuánto pagó, cuánto le correspondía, saldo neto. Y lista simplificada de "quién le debe a quién cuánto".
- Se calcula por moneda por separado.
- **Aceptación**: la suma de saldos netos de todos los miembros = 0.

### UC-42 Registrar liquidación (P2)
- Registrar que A le pagó $X a B para saldar deuda. Reduce la deuda en el balance. Editable/eliminable (soft delete).

### UC-43 Histórico de un período (P2)
- Balance filtrado por rango de fechas (ej. "mes de octubre").

---

## 5) Contribución al hogar (P2)

### UC-50 Cargar ingresos de miembros (P2)
- Cada miembro tiene un historial de ingresos mensuales con `effectiveFrom` (fecha de vigencia). Solo se ve/edita el propio; el Owner ve todos (decisión de privacidad: ver ADR-009).
- **Reglas**: ingreso > 0. El vigente es el de mayor `effectiveFrom` ≤ hoy.

### UC-51 Calcular % de contribución (P2)
- `pct_i = ingreso_i / Σ ingresos` de los miembros activos con ingreso vigente. Se expresa con 2 decimales y suma exacta 100,00 (método de mayor resto).
- Miembros sin ingreso cargado: excluidos del cálculo y se muestra advertencia.
- **Aceptación**: `GET /contribution` devuelve % por miembro y la "cuota sugerida" para un gasto mensual objetivo (parámetro opcional `monthlyBudgetMinor`).

### UC-52 Override manual (P3)
- Owner puede fijar % manuales que reemplazan el cálculo automático (ej. acuerdo distinto). Debe sumar 100.

---

## 6) Multimoneda (P3, nice-to-have)

### UC-60 Gastos en otra moneda (P3)
- Un gasto puede registrarse en USD o ARS. Se guarda moneda original y, opcionalmente, tipo de cambio usado.
- Balances se calculan por moneda; conversión a moneda base del hogar usando tipo de cambio manual por fecha.
- Ingresos pueden estar en distintas monedas; para la contribución se convierten a la moneda base.

---

## Requisitos no funcionales

- **Idioma UI**: español (rioplatense); código y API en inglés. Preparar i18n simple (archivos de mensajes).
- **Móvil primero**: UI usable con una mano en el súper; PWA instalable.
- **Precisión monetaria**: nunca `float`/`double`. Enteros en unidades menores (backend `Long`/`BigDecimal`, front `number` entero o `bigint`).
- **Seguridad**: contraseñas con BCrypt/Argon2; JWT; validación de entrada en backend; CORS restringido.
- **Rendimiento**: carga de listados < 300 ms con 10k gastos (índices en `expense_date`, `category_id`).
- **Auditoría básica**: `created_at`, `updated_at`, `created_by` en entidades principales.
- **Backups**: script de `pg_dump` documentado para el entorno local.
