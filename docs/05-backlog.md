# 05 — Backlog

Formato: `ID · título · [tamaño S/M/L] · deps` + descripción y criterios de aceptación (CA). Estado: `TODO | WIP | DONE`.
Tamaño sugiere el modelo: **S** = modelo barato alcanza; **M** = modelo intermedio; **L** = modelo capaz / revisar con cuidado.
Referencias: UC = `01-use-cases.md`, DM = `03-domain-model.md`, API = `04-api-interfaces.md`, ADR = `02-architecture-decisions.md`.

---

## Fase 0 — Fundaciones

**BL-001 · Scaffolding del monorepo [S] · —** · `DONE`
Crear estructura de ADR-003/`02` (carpetas `backend`, `frontend`, `api`), `.gitignore`, `.editorconfig`, `CLAUDE.md` raíz apuntando a `docs/README.md`.
CA: estructura creada; README raíz con cómo levantar el proyecto.

**BL-002 · Backend Spring Boot base [S] · BL-001** · `TODO`
Gradle KTS, Spring Boot 3, Kotlin, JDK 21; dependencias: web, validation, data-jpa, security, flyway, postgres, actuator, springdoc, testcontainers, mockk, ktlint. Paquete `ar.hogar`. Endpoint `/actuator/health`.
CA: `./gradlew build` pasa; app arranca contra Postgres; test de contexto con Testcontainers verde.

**BL-003 · Localdev: perfil Spring `local` y conexión a Postgres [S] · BL-002** · `TODO`
La infraestructura ya existe (`docker-compose.yml`, `.env.example`, `Makefile`, `scripts/`; ver `06-local-dev.md`). Falta el lado Spring: `application-local.yml` y `application-test.yml` según la sección "Especificación para el backend" de `06`, devtools, Swagger UI solo en `local`.
CA: `make up && make backend` arranca y `/actuator/health` responde 200; `make seed` crea el owner dev; `make smoke` pasa sin fallidos (con secciones salteadas).

**BL-004 · OpenAPI inicial [M] · BL-001** · `TODO`
Redactar `api/openapi.yaml` (3.1) desde `04-api-interfaces.md` para Fase 1 (auth, catálogo, listas, compras, gastos, stock). Incluir esquemas `Money`, `Page`, `Problem`.
CA: validado con un linter (`redocly lint`/`spectral`); sin referencias rotas.

**BL-005 · Frontend base [S] · BL-001** · `TODO`
Vite + React + TS strict, Tailwind, shadcn/ui, React Router, TanStack Query, ESLint+Prettier, Vitest+RTL+MSW. Layout con navegación (Listas, Gastos, Stock) mobile-first.
CA: `npm run dev/build/test/lint` pasan; PWA manifest básico.

**BL-006 · Cliente API generado [S] · BL-004, BL-005** · `TODO`
Script `npm run gen:api` con `openapi-typescript` + fetch wrapper (`openapi-fetch`) con manejo de token y errores Problem.
CA: tipos generados versionados o generados en build; un hook de ejemplo funcionando.

**BL-007 · CI [S] · BL-002, BL-005** · `TODO`
GitHub Actions: job backend (build+test) y frontend (lint+test+build).
CA: pipeline verde en PR.

**BL-014 · CI: escaneo de secretos obligatorio [S] · BL-007** · `TODO`
Job `secrets` en GitHub Actions que ejecute `python3 -I scripts/check_secrets.py --all` y `make test-hooks` en cada PR; marcarlo como check requerido en la protección de rama de `main`. Activar *secret scanning* y *push protection* de GitHub en el repo. Los hooks locales ya existen (ver `07-sensitive-data.md`).
CA: un PR con una credencial falsa de prueba (formato real, valor generado) falla el job y no se puede mergear; PR limpio pasa.

**BL-012 · Localdev: base de tests rápida [M] · BL-002, BL-003** · `TODO`
Implementar la escalera de verificación de `06-local-dev.md`: clase base `IntegrationTestBase` con Postgres singleton (Testcontainers reuse) y limpieza de tablas por test; convención de nombres `*UnitTest` / `*IntegrationTest`; tareas Gradle `ktlintCheck`; scripts npm `lint`, `typecheck`, `test` en el frontend.
CA: `make test-fast` < 15 s y sin Docker; `make test-backend` reutiliza el contenedor entre corridas; `make verify` corre lint + tests + build en limpio.

**BL-008 · Módulo common: Money, errores, paginación [M] · BL-002** · `TODO`
`Money` (Long+Currency), `CurrencyPolicy` (solo moneda base, ADR-004), jerarquía `DomainException`, `@RestControllerAdvice` a RFC 7807 con `code`, mappers de `Page`.
CA: tests unitarios de Money y del mapeo de errores (400/404/409/422 con códigos de `04`).

**BL-009 · Allocator (mayor resto) [M] · BL-002** · `TODO`
Implementar `Allocator.allocate` según DM §Split. Tests de propiedades (suma exacta, determinismo, ejemplos 100/3, pesos cero, ceros).
CA: ≥ 8 tests; sin dependencias de Spring.

---

## Fase 1 (MVP) — Backend

**BL-101 · Migración V1: household, member, refresh_token [S] · BL-003** · `TODO`
CA: Flyway aplica en Testcontainers; constraints de DM presentes.

**BL-102 · Auth: registro owner, login, refresh, logout [L] · BL-101, BL-008** · `TODO`
UC-01, UC-02. Spring Security stateless, JWT HS256 (secreto por env), refresh con hash y rotación (ADR-008), BCrypt.
CA: tests de integración: registro (409 si ya existe hogar), login ok/inválido (401), refresh rota token (reuso del viejo → 401), rutas protegidas sin token → 401.

**BL-103 · Miembros y hogar [M] · BL-102** · `TODO`
UC-03: `GET/POST/PATCH /members`, `PUT /household`, `GET /me`. Roles (`@PreAuthorize`).
CA: MEMBER no puede crear (403); desactivado no loguea.

**BL-104 · Migración V2 + módulo catálogo [M] · BL-103** · `TODO`
Tablas `category`, `product`; endpoints de categorías y productos con búsqueda `q`, archivado. UC-04.
CA: nombre único case-insensitive (409); no se borra categoría con productos (409); búsqueda paginada.

**BL-105 · Migración V3 + listas de compra (CRUD) [M] · BL-104** · `TODO`
`shopping_list`, `shopping_list_item`; UC-10, UC-11, UC-15 (duplicar/archivar). Suma de cantidades si repite producto+unidad.
CA: tests de cada endpoint de `04` §Listas excepto `suggestions` y `complete`; lista no-OPEN es de solo lectura (422 `LIST_NOT_OPEN`).

**BL-106 · Migración V4 + módulo stock [L] · BL-104** · `TODO`
`stock_item`, `stock_movement`; UC-30–34. Alta manual, consumo FEFO por producto y por lote, descarte, alertas, summary, `expiryStatus` calculado con zona del hogar.
CA: tests unitarios de FEFO (con NULLs al final, consumo que cruza varios lotes, `INSUFFICIENT_STOCK`); tests de estados de vencimiento con reloj inyectable (`Clock`).

**BL-107 · Migración V5 + gastos manuales e histórico [M] · BL-104, BL-008** · `TODO`
`expense`; UC-20, UC-21. Filtros, paginación, `totalFiltered`, soft delete, restricción para `source=PURCHASE`. Campos de split/shared se persisten pero la lógica de reparto queda para P2 (devolver `shared=false`).
CA: tests de filtros combinados; índices presentes; moneda distinta a la base → 422 `UNSUPPORTED_CURRENCY`.

**BL-108 · Compras + completar lista (UC-13/14/22) [L] · BL-105, BL-106, BL-107** · `TODO`
Migración V6 (`purchase`, `purchase_item`). `PurchaseService.completeList` transaccional según DM §Completar lista y ADR-007. `POST /purchases`, `GET/PUT /purchases`.
CA: test de integración del flujo completo (lista → compra → gasto + stock + lista COMPLETED); rollback total si falla el alta de stock (test forzando error); reintento → `LIST_NOT_OPEN`; `leftoverAction=NEW_LIST` crea lista con los no tildados; vencimiento por `defaultShelfLifeDays`; editar compra recalcula el gasto.

**BL-109 · Sugerencias de lista [M] · BL-106, BL-108** · `TODO`
UC-12, DM §Sugerencias.
CA: tests con datos: producto sin stock tras compra previa, producto por vencer, exclusión de ya listados.

**BL-110 · Reportes de gasto [M] · BL-107, BL-108** · `TODO`
`GET /expenses/summary` (mes/categoría/comercio), `GET /products/{id}/price-history`. UC-23.
CA: tests de agregación con varios meses y categorías; montos por moneda.

**BL-111 · Seed de datos de desarrollo [S] · BL-108** · `TODO`
Perfil `local` carga categorías comunes (Almacén, Lácteos, Limpieza, Verdura, Carne, Bebidas, Higiene) y ~30 productos con vida útil típica.
CA: arranque con perfil `local` los carga una sola vez (idempotente).

**BL-013 · Localdev: verificación continua del smoke [S] · BL-102, BL-108** · `TODO`
Extender `scripts/smoke.sh` a medida que se agregan endpoints (stock, gastos, sugerencias) y sumar un job opcional de CI que levante Postgres, arranque el backend y ejecute `make smoke`.
CA: el smoke cubre UC-13 completo (lista → compra → gasto + stock) y falla si se rompe el flujo.

---

## Fase 1 (MVP) — Frontend

**BL-151 · Auth UI [M] · BL-006, BL-102** · `TODO`
Pantallas: registro de hogar (si no existe), login. Guardado de tokens, refresh automático, rutas protegidas, logout.
CA: tests RTL del flujo; redirección al expirar sesión.

**BL-152 · Catálogo UI [S] · BL-151, BL-104** · `TODO`
ABM de categorías y productos; componente `ProductPicker` (autocompletado con creación al vuelo) reutilizable.
CA: búsqueda con debounce; test del picker.

**BL-153 · Listas de compra UI [L] · BL-152, BL-105** · `TODO`
Listado de listas, detalle con alta rápida de ítems, tildado, contador, duplicar/archivar. Optimistic updates en tildado.
CA: usable en 375 px; tildar actualiza en < 100 ms percibidos; tests de interacción.

**BL-154 · Finalizar compra UI [L] · BL-153, BL-108** · `TODO`
Wizard UC-13: revisar ítems tildados (cantidad/precio/vencimiento), comercio/fecha/pagador/total, qué hacer con no tildados. Manejo de errores `LIST_NOT_OPEN`.
CA: total por defecto = suma; validaciones Zod; flujo completo con MSW; `lib/money.ts` con tests (parseo "1.500,50" ↔ minor units).

**BL-155 · Gastos UI [M] · BL-151, BL-107** · `TODO`
Histórico con filtros y total filtrado, alta/edición manual, detalle de compra.
CA: paginación infinita o por páginas; filtros reflejados en la URL.

**BL-156 · Stock UI [M] · BL-151, BL-106** · `TODO`
Listado agrupado por vencimiento con badges de estado, alta manual, consumir (rápido: botones −1/todo), descartar, banner de alertas.
CA: colores accesibles (no solo color); consumo desde la lista en ≤ 2 toques.

**BL-157 · Sugerencias en la lista [S] · BL-153, BL-109** · `TODO`
Panel "Te puede faltar" con botón agregar.
CA: agregar una sugerencia la suma a la lista y la saca del panel.

**BL-158 · Dashboard y reportes [M] · BL-155, BL-110** · `TODO`
Gasto mensual, por categoría, evolución de precio de producto (gráficos con Recharts).
CA: estados vacíos; consistente con totales del histórico.

**BL-159 · PWA y pulido móvil [M] · BL-153..BL-158** · `TODO`
Service worker (cache de shell), instalable, íconos, estados de carga/error uniformes, textos en español.
CA: Lighthouse PWA instalable; sin overflow horizontal en 360 px.

**BL-160 · docker-compose completo y README de arranque [S] · BL-159** · `TODO`
Dockerfiles backend/frontend (nginx), servicios `backend` y `frontend` en el compose existente bajo el profile `full`, script de backup `pg_dump`.
CA: `docker compose --profile full up` deja la app funcional en localhost; `make smoke` pasa contra ese stack.

> **Hito MVP**: BL-001 … BL-160 (incluye BL-012 y BL-013) en `DONE`.

> **Definition of Done (toda tarea)**: `make verify` en verde (incluye el escaneo de secretos); si toca endpoints, `make smoke` sin fallidos; docs/contrato actualizados si cambió algo; datos de prueba según `07-sensitive-data.md`.

---

## Fase 2 — Gastos compartidos y contribución

**BL-201 · Migración: expense_split, income, settlement [M] · MVP** · `TODO`
CA: constraints de DM (UNIQUE, CHECK de `from<>to`, `share>=0`).

**BL-202 · Ingresos y % de contribución [M] · BL-201, BL-009** · `TODO`
UC-50, UC-51. Ingreso vigente por fecha, privacidad (ADR-009), `GET /contribution` con `suggestedShare`.
CA: % suma 100,00; miembros sin ingreso en `missingIncome`; MEMBER no ve sueldos ajenos (403).

**BL-203 · Splits al crear/editar gastos [L] · BL-202** · `TODO`
UC-40: modos CONTRIBUTION/EQUAL/CUSTOM usando `Allocator`; pesos según ingresos vigentes a `expense_date` (ADR-006); integrar en `completeList` (compras compartidas por defecto); regenerar splits al editar; backfill opcional de gastos existentes (`shared=false`, sin splits).
CA: Σ splits = monto siempre; `CUSTOM` con suma incorrecta → 422 `SPLIT_SUM_MISMATCH`; cambiar sueldo no altera splits previos.

**BL-204 · Balances y simplificación de deudas [L] · BL-203** · `TODO`
UC-41, UC-43. DM §Balance y greedy.
CA: invariante Σ net = 0 en tests de propiedades; ejemplo de 3 miembros con transferencias mínimas; filtro por fechas.

**BL-205 · Liquidaciones [S] · BL-204** · `TODO`
UC-42. CRUD con soft delete; afecta el balance.
CA: liquidación total deja net=0 y sin transfers.

**BL-251 · UI ingresos y contribución [M] · BL-202** · `TODO`
Pantalla "Contribución": ingreso propio, % por miembro, calculadora de cuota. Owner ve todos.
CA: miembro no ve sueldos ajenos en la UI.

**BL-252 · UI gastos compartidos [M] · BL-203, BL-155** · `TODO`
Toggle "compartido", modo de reparto, editor de `CUSTOM`; checkbox "compartida" en finalizar compra.
CA: validación en vivo de suma en `CUSTOM`.

**BL-253 · UI balances y liquidaciones [M] · BL-204, BL-205** · `TODO`
Pantalla "Cuentas": saldo por miembro, "quién le debe a quién", registrar pago, filtro por mes.
CA: coincide con la API; estado "todo saldado".

---

## Fase 3 — Extras (nice-to-have)

**BL-301 · Multimoneda: diseño [M]** · `TODO`
ADR nuevo: tipo de cambio manual por fecha vs API externa; ingresos en otra moneda; conversión para contribución y reportes. Entregable: ADR + actualización de `03` y `04`.
CA: ADR-0xx aceptado en `02-architecture-decisions.md`; `03` y `04` describen `fx_rate`, campos nuevos de `expense` y endpoints; sin código de aplicación.

**BL-302 · Multimoneda: implementación backend [L] · BL-301** · `TODO`
`fx_rate`, gastos en USD/ARS, balances por moneda, relajar `CurrencyPolicy`.
CA: se puede crear un gasto en USD con tipo de cambio manual; los balances siguen separados por moneda; migraciones sin romper datos existentes; tests de conversión y de `CurrencyPolicy`.

**BL-303 · Multimoneda: UI [M] · BL-302** · `TODO`
Selector de moneda en gastos, totales por moneda en listados y balances, carga del tipo de cambio.
CA: un gasto en USD se carga y se muestra con su moneda; los totales no mezclan monedas; tests de formularios con MSW.

**BL-304 · Override manual de contribución [S] · BL-202** · `TODO`
UC-52: el owner fija porcentajes manuales que reemplazan el cálculo automático (`contribution_override`).
CA: los % manuales deben sumar 100 (422 si no); `GET /contribution` los usa cuando existen; solo el owner puede definirlos; los gastos ya creados no cambian (ADR-006).

**BL-305 · Notificaciones web push de vencimiento [M]** · `TODO`
Enviar notificaciones web push a los miembros suscriptos cuando haya productos por vencer o vencidos (UC-34, fase P3). Requiere suscripción desde la PWA y claves VAPID por entorno.
CA: el job diario envía una notificación por miembro con el resumen de vencimientos; no se reenvía lo ya notificado; claves VAPID solo por variables de entorno (sin secretos en el repo); tests con un servicio de push falso.

**BL-306 · Tiempo real en listas (SSE) [M]** · `TODO`
Los cambios en una lista de compra (ítems agregados, tildados, eliminados) se propagan por Server-Sent Events a los demás miembros que la tienen abierta.
CA: dos clientes ven los cambios del otro sin refrescar; la conexión SSE se autentica con el mismo JWT; reconexión automática en el frontend; test de integración con dos suscriptores.

**BL-307 · Despliegue cloud + backups automáticos [M]** · `TODO`
Desplegar backend, frontend y Postgres gestionado en el proveedor elegido (ver riesgo R5 en `02`), con variables de entorno y secretos del proveedor, y backups automáticos de la base.
CA: la app funciona en una URL pública con HTTPS; los secretos viven solo en el gestor del proveedor; backup diario verificado con una restauración de prueba; runbook en `docs/`.

**BL-308 · Presupuestos por categoría y alertas [M]** · `TODO`
Presupuesto mensual por categoría de gasto y aviso cuando se supera un umbral (ej. 80% y 100%).
CA: CRUD de presupuestos por categoría y mes; endpoint con consumo vs presupuesto; la UI muestra el estado y marca las categorías excedidas; tests de cálculo con gastos en distintos meses.

---

## Orden sugerido de ejecución del MVP

```
BL-001 → BL-002 → BL-003/005 (paralelo) → BL-012 → BL-004 → BL-006/007/008/009
→ BL-101 → BL-102 → BL-103 → BL-104
→ BL-105 ∥ BL-106 ∥ BL-107 → BL-108 → BL-109/110/111
Frontend en paralelo, siguiendo deps: 151 → 152 → 153 → 154 …
```
