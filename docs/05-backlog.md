# 05 — Backlog

Formato: `ID · título · [tamaño S/M/L] · deps` + descripción y criterios de aceptación (CA). Estado: `TODO | WIP | DONE`.
Tamaño sugiere el modelo: **S** = modelo barato alcanza; **M** = modelo intermedio; **L** = modelo capaz / revisar con cuidado.
Referencias: UC = `01-use-cases.md`, DM = `03-domain-model.md`, API = `04-api-interfaces.md`, ADR = `02-architecture-decisions.md`.

Las tareas `TODO` usan bloques fijos: **Objetivo**, **Contexto** (estado real del código), **Alcance**, **Fuera de alcance**, **Supuestos de partida** (decisiones ya tomadas: no las reabras; si una resulta inviable, explicalo en el PR), **Tests** y `CA:` (lista verificable). Los issues de GitHub se generan desde este archivo: después de editarlo, `make issues-sync` actualiza los issues abiertos.

## Mapa del código real (leer antes de una tarea nueva)

La estructura de `02-architecture-decisions.md` es la idea original; el código quedó así y **manda el código**:

- **Backend** (`backend/src/main/kotlin/ar/hogar/`): un paquete plano por módulo, sin subcarpetas `api/domain/infra`. Módulos: `auth`, `member`, `catalog`, `shopping`, `purchase`, `expense`, `stock`, `suggestion`, `report`, `common`, `devseed`. Cada uno con `XController.kt`, `XDtos.kt`, `XEntities.kt`, `XRepositories.kt`, `XService.kt`. Los módulos se llaman por servicios (`ExpenseService.createFromPurchase`, `CatalogService.requireProduct`), nunca por repositorios ajenos. Los módulos de solo lectura (`report`, `suggestion`) usan un repositorio propio con SQL nativo.
- **Identidad**: los controllers reciben `@AuthenticationPrincipal jwt: Jwt` (claims `sub` = memberId, `hid` = householdId, `role`) y llevan `@PreAuthorize`. Toda consulta filtra por `householdId`.
- **Errores**: excepciones de `common/DomainException.kt` (`NotFoundException`, `ConflictException`, …) que `ApiExceptionHandler` convierte a RFC 7807. Moneda: `CurrencyPolicy`. Reloj: `Clock` inyectado (nunca `LocalDate.now()` directo).
- **Migraciones**: `backend/src/main/resources/db/migration/V{n}__*.sql`, inmutables. La última es **V6**; la próxima es **V7**. Cada migración tiene su `FlywayMigrationV{n}IntegrationTest`.
- **Tests backend**: `*IntegrationTest` extiende `IntegrationTestBase` (Postgres de Testcontainers + MockMvc, tablas truncadas antes de cada test). La lógica pura va en `*UnitTest` sin Spring; como los paquetes son planos, `make test-fast` solo levanta lo que termina en `UnitTest`.
- **Contrato**: primero `api/openapi.yaml` y `docs/04-api-interfaces.md` (anotar en "Cambios de contrato"), después `cd frontend && npm run gen:api` y commitear `frontend/src/api/schema.d.ts` (está versionado). El yaml hoy solo tiene Fase 1: cada tarea de backend de Fase 2/3 agrega sus propios paths y esquemas.
- **Frontend** (`frontend/src/`): una carpeta por feature en la raíz (`auth`, `catalog`, `shopping`, `expenses`, `stock`, `reports`), no `features/`. Pantallas en `pages/` o en la carpeta del feature, rutas en `AppRoutes.tsx` (en español: `/listas`, `/gastos`, …), navegación en `components/layout/nav-items.ts`. Hooks de TanStack Query en `api/hooks/use*.ts` sobre `getApiClient()`. React 19, Tailwind v4, Zod.
- **Formularios**: `useState` + esquema Zod (ver `expenses/ExpenseForm.tsx` y `shopping/complete/schema.ts`). React Hook Form **no** está instalado: no lo agregues.
- **Dinero en el front**: `lib/money.ts` (parseo `"1.500,50"` ↔ unidades menores, `lineTotalMinor` con BigInt). Cantidades: `lib/decimal.ts`. Errores de API: un `problems.ts` por feature traduce `ProblemError.code` a un mensaje en español; nunca se muestra el `detail` crudo del backend (está en inglés).
- **Tests frontend**: Vitest + RTL + MSW (`src/test/server.ts`, `onUnhandledRequest: 'error'`: todo request necesita handler). Un `*.test.tsx` por feature.
- **Smoke**: `scripts/smoke.sh` por secciones que se saltean solas con 404. Si la tarea agrega endpoints, suma una sección.

---

## Fase 0 — Fundaciones

**BL-001 · Scaffolding del monorepo [S] · —** · `DONE`
Crear estructura de ADR-003/`02` (carpetas `backend`, `frontend`, `api`), `.gitignore`, `.editorconfig`, `CLAUDE.md` raíz apuntando a `docs/README.md`.
CA: estructura creada; README raíz con cómo levantar el proyecto.

**BL-002 · Backend Spring Boot base [S] · BL-001** · `DONE`
Gradle KTS, Spring Boot 3, Kotlin, JDK 21; dependencias: web, validation, data-jpa, security, flyway, postgres, actuator, springdoc, testcontainers, mockk, ktlint. Paquete `ar.hogar`. Endpoint `/actuator/health`.
CA: `./gradlew build` pasa; app arranca contra Postgres; test de contexto con Testcontainers verde.

**BL-003 · Localdev: perfil Spring `local` y conexión a Postgres [S] · BL-002** · `DONE`
La infraestructura ya existe (`docker-compose.yml`, `.env.example`, `Makefile`, `scripts/`; ver `06-local-dev.md`). Falta el lado Spring: `application-local.yml` y `application-test.yml` según la sección "Especificación para el backend" de `06`, devtools, Swagger UI solo en `local`.
CA: `make up && make backend` arranca y `/actuator/health` responde 200; `make seed` crea el owner dev; `make smoke` pasa sin fallidos (con secciones salteadas).

**BL-004 · OpenAPI inicial [M] · BL-001** · `DONE`
Redactar `api/openapi.yaml` (3.1) desde `04-api-interfaces.md` para Fase 1 (auth, catálogo, listas, compras, gastos, stock). Incluir esquemas `Money`, `Page`, `Problem`.
CA: validado con un linter (`redocly lint`/`spectral`); sin referencias rotas.

**BL-005 · Frontend base [S] · BL-001** · `DONE`
Vite + React + TS strict, Tailwind, shadcn/ui, React Router, TanStack Query, ESLint+Prettier, Vitest+RTL+MSW. Layout con navegación (Listas, Gastos, Stock) mobile-first.
CA: `npm run dev/build/test/lint` pasan; PWA manifest básico.
Supuestos: shadcn/ui configurado a mano (`components.json` + `Button`), sin CLI; PWA = `manifest.webmanifest` + ícono SVG, sin service worker; Tailwind v4; React Router en modo declarativo (`BrowserRouter`); el dev server proxea `/api` a `localhost:8080`.

**BL-006 · Cliente API generado [S] · BL-004, BL-005** · `DONE`
Script `npm run gen:api` con `openapi-typescript` + fetch wrapper (`openapi-fetch`) con manejo de token y errores Problem.
CA: tipos generados versionados o generados en build; un hook de ejemplo funcionando.

**BL-007 · CI [S] · BL-002, BL-005** · `DONE`
GitHub Actions: job backend (build+test) y frontend (lint+test+build).
CA: pipeline verde en PR.

**BL-014 · CI: escaneo de secretos obligatorio [S] · BL-007** · `DONE`
Job `secrets` en GitHub Actions que ejecute `python3 -I scripts/check_secrets.py --all` y `make test-hooks` en cada PR; marcarlo como check requerido en la protección de rama de `main`. Activar *secret scanning* y *push protection* de GitHub en el repo. Los hooks locales ya existen (ver `07-sensitive-data.md`).
CA: un PR con una credencial falsa de prueba (formato real, valor generado) falla el job y no se puede mergear; PR limpio pasa.
Supuestos: la configuración de GitHub (check requerido `secrets` en protección de rama `main` + activación de *secret scanning* y *push protection*) queda documentada paso a paso en `docs/07-sensitive-data.md` y en el PR para ser aplicada manualmente por el administrador del repositorio.

**BL-012 · Localdev: base de tests rápida [M] · BL-002, BL-003** · `DONE`
Implementar la escalera de verificación de `06-local-dev.md`: clase base `IntegrationTestBase` con Postgres singleton (Testcontainers reuse) y limpieza de tablas por test; convención de nombres `*UnitTest` / `*IntegrationTest`; tareas Gradle `ktlintCheck`; scripts npm `lint`, `typecheck`, `test` en el frontend.
CA: `make test-fast` < 15 s y sin Docker; `make test-backend` reutiliza el contenedor entre corridas; `make verify` corre lint + tests + build en limpio.

**BL-008 · Módulo common: Money, errores, paginación [M] · BL-002** · `DONE`
`Money` (Long+Currency), `CurrencyPolicy` (solo moneda base, ADR-004), jerarquía `DomainException`, `@RestControllerAdvice` a RFC 7807 con `code`, mappers de `Page`.
CA: tests unitarios de Money y del mapeo de errores (400/404/409/422 con códigos de `04`).

**BL-009 · Allocator (mayor resto) [M] · BL-002** · `DONE`
Implementar `Allocator.allocate` según DM §Split. Tests de propiedades (suma exacta, determinismo, ejemplos 100/3, pesos cero, ceros).
CA: ≥ 8 tests; sin dependencias de Spring.

---

## Fase 1 (MVP) — Backend

**BL-101 · Migración V1: household, member, refresh_token [S] · BL-003** · `DONE`
CA: Flyway aplica en Testcontainers; constraints de DM presentes.

**BL-102 · Auth: registro owner, login, refresh, logout [L] · BL-101, BL-008** · `DONE`
UC-01, UC-02. Spring Security stateless, JWT HS256 (secreto por env), refresh con hash y rotación (ADR-008), BCrypt.
Supuestos: el segundo registro → 409 `CONFLICT` (UC-01); refresh token = 32 bytes aleatorios, SHA-256 en BD; reuso de un refresh rotado → 401 (sin revocar la familia); la unicidad de hogar se chequea por `count` (sin lock; aceptable con un hogar local).
CA: tests de integración: registro (409 si ya existe hogar), login ok/inválido (401), refresh rota token (reuso del viejo → 401), rutas protegidas sin token → 401.

**BL-103 · Miembros y hogar [M] · BL-102** · `DONE`
UC-03: `GET/POST/PATCH /members`, `PUT /household`, `GET /me`. Roles (`@PreAuthorize`).
CA: MEMBER no puede crear (403); desactivado no loguea.

**BL-104 · Migración V2 + módulo catálogo [M] · BL-103** · `DONE`
Tablas `category`, `product`; endpoints de categorías y productos con búsqueda `q`, archivado. UC-04.
CA: nombre único case-insensitive (409); no se borra categoría con productos (409); búsqueda paginada.

**BL-105 · Migración V3 + listas de compra (CRUD) [M] · BL-104** · `DONE`
`shopping_list`, `shopping_list_item`; UC-10, UC-11, UC-15 (duplicar/archivar). Suma de cantidades si repite producto+unidad.
CA: tests de cada endpoint de `04` §Listas excepto `suggestions` y `complete`; lista no-OPEN es de solo lectura (422 `LIST_NOT_OPEN`).

**BL-106 · Migración V4 + módulo stock [L] · BL-104** · `DONE`
`stock_item`, `stock_movement`; UC-30–34. Alta manual, consumo FEFO por producto y por lote, descarte, alertas, summary, `expiryStatus` calculado con zona del hogar.
CA: tests unitarios de FEFO (con NULLs al final, consumo que cruza varios lotes, `INSUFFICIENT_STOCK`); tests de estados de vencimiento con reloj inyectable (`Clock`).
Supuestos (BL-106): ver "Cambios de contrato" en `04` (unidades sin conversión, 409 sobre lotes no activos, `purchase_item_id` sin FK hasta V6). `FEFO` y `ExpiryPolicy` son funciones puras (`stock/Fefo.kt`); el consumo toma `SELECT ... FOR UPDATE` de los lotes. `stock` usa `CatalogService` (`requireProduct`, `productNames`) y solo el filtro por categoría toca la entidad `Product` en JPQL.

**BL-107 · Migración V5 + gastos manuales e histórico [M] · BL-104, BL-008** · `DONE`
`expense`; UC-20, UC-21. Filtros, paginación, `totalFiltered`, soft delete, restricción para `source=PURCHASE`. Campos de split/shared se persisten pero la lógica de reparto queda para P2 (devolver `shared=false`).
CA: tests de filtros combinados; índices presentes; moneda distinta a la base → 422 `UNSUPPORTED_CURRENCY`.
Supuestos: sin tabla `expense_split` (Fase 2); `shared`/`split_mode` son columnas y la API siempre devuelve `shared=false`; `PUT/DELETE` de un gasto `PURCHASE` → 409 `CONFLICT`; la moneda base sale del hogar (`CurrencyPolicy` por request); `GET /expenses/summary` queda para BL-110.

**BL-108 · Compras + completar lista (UC-13/14/22) [L] · BL-105, BL-106, BL-107** · `DONE`
Migración V6 (`purchase`, `purchase_item`). `PurchaseService.completeList` transaccional según DM §Completar lista y ADR-007. `POST /purchases`, `GET/PUT /purchases`.
CA: test de integración del flujo completo (lista → compra → gasto + stock + lista COMPLETED); rollback total si falla el alta de stock (test forzando error); reintento → `LIST_NOT_OPEN`; `leftoverAction=NEW_LIST` crea lista con los no tildados; vencimiento por `defaultShelfLifeDays`; editar compra recalcula el gasto.
Supuestos (BL-108): ver "Cambios de contrato" de `04-api-interfaces.md`. Resumen: lock pesimista de la lista (concurrencia → `LIST_NOT_OPEN`); pendientes = ítems sin tildar no comprados (sin pendientes no se crea lista nueva); editar una compra reemplaza ítems y recalcula el gasto pero no toca el stock ya creado (queda desvinculado, `ON DELETE SET NULL`); no hay reparto de gasto (Fase 2), por eso no se usa `Allocator` en esta tarea; `Purchase` no expone el id de la lista nueva.

**BL-109 · Sugerencias de lista [M] · BL-106, BL-108** · `DONE`
UC-12, DM §Sugerencias.
CA: tests con datos: producto sin stock tras compra previa, producto por vencer, exclusión de ya listados.

**BL-110 · Reportes de gasto [M] · BL-107, BL-108** · `DONE`
`GET /expenses/summary` (mes/categoría/comercio), `GET /products/{id}/price-history`. UC-23.
CA: tests de agregación con varios meses y categorías; montos por moneda.
Supuestos (BL-110): ver "Cambios de contrato" de `04-api-interfaces.md`. Resumen: una fila por (grupo, moneda), sin mezclar monedas; gastos borrados excluidos; `store` solo cuenta gastos `PURCHASE`; paquete aislado `ar.hogar.report`, sin migración.

**BL-111 · Seed de datos de desarrollo [S] · BL-108** · `DONE`
Perfil `local` carga categorías comunes (Almacén, Lácteos, Limpieza, Verdura, Carne, Bebidas, Higiene) y ~30 productos con vida útil típica.
CA: arranque con perfil `local` los carga una sola vez (idempotente).

**BL-013 · Localdev: verificación continua del smoke [S] · BL-102, BL-108** · `DONE`
Extender `scripts/smoke.sh` a medida que se agregan endpoints (stock, gastos, sugerencias) y sumar un job opcional de CI que levante Postgres, arranque el backend y ejecute `make smoke`.
CA: el smoke cubre UC-13 completo (lista → compra → gasto + stock) y falla si se rompe el flujo.
Supuestos (BL-013): el smoke asume moneda base `ARS` (override con `SMOKE_BASE_CURRENCY`) y usa un sufijo único por corrida (no requiere base vacía; es idempotente). El job de CI vive en `.github/workflows/smoke.yml`, separado de `ci.yml` y opcional: se dispara con `workflow_dispatch` o con la etiqueta `run-smoke` en un PR, así que nunca es un check requerido de `main`.

**BL-015 · Localdev: tests de frontend estables bajo carga [S] · BL-012** · `DONE`
Varios tests RTL fallan de forma intermitente cuando la máquina está saturada (muchos agentes o builds en paralelo): `frontend/src/catalog/catalog.test.tsx` (el `getByRole` síncrono tras avanzar 5×20 ms con timers falsos, hacia las líneas 111-117, apuesta a que MSW/fetch resuelvan en esos pasos; más un `useFakeTimers` parcial que solo falsea `setTimeout`/`clearTimeout`) y `frontend/src/shopping/shopping.test.tsx`. Los `findBy*` dependen del timeout por defecto de 1 s. Medido: ningún test tiene fuga ni uso alto de memoria (heap de 58–144 MB por archivo, suite completa de ~200 tests en ~4 s), así que la causa es la contención de CPU y no la memoria.
CA: configurar un `asyncUtilTimeout` de Testing Library y un `testTimeout` de Vitest holgados (p. ej. 5 s) en `frontend/src/test/setup.ts`/`vite.config.ts`; reemplazar las esperas síncronas tras avanzar timers por `waitFor`/`findBy*`; usar fake timers completos y coherentes donde se testee el debounce; revisar los warnings de `act()` y los "unhandled request" de MSW en `auth.test.tsx`/`router.test.tsx`. La suite completa pasa 20 corridas seguidas con la máquina cargada (p. ej. corriendo `npm run test -- --run` en paralelo con otro build) sin fallos intermitentes, y `make verify` queda en verde.
Supuestos/resultado: solo se tocaron tests y su configuración (`asyncUtilTimeout` 5 s, `testTimeout` 10 s, `hookTimeout` 15 s, `sequence.hooks: 'list'`; helpers `src/test/fakeTimers.ts` y `src/test/pageHandlers.ts`; compuertas MSW en vez de retardos fijos). Validado el 2026-11-10 sobre `main` con #86/#87 (249 tests, 17 archivos): suite completa 20/20 corridas seguidas con carga de 10 bucles de CPU (uno por CPU, una corrida a la vez), 0 fallos y 0 warnings de `act()`/"unhandled request"; antes, `main` fallaba 3/20 con la misma carga. Los tests nuevos de #86/#87 no necesitaron ajustes.

**BL-016 · Localdev: contenedor Testcontainers sin choques entre worktrees [S] · BL-012** · `TODO`
`make test-backend` fija `TESTCONTAINERS_REUSE_ENABLE=true` (Makefile) y `IntegrationTestBase` reutiliza un único contenedor Postgres. Con varios worktrees/ramas en paralelo, cada uno con migraciones distintas, el contenedor reutilizable compartido falla la validación de Flyway con migraciones que la otra rama no conoce, o falla todo el contexto al cargar: da falsos rojos (o verdes) y obliga a correr `make -o test-backend verify` o `TESTCONTAINERS_REUSE_ENABLE=false`.
CA: el reuse deja de compartirse entre worktrees (p. ej. etiqueta/nombre del contenedor derivado de la ruta del worktree o de un hash de las migraciones, o reuse desactivado por defecto fuera del checkout principal); dos worktrees con migraciones distintas corren `make test-backend` a la vez sin falsos fallos; en CI no se usa reuse; `make test-fast` no cambia; `docs/06-local-dev.md` documenta el comportamiento y cómo limpiar contenedores huérfanos.

---

## Fase 1 (MVP) — Frontend

**BL-151 · Auth UI [M] · BL-006, BL-102** · `DONE`
Pantallas: registro de hogar (si no existe), login. Guardado de tokens, refresh automático, rutas protegidas, logout.
CA: tests RTL del flujo; redirección al expirar sesión.
Nota (BL-006): el refresh automático vive acá, no en el cliente API. Debe usar el gancho `onUnauthorized` de `createApiClient` (se invoca ante un 401 con Authorization, excepto `/auth/login`, `/auth/refresh` y `/auth/register-owner`; no reintenta ni refresca por sí mismo).
Supuestos (BL-151): el contrato no expone si ya existe un hogar, así que `/registro` siempre está accesible desde el login y un `409` se muestra como "Ya existe un hogar". El access token vive en memoria y el refresh token en `localStorage` (`gh.refreshToken`); al arrancar se restaura la sesión canjeándolo. El refresh es single-flight; tras refrescar, la UI reintenta una vez las queries que fallaron con 401. Si el refresh falla (400/401) se limpia la sesión y se redirige a `/login` con aviso de expiración.

**BL-152 · Catálogo UI [S] · BL-151, BL-104** · `DONE`
ABM de categorías y productos; componente `ProductPicker` (autocompletado con creación al vuelo) reutilizable.
CA: búsqueda con debounce; test del picker.
Supuestos (BL-152): la pantalla del catálogo vive en `/catalogo` y se expone en la navegación principal; `ProductPicker` usa debounce de 300 ms por defecto y permite elegir la unidad al crear un producto al vuelo cuando no hay coincidencia exacta por nombre.

**BL-153 · Listas de compra UI [L] · BL-152, BL-105** · `DONE`
Listado de listas, detalle con alta rápida de ítems, tildado, contador, duplicar/archivar. Optimistic updates en tildado.
CA: usable en 375 px; tildar actualiza en < 100 ms percibidos; tests de interacción.
Supuestos: rutas `/listas` y `/listas/:id`; archivar con `window.confirm`; cantidad por defecto 1 (decimal hasta 3 decimales, acepta coma); sin precio estimado/nota en el alta rápida; el tildado revierte solo el ítem afectado ante error.

**BL-154 · Finalizar compra UI [L] · BL-153, BL-108** · `DONE`
Wizard UC-13: revisar ítems tildados (cantidad/precio/vencimiento), comercio/fecha/pagador/total, qué hacer con no tildados. Manejo de errores `LIST_NOT_OPEN`.
CA: total por defecto = suma; validaciones Zod; flujo completo con MSW; `lib/money.ts` con tests (parseo "1.500,50" ↔ minor units).
Supuestos (BL-154): ruta `/listas/:id/finalizar` (botón "Finalizar compra" en el detalle de una lista `OPEN` con al menos un ítem tildado). Wizard de 3 pasos en un solo formulario: ítems tildados (cantidad, precio unitario precargado con el estimado si está en la moneda base, vencimiento opcional) → comercio/fecha/pagador (solo miembros activos)/total → pendientes (`NEW_LIST` por defecto, `DISCARD`). Total por defecto = suma de `round(cantidad × precio)` por línea con BigInt (`lineTotalMinor` en `lib/money.ts`, half-up como el backend); editable, con "Usar la suma" para volver. Validación con Zod (se agrega la dependencia `zod`). `LIST_NOT_OPEN` reemplaza el wizard por un aviso con enlaces a la lista y a gastos; un reintento tras un fallo reenvía el mismo contenido (el backend responde `LIST_NOT_OPEN` si el primero sí se registró). Al éxito se invalidan listas, gastos y stock y se navega al detalle de la lista (ya `COMPLETED`) con un aviso de éxito vía `location.state`. `shared` no se envía (default del hogar).

**BL-155 · Gastos UI [M] · BL-151, BL-107** · `DONE`
Histórico con filtros y total filtrado, alta/edición manual, detalle de compra.
CA: paginación infinita o por páginas; filtros reflejados en la URL.
Supuestos (BL-155): `/gastos` (histórico, paginación por páginas de 20), `/gastos/nuevo` y `/gastos/:id` (edición si `MANUAL`; solo lectura si `PURCHASE`). Filtros (`from`, `to`, `categoryId`, `paidBy`, `source`, `q`) y `page` (1-based) viven en la URL. La moneda del alta es la base del hogar; `lib/money.ts` asume 2 decimales salvo JPY/CLP/PYG/KRW/VND. El pagador se resuelve con `GET /members`.

**BL-156 · Stock UI [M] · BL-151, BL-106** · `DONE`
Listado agrupado por vencimiento con badges de estado, alta manual, consumir (rápido: botones −1/todo), descartar, banner de alertas.
CA: colores accesibles (no solo color); consumo desde la lista en ≤ 2 toques.

**BL-157 · Sugerencias en la lista [S] · BL-153, BL-109** · `DONE`
Panel "Te puede faltar" con botón agregar.
CA: agregar una sugerencia la suma a la lista y la saca del panel.
Supuestos: `Suggestion` agrega `defaultUnit` (cambio de contrato) y al agregar se usa cantidad 1 con esa unidad. El panel solo se monta en listas `OPEN` y muestra 5 sugerencias con "Ver más".

**BL-158 · Dashboard y reportes [M] · BL-155, BL-110** · `DONE`
Gasto mensual, por categoría, evolución de precio de producto (gráficos con Recharts).
CA: estados vacíos; consistente con totales del histórico.
Supuestos (BL-158): ruta `/reportes` (ítem "Reportes" en la navegación) con período `from`/`to` en la URL (fechas inválidas se descartan) y 4 secciones: gasto mensual, por categoría, por comercio y evolución de precio. Un gráfico + tabla equivalente POR MONEDA (nunca se suman monedas); el mensual rellena en el cliente los meses sin gastos con 0. "Sin categoría" y "Sin comercio" se muestran con aviso de que el gasto por comercio solo incluye compras. En el histórico de precios se elige una unidad por vez (sin convertir) y se filtra en el cliente; hay una serie por moneda. Sin cambios de contrato. El selector de producto de reportes es de solo lectura (no crea, permite archivados). Las pantallas se protegen con `ErrorBoundary`/`LazyRoute` (fallo de gráfico o de chunk → mensaje con reintento). Recharts 3.10.1 (`accessibilityLayer` desactivado; el gráfico es `role="img"` con descripción y los datos van en tabla).

**BL-159 · PWA y pulido móvil [L] · BL-153..BL-158** · `TODO`
**Objetivo.** Que la app se pueda instalar en el teléfono y abra su shell sin conexión, y que todas las pantallas del MVP muestren carga, error y vacío de la misma forma, sin scroll horizontal en 360 px.

**Contexto.** Hoy hay `frontend/public/manifest.webmanifest` con un único ícono SVG (`icon.svg`) y ningún service worker. Chrome exige íconos PNG de 192 y 512 px para ofrecer la instalación. Cada pantalla arma su propio `<p>Cargando…</p>` y su propio aviso de error (ver `pages/*.tsx`, `expenses/ExpenseListPage.tsx`, `expenses/ExpenseFormPages.tsx`, `reports/ReportSection.tsx`, `shopping/SuggestionsPanel.tsx`, `auth/RequireAuth.tsx`); `components/LazyRoute.tsx` ya tiene el patrón correcto (`role="status"` al cargar, `role="alert"` + botón "Reintentar" al fallar). La navegación inferior (`components/layout/AppLayout.tsx`) tiene 5 ítems.

**Alcance.**
- Service worker con `vite-plugin-pwa` (Workbox, `generateSW`): precache del shell (HTML, JS, CSS, íconos) y `navigateFallback` a `index.html`. **Nunca cachear `/api`** (son datos de dinero y stock: siempre a la red; excluirlo también del `navigateFallback`). El SW se registra solo en el build de producción (`devOptions` desactivado) para no afectar `npm run dev` ni los tests.
- Actualización: `registerType: 'prompt'` con un aviso "Hay una versión nueva" + botón "Actualizar". No recargar solo: puede haber un formulario a medio llenar.
- Íconos PNG generados desde `icon.svg` y commiteados en `frontend/public/`: 192, 512, 512 `maskable` y `apple-touch-icon` de 180. Actualizar el manifest y `index.html`.
- Componentes compartidos en `frontend/src/components/` para carga, error con reintento y estado vacío; reemplazar los avisos sueltos de las pantallas listadas en Contexto. Mismos roles ARIA que `LazyRoute`.
- Sin conexión: una consulta que falla por red muestra un error con "Reintentar" (no una pantalla en blanco ni "Cargando…" infinito).
- Textos: recorrer las pantallas y corregir cualquier texto visible en inglés o `detail` crudo del backend (deben pasar por el `problems.ts` del feature).
- Revisar a 360 px: listas, detalle de lista, wizard de finalizar compra, gastos (filtros y tabla), stock, reportes (tablas y gráficos), catálogo. Corregir desbordes (tablas con scroll propio, `min-w-0`, textos largos con corte).
- El aviso de éxito al finalizar una compra (detalle de la lista, vía `location.state`) pasa a `role="status"`.

**Fuera de alcance.** Uso offline con datos (cola de mutaciones, cache de respuestas), notificaciones push (BL-305), rediseño visual, cambios de API.

**Supuestos de partida.** Lighthouse eliminó la categoría PWA en la versión 12, por eso la instalabilidad se valida con Chrome DevTools (Application → Manifest). Si el agente no puede abrir un navegador, lo reporta como `NO EJECUTADO` y deja los pasos para validarlo a mano.

**Tests.** RTL de los componentes compartidos (roles, botón de reintento); test del aviso de actualización con el registro del SW mockeado; los tests existentes siguen pasando sin tocar sus aserciones salvo donde cambió un texto.

CA:
- `npm run build` genera `dist/sw.js` y un `manifest.webmanifest` con íconos PNG de 192 y 512 px (uno `maskable`).
- Con `npm run build && npm run preview`: DevTools → Application → Manifest no muestra errores de instalabilidad y Chrome ofrece instalar la app.
- Con el SW activo y sin red, recargar `/listas` muestra el shell y un error con "Reintentar" (no la página de error del navegador).
- Ninguna respuesta de `/api` queda en Cache Storage.
- Al publicar un build nuevo aparece el aviso de versión nueva y "Actualizar" carga la versión nueva.
- Ninguna pantalla del MVP tiene scroll horizontal a 360 px de ancho (lista de pantallas revisadas en el PR).
- Todas las pantallas usan los componentes compartidos de carga, error y vacío.
- `make verify` en verde.

**BL-160 · docker-compose completo y README de arranque [S] · BL-159** · `TODO`
**Objetivo.** Levantar la app completa (Postgres + backend + frontend) con un solo comando de Docker, sin JDK ni Node instalados, y poder hacer un backup de la base. Cierra el hito MVP.

**Contexto.** `docker-compose.yml` solo define `postgres` (con `fsync=off`, pensado para desarrollo). No hay Dockerfiles. `application-local.yml` apunta a `localhost` y activa devtools, Swagger y el seed del catálogo, así que no sirve dentro de un contenedor. El frontend usa `/api/v1` relativo salvo que exista `VITE_API_BASE_URL` (`frontend/src/api/client.ts`); `.env.example` define `VITE_API_URL`, que el código no lee. `scripts/smoke.sh` apunta a `API_BASE` (por defecto `http://localhost:${SERVER_PORT}`).

**Alcance.**
- `backend/Dockerfile` multi-stage (build con Gradle → imagen JRE 21, usuario no root) y `frontend/Dockerfile` (build con Node → nginx).
- nginx: sirve el build, hace fallback de SPA a `index.html`, proxea `/api` a `backend:8080` (mismo origen: no hace falta CORS ni `VITE_API_BASE_URL`), y sirve `sw.js` e `index.html` con `Cache-Control: no-cache` para que el service worker de BL-159 se actualice.
- Perfil Spring nuevo `docker` (`application-docker.yml`): datasource por variables (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`), `JWT_SECRET` y `CORS_ALLOWED_ORIGINS` del entorno, sin devtools, sin Swagger y sin seed de catálogo.
- Servicios `backend` y `frontend` en el compose existente con `profiles: ["full"]`, `depends_on` con `condition: service_healthy` y healthchecks. El backend publica el 8080 (para el smoke) y el frontend un puerto configurable (`FRONTEND_PORT`, por defecto 8088).
- `.dockerignore` en ambos; nada de `.env` ni secretos dentro de las imágenes (todo por variables en runtime).
- `scripts/backup.sh` (`pg_dump` en formato custom a `backups/hogar-<fecha>.dump`, carpeta en `.gitignore`) y la restauración documentada. Targets `make up-full`, `make down-full` y `make backup`.
- Corregir `.env.example` (`VITE_API_URL` → `VITE_API_BASE_URL`, o quitarla si no hace falta).
- README raíz: sección "Levantar todo con Docker". `docs/06-local-dev.md`: actualizar la fila del profile `full` y el troubleshooting.

**Fuera de alcance.** Despliegue cloud, HTTPS y backups automáticos (BL-307); publicar imágenes en un registry; endurecer Postgres para producción (el `fsync=off` actual se documenta como solo local).

**Tests.** No hay tests unitarios nuevos: la validación es levantar el stack y correr el smoke. `make test-hooks` y el escaneo de secretos deben seguir en verde con los archivos nuevos.

CA:
- `docker compose --profile full up -d --build --wait` termina con los tres servicios `healthy`.
- `make seed` y `make smoke` pasan contra ese stack sin fallidos.
- La UI abre en `http://localhost:${FRONTEND_PORT}`, permite iniciar sesión (las llamadas pasan por el proxy de nginx) y recargar una ruta profunda como `/gastos` no da 404.
- `make backup` genera un dump y restaurarlo en una base vacía recupera los datos (pasos y resultado en el PR).
- `make up`, `make backend` y `make dev` siguen funcionando igual que antes.
- `make verify` en verde.

> **Hito MVP**: BL-001 … BL-160 (incluye BL-012 a BL-016) en `DONE`.

> **Definition of Done (toda tarea)**: `make verify` en verde (incluye el escaneo de secretos); si toca endpoints, `make smoke` sin fallidos; docs/contrato actualizados si cambió algo; datos de prueba según `07-sensitive-data.md`.

---

## Fase 2 — Gastos compartidos y contribución

**BL-201 · Migración: expense_split, income, settlement [M] · MVP** · `TODO`
**Objetivo.** Crear las tres tablas de Fase 2 para que BL-202 a BL-205 solo agreguen código.

**Contexto.** La última migración es `V6__purchase.sql`; esta es **V7**. `expense` ya tiene las columnas `shared` y `split_mode` con sus `CHECK` (V5), no hay que tocarla. Convenciones de las migraciones existentes: PK `UUID` sin `DEFAULT` (se genera en la app), `created_at`/`updated_at TIMESTAMPTZ NOT NULL`, montos `BIGINT` + `currency CHAR(3)`, constraints con nombre.

**Alcance.**
- `V7__expense_split_income_settlement.sql` con las tablas de DM §Fase 2:
  - `expense_split`: `expense_id` FK `ON DELETE CASCADE`, `member_id` FK, `share_minor BIGINT` con `CHECK (share_minor >= 0)`, `UNIQUE (expense_id, member_id)`, índice por `member_id`.
  - `income`: `member_id` FK, `amount_minor` con `CHECK (> 0)`, `currency`, `effective_from DATE`, `UNIQUE (member_id, effective_from)`.
  - `settlement`: `household_id` FK, `from_member` y `to_member` FK a `member`, `amount_minor` con `CHECK (> 0)`, `currency`, `settled_on DATE`, `note`, `created_by` FK, `deleted_at`, `CHECK (from_member <> to_member)`, índice `(household_id, settled_on DESC)`.
- `FlywayMigrationV7IntegrationTest` con el mismo estilo que `FlywayMigrationV6IntegrationTest`.
- Actualizar DM (`03-domain-model.md`) si se agregan columnas que no figuran (`created_at`, `updated_at`, `created_by`).

**Fuera de alcance.** Entidades JPA, repositorios, endpoints y cambios en `expense`. No hay backfill: los gastos existentes quedan `shared = false` y sin splits.

**Tests.** En el test de migración: las tres tablas existen; cada `UNIQUE` y cada `CHECK` rechaza el caso inválido (split duplicado, `share_minor` negativo, ingreso 0, ingreso duplicado para la misma fecha, liquidación con `from = to`, liquidación con monto 0); borrar un gasto borra sus splits.

CA:
- Flyway aplica V1..V7 sobre una base vacía en Testcontainers.
- Los constraints de DM están presentes y cada uno tiene un test que lo viola.
- `ddl-auto: validate` sigue pasando (no hay entidades nuevas).
- `make verify` en verde.

**BL-202 · Ingresos y % de contribución [M] · BL-201, BL-009** · `TODO`
**Objetivo.** Cada miembro carga su ingreso mensual y la API devuelve el porcentaje de contribución de cada uno (UC-50, UC-51), sin exponer sueldos ajenos (ADR-009).

**Contexto.** No existe el paquete: crear `ar.hogar.contribution`. `Allocator.allocate(total, weights)` ya está en `common/Allocator.kt` (ADR-005). La tabla `income` la crea BL-201. Los endpoints de API §Contribución no están en `api/openapi.yaml`: agregarlos es parte de esta tarea. BL-203 va a consumir este módulo para calcular los splits.

**Alcance.**
- Contrato primero: paths y esquemas `Income`, `IncomeInput`, `Contribution` en `api/openapi.yaml`, nota en "Cambios de contrato" de `04`, y regenerar `frontend/src/api/schema.d.ts`.
- `GET /members/{id}/incomes` → `Income[]` ordenado por `effectiveFrom` descendente. `POST /members/{id}/incomes` `{amount: Money, effectiveFrom}` → `201`. `DELETE /members/{id}/incomes/{incomeId}` → `204`.
- Permisos: un `MEMBER` solo opera sobre su propio id (otro → `403`); el `OWNER` sobre cualquiera. Miembro inexistente o de otro hogar → `404`.
- Validaciones: `amountMinor > 0` (`400`); moneda distinta a la base → `422 UNSUPPORTED_CURRENCY` (vía `CurrencyPolicy`); misma `effectiveFrom` repetida para el miembro → `409`.
- `GET /contribution?asOf=YYYY-MM-DD&monthlyBudget=<minor>`: `asOf` por defecto es hoy en la zona del hogar. Participan los miembros **activos** con ingreso vigente (mayor `effectiveFrom <= asOf`). `pct` = `allocate(10000, pesos = ingresos) / 100`, como string con 2 decimales (`"62.50"`). Los activos sin ingreso vigente van en `missingIncome` y no participan. Con `monthlyBudget`, `suggestedShare` = `allocate(monthlyBudget, mismos pesos)` en la moneda base. Si nadie tiene ingreso: `members: []` y todos en `missingIncome` (`200`).
- La respuesta de `/contribution` nunca incluye montos de ingreso, tampoco para el `OWNER`.
- Servicio de dominio reutilizable para BL-203: dado hogar y fecha, devuelve los pesos por miembro activo y quiénes no tienen ingreso.

**Fuera de alcance.** Splits (BL-203), override manual (BL-304), ingresos en otra moneda (fase 3), UI (BL-251).

**Supuestos de partida.**
- El parámetro se llama `monthlyBudget` como en `04` (UC-51 dice `monthlyBudgetMinor`; manda el contrato).
- Borrar un ingreso es borrado físico (la tabla no tiene `deleted_at`) y no altera splits ya guardados (ADR-006).
- Un miembro inactivo conserva sus ingresos pero no participa del cálculo.

**Tests.** `*UnitTest` del cálculo (vigencia por fecha, suma exacta 100,00, empate de restos, un solo miembro = 100,00). `ContributionIntegrationTest`: permisos (`403` de un `MEMBER` sobre otro), `409` por fecha repetida, `422` por moneda, `asOf` anterior al primer ingreso, miembro inactivo excluido, `missingIncome`, `suggestedShare` suma exacto el presupuesto.

CA:
- Los `pct` suman exactamente 100,00 siempre que haya al menos un miembro con ingreso.
- Los miembros activos sin ingreso vigente aparecen en `missingIncome`.
- Un `MEMBER` recibe `403` al leer o escribir ingresos de otro; `/contribution` no devuelve ningún sueldo.
- Σ `suggestedShare` = `monthlyBudget` exacto.
- `api/openapi.yaml`, `04` y `schema.d.ts` actualizados.
- `make smoke` sin fallidos, con una sección nueva de ingresos y contribución.
- `make verify` en verde.

**BL-203 · Splits al crear/editar gastos [L] · BL-202** · `TODO`
**Objetivo.** Un gasto compartido guarda cuánto le corresponde a cada miembro (UC-40), con suma exacta y como foto histórica (ADR-006).

**Contexto.**
- `expense/ExpenseService.kt`: `create`, `update`, `createFromPurchase` y `updateFromPurchase` crean siempre gastos no compartidos, y `toDto()` devuelve `shared = false` fijo.
- `expense/ExpenseDtos.kt` y el esquema `ExpenseInput` del yaml no tienen `shared`, `splitMode` ni `customSplits`.
- `purchase/PurchaseService.kt` (`register`) llama a `expenses.createFromPurchase(...)`; `CompleteListRequest.shared` hoy se acepta y se ignora. `household.share_purchases_by_default` existe y vale `TRUE` por defecto.
- ADR-003 no contemplaba que gastos dependa de contribución: esta tarea agrega esa dependencia (`expense` → `contribution`, un solo sentido) y la anota en ADR-003.

**Alcance.**
- Contrato primero: `ExpenseInput` suma `shared?`, `splitMode?`, `customSplits?: [{memberId, share: Money}]`; `Expense` suma `splitMode?` y `splits?: [{memberId, share: Money}]`. Nota en "Cambios de contrato" y regenerar `schema.d.ts`.
- Entidad y repositorio de `expense_split` dentro de `expense`.
- Cálculo con `Allocator` (ADR-005), en una función pura testeable sin Spring:
  - `CONTRIBUTION`: pesos = ingresos vigentes a `expenseDate` de los miembros activos (servicio de BL-202). Si algún activo no tiene ingreso → `422 CONTRIBUTION_INCOMPLETE`.
  - `EQUAL`: peso 1 por cada miembro activo.
  - `CUSTOM`: `customSplits` con miembros del hogar sin repetir, `share >= 0`, misma moneda que el gasto y Σ = monto; si la suma no coincide → `422 SPLIT_SUM_MISMATCH`.
- Se persiste una fila por miembro participante, también las de monto 0 (DM §Split de gasto compartido).
- Gasto manual: `shared` por defecto `false`. `shared = true` sin `splitMode` usa `CONTRIBUTION`. `shared = false` con `splitMode` o `customSplits` → `400`. `customSplits` con un modo distinto de `CUSTOM` → `400`.
- `PUT /expenses/{id}`: borra y regenera los splits con los datos del request, usando ingresos vigentes a la `expenseDate` del gasto.
- Compras (`POST /shopping-lists/{id}/complete` y `POST /purchases`): `shared` = el del request o, si falta, `household.sharePurchasesByDefault`; modo `CONTRIBUTION`. Todo dentro de la misma transacción (ADR-007): si falla el reparto no se persiste nada. `PUT /purchases/{id}` regenera los splits del gasto conservando su modo.
- `GET /expenses` y `GET /expenses/{id}` devuelven `shared`, `splitMode` y `splits` reales; el filtro `shared` existente pasa a ser útil.

**Fuera de alcance.** Balances (BL-204), liquidaciones (BL-205), UI (BL-252), override de porcentajes (BL-304). Sin backfill: los gastos anteriores quedan `shared = false`.

**Supuestos de partida.**
- **Modo implícito con ingresos incompletos**: si el modo no vino explícito (compra compartida por defecto, o gasto manual `shared = true` sin `splitMode`) y falta el ingreso de algún miembro activo, se reparte en partes iguales y se guarda `split_mode = EQUAL`. Así finalizar una compra no empieza a fallar al activar la Fase 2. Con `splitMode = CONTRIBUTION` explícito sí responde `422 CONTRIBUTION_INCOMPLETE`.
- Al editar un gasto viejo se reparte entre los miembros activos hoy, con ingresos vigentes a la fecha del gasto.
- En `CUSTOM` puede figurar cualquier miembro del hogar, activo o no, al editar; al crear, solo activos (`400`).

**Tests.** `*UnitTest` del cálculo por modo con propiedad Σ = monto (montos y pesos aleatorios), 100 entre 3 → 34/33/33, miembro con parte 0. Integración: crear y editar en cada modo; `SPLIT_SUM_MISMATCH`; `CONTRIBUTION_INCOMPLETE` con modo explícito; fallback a `EQUAL` con modo implícito; cambiar un ingreso después no altera los splits guardados; completar lista con y sin `shared`; rollback total de la compra si el reparto falla; editar la compra regenera los splits; los tests existentes de `PurchaseIntegrationTest` y `ExpenseIntegrationTest` siguen en verde.

CA:
- Para todo gasto compartido, Σ `splits.share` = `amount` exacto.
- `CUSTOM` con suma incorrecta → `422 SPLIT_SUM_MISMATCH`.
- Cambiar o borrar un ingreso no modifica splits de gastos ya creados.
- Una compra hereda `shared` de `sharePurchasesByDefault` y se puede forzar con `shared` en el request.
- El flujo central (UC-13) sigue pasando en `make smoke` sin cargar ingresos; el smoke suma una sección de gasto compartido.
- ADR-003, `api/openapi.yaml`, `04` y `schema.d.ts` actualizados.
- `make verify` en verde.

**BL-204 · Balances y simplificación de deudas [L] · BL-203** · `TODO`
**Objetivo.** `GET /balances` devuelve, por moneda, cuánto pagó y cuánto le correspondía a cada miembro, su saldo neto y la lista mínima de "quién le paga a quién" (UC-41, UC-43).

**Contexto.** Fórmulas en DM §Balance entre miembros y §Simplificación de deudas. La tabla `settlement` existe desde BL-201 pero su API llega en BL-205: acá solo se lee. `report` es el antecedente de un módulo de solo lectura con SQL nativo (`report/ReportRepository.kt`). El esquema `Money` del yaml admite `amountMinor` negativo, que hace falta para `net`.

**Alcance.**
- Paquete nuevo `ar.hogar.balance`, de solo lectura, con su repositorio de consultas agregadas.
- Contrato primero: `GET /balances?from&to` → `Balance` (API §Balances) en `api/openapi.yaml`, nota en "Cambios de contrato" y regenerar `schema.d.ts`.
- Cuentan los gastos `shared = true` no borrados y las liquidaciones no borradas. `from`/`to` son inclusivos y filtran `expense_date` y `settled_on`; `from > to` → `400`.
- Por moneda: `paid`, `owed` y `net = paid − owed + settled_out − settled_in` (DM). `net > 0`: le deben; `net < 0`: debe.
- `members` incluye a todos los activos (aunque estén en 0) y a los inactivos con algún movimiento en el período.
- `transfers`: algoritmo greedy de DM como función pura; desempate por `memberId` para que el resultado sea determinista; nunca transferencias de monto 0.
- Sin movimientos: `byCurrency: []`.

**Fuera de alcance.** CRUD de liquidaciones (BL-205), UI (BL-253), conversión entre monedas (fase 3).

**Tests.** `*UnitTest` de la simplificación: propiedad Σ net = 0 con entradas aleatorias, como máximo n−1 transferencias, aplicar las transferencias deja a todos en 0, ejemplo de 3 miembros con el resultado escrito a mano, determinismo. Integración: gastos compartidos y no compartidos mezclados, gasto borrado excluido, liquidación insertada por SQL que reduce la deuda, filtro por fechas, dos monedas separadas (filas insertadas por SQL), `400` por rango inválido.

CA:
- Σ `net` = 0 por moneda en todos los tests.
- El ejemplo de 3 miembros devuelve las transferencias mínimas esperadas.
- Con `from`/`to` solo cuentan gastos y liquidaciones del período.
- Los gastos no compartidos y los borrados no afectan el balance.
- `api/openapi.yaml`, `04` y `schema.d.ts` actualizados; `make smoke` con una sección de balance.
- `make verify` en verde.

**BL-205 · Liquidaciones [S] · BL-204** · `TODO`
**Objetivo.** Registrar que un miembro le pagó a otro para saldar deuda (UC-42) y que eso se refleje en `GET /balances`.

**Contexto.** Tabla `settlement` creada en BL-201. BL-204 ya la lee para calcular `net`. El borrado lógico sigue el patrón de `expense` (`deleted_at`, ADR-010).

**Alcance.**
- Contrato primero: `GET /settlements?page&size`, `POST /settlements` y `DELETE /settlements/{id}` (API §Balances) en `api/openapi.yaml`, nota en "Cambios de contrato" y regenerar `schema.d.ts`.
- Código en el paquete `ar.hogar.balance` (entidad, repositorio, servicio, controller).
- `POST` `{fromMember, toMember, amount: Money, settledOn, note?}` → `201 Settlement`. Validaciones: `fromMember ≠ toMember` (`400`); ambos son miembros del hogar (si no, `400`); `amountMinor > 0` (`400`); moneda base (`422 UNSUPPORTED_CURRENCY`); `settledOn` entre 1900-01-01 y 2100-12-31 como en compras; `note` máx. 255.
- `GET` paginado, orden `settledOn` descendente, sin las borradas.
- `DELETE` → `204`, borrado lógico; un segundo `DELETE` o un id de otro hogar → `404`.
- Cualquier miembro puede registrar y borrar liquidaciones.

**Fuera de alcance.** Edición (`PUT`), UI (BL-253).

**Supuestos de partida.** UC-42 dice "editable", pero el contrato no tiene `PUT`: para corregir una liquidación se borra y se carga de nuevo. Se permite una liquidación mayor a la deuda (el saldo simplemente se invierte).

**Tests.** `SettlementIntegrationTest`: alta, listado, borrado, cada validación, y el efecto sobre `GET /balances` (liquidación parcial reduce la transferencia; liquidación total deja todo en 0; borrarla restaura la deuda).

CA:
- Liquidar el total adeudado deja `net = 0` para ambos y `transfers` vacío.
- Borrar una liquidación la saca del listado y del balance.
- `from = to`, monto ≤ 0 o miembro ajeno al hogar → `400`.
- `api/openapi.yaml`, `04` y `schema.d.ts` actualizados; `make smoke` extiende la sección de balance con una liquidación.
- `make verify` en verde.

**BL-251 · UI ingresos y contribución [M] · BL-202** · `TODO`
**Objetivo.** Pantalla "Contribución": cada miembro carga su ingreso, todos ven el porcentaje de cada uno y pueden calcular la cuota para un gasto mensual (UC-50, UC-51).

**Contexto.** Endpoints y tipos llegan con BL-202 (`schema.d.ts` ya regenerado). La navegación inferior tiene 5 ítems y no entra uno más a 360 px. Patrones a copiar: hooks en `api/hooks/useExpenses.ts`, formulario en `expenses/ExpenseForm.tsx`, mensajes de error en `expenses/problems.ts`. El miembro actual y su rol salen de `useMe`.

**Alcance.**
- Ruta `/contribucion`, carpeta `frontend/src/contribution/`, hooks en `api/hooks/useContribution.ts`.
- Navegación: en móvil, reemplazar "Catálogo" de la barra inferior por "Más" (ruta `/mas`, una página con enlaces a Catálogo y Contribución); en escritorio el lateral lista todo. BL-253 va a sumar "Cuentas" a esa página.
- Sección "Porcentajes": tabla con nombre y `%` por miembro a partir de `GET /contribution`; aviso con los nombres de `missingIncome`.
- Sección "Calculadora": campo de gasto mensual (formato `"1.500,50"` con `lib/money.ts`) que consulta con `monthlyBudget` y muestra la cuota sugerida por miembro.
- Sección "Mi ingreso": historial propio (monto y vigente desde), alta y baja con confirmación. El `OWNER` tiene un selector de miembro para ver y cargar ingresos de cualquiera.
- Un `MEMBER` nunca dispara `GET /members/{otro}/incomes`.
- Errores en español: `409` (ya hay un ingreso con esa fecha), `422 UNSUPPORTED_CURRENCY`, `403`.

**Fuera de alcance.** Override manual de porcentajes (BL-304), gráficos, cambios de API.

**Tests.** `contribution.test.tsx` con MSW: carga y muestra porcentajes; aviso de `missingIncome`; alta de ingreso refresca los porcentajes; calculadora envía unidades menores; como `MEMBER` no hay selector ni requests a ingresos ajenos (el handler de MSW falla si se llama); como `OWNER` el selector cambia el historial; error `409`.

CA:
- Un `MEMBER` no ve sueldos ajenos ni la UI los pide.
- El `OWNER` ve y carga ingresos de cualquier miembro.
- Los porcentajes y la cuota coinciden con lo que devuelve la API (sin recalcular en el cliente).
- Usable a 360 px, textos en español, con estados de carga, error y vacío.
- `make verify` en verde.

**BL-252 · UI gastos compartidos [M] · BL-203, BL-155** · `TODO`
**Objetivo.** Marcar un gasto como compartido, elegir cómo se reparte y ver el reparto resultante, tanto en gastos manuales como al finalizar una compra (UC-40).

**Contexto.** `expenses/ExpenseForm.tsx` (alta y edición de gastos manuales), `expenses/ExpenseFormPages.tsx` (solo lectura si el gasto es `PURCHASE`), `expenses/filters.ts` (filtros en la URL), `shopping/complete/CompleteListWizard.tsx` y `schema.ts` (hoy no envían `shared`). `useMe` expone `household.sharePurchasesByDefault`. Los tipos nuevos (`splitMode`, `splits`, `customSplits`) llegan con BL-203.

**Alcance.**
- Formulario de gasto: toggle "Compartido"; al activarlo, selector de reparto ("Según contribución", "Partes iguales", "Montos a mano").
- Editor de "Montos a mano": una fila por miembro activo con su monto, y un indicador en vivo "Faltan $X" / "Sobran $X" / "Suma correcta" calculado en unidades menores. No se puede guardar si la suma no coincide.
- Detalle de gasto (manual o de compra): si es compartido, tabla con la parte de cada miembro y el modo usado.
- Wizard de finalizar compra: checkbox "Compra compartida" en el paso de comercio/fecha/pagador, tildado según `sharePurchasesByDefault`; se envía `shared`.
- Histórico: filtro "Compartidos" (parámetro `shared` en la URL) y una marca visible en las filas compartidas.
- Errores: `422 CONTRIBUTION_INCOMPLETE` muestra "Faltan ingresos por cargar" con enlace a `/contribucion`; `422 SPLIT_SUM_MISMATCH` marca el editor.

**Fuera de alcance.** Balances y liquidaciones (BL-253), elegir modo de reparto en el wizard de compra (siempre el del backend).

**Tests.** Ampliar `expenses.test.tsx` y `shopping/complete/complete.test.tsx` con MSW: alta en cada modo y el body enviado; validación en vivo de la suma (centavos incluidos, sin float); edición de un gasto compartido precarga modo y montos; detalle muestra los splits; el wizard envía `shared` según el checkbox; manejo de los dos `422`.

CA:
- La suma de "Montos a mano" se valida en vivo y bloquea el guardado si no coincide.
- El body del alta y la edición respeta el contrato de BL-203 (sin `splitMode` ni `customSplits` cuando no es compartido).
- El detalle de un gasto compartido muestra la parte de cada miembro tal como la devuelve la API.
- El checkbox del wizard arranca según la configuración del hogar.
- Usable a 360 px, textos en español.
- `make verify` en verde.

**BL-253 · UI balances y liquidaciones [M] · BL-204, BL-205** · `TODO`
**Objetivo.** Pantalla "Cuentas": saldo de cada miembro, quién le debe a quién, y registrar un pago para saldar (UC-41, UC-42, UC-43).

**Contexto.** Endpoints `GET /balances`, `GET/POST/DELETE /settlements` (BL-204, BL-205). La página `/mas` y la carpeta de hooks existen desde BL-251 (si BL-251 no está mergeada, agregar el ítem de navegación donde corresponda y avisar en el PR). Los filtros en la URL siguen el patrón de `reports/filters.ts`.

**Alcance.**
- Ruta `/cuentas`, carpeta `frontend/src/balances/`, hooks en `api/hooks/useBalances.ts`; enlace "Cuentas" en `/mas` y en el lateral.
- Filtro por mes en la URL (`?mes=YYYY-MM` → `from`/`to` del mes) con opción "Todo el historial" (sin fechas), que es el valor por defecto.
- Una sección por moneda: tabla de miembros (pagó, le correspondía, saldo) con el saldo indicado por texto además del color ("le deben" / "debe"), y la lista de transferencias sugeridas "A le paga $X a B".
- Cada transferencia tiene "Registrar pago", que abre el formulario precargado (de, a, monto, fecha de hoy en la zona del hogar); también se puede cargar un pago libre.
- Lista de pagos registrados con borrado (confirmación) y paginación.
- Estado "Todo saldado" cuando no hay transferencias; estado vacío cuando no hay gastos compartidos.
- Tras registrar o borrar un pago se invalidan balances y liquidaciones.

**Fuera de alcance.** Editar liquidaciones (no hay `PUT`), exportar, cambios de API.

**Tests.** `balances.test.tsx` con MSW: render por moneda; "Todo saldado"; registrar pago desde una transferencia envía el body correcto y refresca; borrar pago; el filtro de mes se refleja en la URL y en la query; errores `400`/`422` en español.

CA:
- Los montos mostrados son los de la API (el cliente no recalcula saldos ni transferencias).
- Registrar el pago sugerido deja la pantalla en "Todo saldado" (con la API mockeada en consecuencia).
- El filtro de mes queda en la URL y sobrevive a una recarga.
- El saldo no depende solo del color; usable a 360 px; textos en español.
- `make verify` en verde.

---

## Fase 3 — Extras (nice-to-have)

**BL-301 · Multimoneda: diseño [M] · BL-205** · `TODO`
**Objetivo.** Decidir y documentar cómo conviven ARS y USD (UC-60) antes de escribir código. Entregable: solo documentos.

**Contexto.** Hoy todo monto guarda `currency` (ADR-004) pero `CurrencyPolicy` rechaza cualquier moneda que no sea la base del hogar. Balances y reportes ya separan por moneda. Quedan abiertos los riesgos R1 (tipo de cambio manual vs API externa) y R2 (ingresos en distintas monedas) de `02`. DM §Fase 3 solo esboza `fx_rate` y las columnas nuevas de `expense`.

**Alcance.**
- ADR nuevo en `02-architecture-decisions.md` que resuelva: origen del tipo de cambio (manual por fecha, API externa, o manual con API opcional); qué cotización se usa (oficial, MEP, blue) y quién la carga; si el gasto guarda el tipo de cambio usado; cómo se convierten los ingresos para la contribución; si balances y reportes muestran por moneda, convertido a la base, o ambos; redondeo de las conversiones (siempre a unidades menores, sin float).
- `03-domain-model.md`: definición final de `fx_rate` y de las columnas nuevas, con constraints.
- `04-api-interfaces.md`: endpoints de tipos de cambio y los cambios en `Expense`, `Income`, `Balance` y reportes, con sus errores.
- Plan de migración de los datos existentes y lista de puntos del código a tocar (`CurrencyPolicy`, `expense`, `purchase`, `contribution`, `balance`, `report`, y `lib/money.ts` en el front).
- Reescribir BL-302 y BL-303 en este backlog con el alcance que salga del diseño.

**Fuera de alcance.** Código de aplicación, migraciones y cambios en `api/openapi.yaml`.

**Supuestos de partida.** Las decisiones de producto no las toma el agente: para cada punto abierto presenta 2 opciones con una recomendación y espera la elección del usuario antes de marcar el ADR como aceptado.

CA:
- ADR aceptado en `02`, con alternativas descartadas y consecuencias; R1 y R2 pasan a "Resuelto".
- `03` y `04` describen `fx_rate`, los campos nuevos y los endpoints sin contradicciones entre sí.
- BL-302 y BL-303 quedan reescritas con alcance y CA concretos.
- No hay cambios de código; `make verify` en verde.

**BL-302 · Multimoneda: implementación backend [L] · BL-301** · `TODO`
**Objetivo.** Poder registrar gastos en una moneda distinta a la base, con su tipo de cambio, según el ADR de BL-301 (UC-60).

**Contexto.** El alcance exacto lo fija BL-301 (que reescribe esta tarea). Puntos de entrada conocidos: `common/CurrencyPolicy.kt` (hoy solo moneda base), los `validated(...)` de `expense` y `purchase`, y los módulos `contribution`, `balance` y `report`.

**Alcance.**
- Migración con `fx_rate` y las columnas nuevas, sin romper los datos existentes.
- Endpoints de tipos de cambio definidos en `04` (contrato primero, regenerar `schema.d.ts`).
- Relajar `CurrencyPolicy` a las monedas habilitadas; el resto sigue en `422 UNSUPPORTED_CURRENCY`.
- Si el ADR elige una API externa: detrás de una interfaz `FxRateProvider` con un fake en memoria para tests y un mock por Docker bajo el profile `mocks` (ver `06-local-dev.md` §Dependencias externas).
- Conversión con `BigDecimal` y redondeo a unidades menores; nunca float.

**Fuera de alcance.** UI (BL-303).

**Tests.** `*UnitTest` de conversión y redondeo; integración: gasto en USD con tipo de cambio manual, balances separados por moneda, contribución con ingresos en dos monedas, migración sobre datos existentes.

CA:
- Se puede crear un gasto en USD con tipo de cambio manual.
- Los balances siguen separados por moneda y nunca suman monedas distintas sin conversión explícita.
- Las migraciones aplican sobre una base con datos de Fase 1 y 2 sin perder nada.
- Tests de conversión y de `CurrencyPolicy`; `make smoke` sin fallidos; `make verify` en verde.

**BL-303 · Multimoneda: UI [M] · BL-302** · `TODO`
**Objetivo.** Cargar y ver gastos en otra moneda desde la app (UC-60).

**Contexto.** `lib/money.ts` ya formatea por moneda y conoce las monedas sin decimales. Los formularios de gasto y de compra fijan hoy la moneda base del hogar. Reportes y la pantalla de Cuentas ya muestran una sección por moneda.

**Alcance.**
- Selector de moneda en el alta y edición de gastos y en finalizar compra, limitado a las monedas habilitadas.
- Carga del tipo de cambio según el diseño de BL-301 (campo en el gasto o pantalla de tipos de cambio).
- Histórico de gastos: cada fila con su moneda y `totalFiltered` mostrado por moneda.
- Revisar que ninguna pantalla sume montos de monedas distintas.

**Fuera de alcance.** Cambios de API.

**Tests.** MSW: alta de un gasto en USD (body con `currency` y tipo de cambio), listados con dos monedas, validaciones del tipo de cambio.

CA:
- Un gasto en USD se carga y se muestra con su moneda.
- Los totales no mezclan monedas en ninguna pantalla.
- Tests de formularios con MSW; usable a 360 px; `make verify` en verde.

**BL-304 · Override manual de contribución [S] · BL-202** · `TODO`
**Objetivo.** El `OWNER` fija porcentajes manuales que reemplazan el cálculo por ingresos (UC-52).

**Contexto.** Módulo `contribution` de BL-202. DM §Fase 3 define `contribution_override` (`member_id`, `pct NUMERIC(5,2)`, `effective_from`). BL-203 toma los pesos de un servicio de `contribution`: el override tiene que entrar por ese mismo servicio para que también lo usen los splits nuevos.

**Alcance.**
- Migración con `contribution_override` (siguiente número libre).
- Contrato primero: `PUT /contribution/override` `{effectiveFrom, members: [{memberId, pct}]}` y `DELETE /contribution/override?effectiveFrom=` (solo `OWNER`); `Contribution` suma `source: "INCOME" | "OVERRIDE"`.
- Un override vale desde su `effectiveFrom` hasta el siguiente; rige el de mayor `effectiveFrom <= asOf`.
- Validaciones: los `pct` suman exactamente 100,00 (si no, `422`), cada uno entre 0 y 100, todos los miembros activos presentes, sin repetidos.
- Con override vigente, `GET /contribution` y los splits `CONTRIBUTION` nuevos usan esos porcentajes y no exigen ingresos cargados.

**Fuera de alcance.** UI (proponer una tarea nueva al terminar); recalcular gastos ya creados.

**Tests.** Suma distinta de 100 → `422`; `MEMBER` → `403`; vigencia por fecha; split de un gasto nuevo con override; un gasto anterior no cambia (ADR-006); borrar el override vuelve al cálculo por ingresos.

CA:
- Los porcentajes manuales deben sumar 100 (`422` si no).
- `GET /contribution` los usa cuando hay un override vigente e indica `source`.
- Solo el `OWNER` puede definirlos o borrarlos.
- Los gastos ya creados no cambian (ADR-006).
- `api/openapi.yaml`, `04`, DM y `schema.d.ts` actualizados; `make verify` en verde.

**BL-305 · Notificaciones web push de vencimiento [M] · BL-159, BL-106** · `TODO`
**Objetivo.** Avisar por web push a los miembros suscriptos cuando hay productos por vencer o vencidos (UC-34, fase P3).

**Contexto.** `GET /stock/alerts` ya calcula vencidos y por vencer con la zona del hogar (`stock/Fefo.kt`, `ExpiryPolicy`). El service worker llega con BL-159 (`generateSW`: para recibir push hay que pasar a `injectManifest` o sumar un script con `importScripts`). No hay jobs programados en el backend todavía.

**Alcance.**
- Backend: tabla de suscripciones (endpoint, claves, miembro) y tabla o marca de "ya notificado"; `POST /push/subscriptions` y `DELETE /push/subscriptions`; `GET /push/public-key`; job diario con `@Scheduled` a una hora configurable en la zona del hogar.
- Envío detrás de una interfaz `PushSender` con implementación real (VAPID) y un fake para tests; las suscripciones que el servicio de push informa como vencidas (404/410) se borran.
- Una notificación por miembro con el resumen ("3 productos por vencer, 1 vencido"); no se repite un lote ya notificado en el mismo estado.
- Frontend: botón "Activar avisos de vencimiento" en Stock (pide permiso, suscribe, guarda); manejo de `push` y `notificationclick` en el SW (abre `/stock`).
- Claves VAPID solo por variables de entorno (`.env.example` con valores vacíos y cómo generarlas en `06`).

**Fuera de alcance.** Email, notificaciones de otros eventos, preferencias por tipo de aviso.

**Tests.** Job con `Clock` fijo y `PushSender` falso: una notificación por miembro, no reenvía, borra suscripciones vencidas; integración de los endpoints de suscripción; RTL del botón con la API de push mockeada.

CA:
- El job diario envía una notificación por miembro suscripto con el resumen de vencimientos.
- No se reenvía lo ya notificado.
- Claves VAPID solo por variables de entorno; el escaneo de secretos pasa.
- Tests con un servicio de push falso; `make verify` en verde.

**BL-306 · Tiempo real en listas (SSE) [M] · BL-105, BL-153** · `TODO`
**Objetivo.** Dos personas con la misma lista abierta ven los cambios del otro sin refrescar (riesgo R3 de `02`).

**Contexto.** Toda mutación de una lista pasa por `shopping/ShoppingService.kt` (y `purchase/PurchaseService.kt` al completarla), bajo un lock de fila. El front usa TanStack Query con updates optimistas en el tildado (`api/hooks/useShoppingLists.ts`). `EventSource` no permite mandar el header `Authorization`.

**Alcance.**
- Contrato primero: `GET /shopping-lists/{id}/events` (`text/event-stream`).
- Backend: registro en memoria de suscriptores por lista (`SseEmitter`); se emite un evento **después del commit** de cada mutación (ítem agregado, editado, tildado, borrado, lista renombrada, archivada o completada); heartbeat periódico; limpieza al desconectar.
- El evento solo lleva tipo e id de lista; el cliente invalida la query del detalle (no se replica estado por el stream).
- Autenticación con el mismo JWT, leyendo el stream con `fetch` (header `Authorization`) en vez de `EventSource`; lista de otro hogar → `404`.
- Frontend: suscripción mientras el detalle está montado, reconexión con backoff, y refresco del token si el stream responde `401`.

**Fuera de alcance.** Tiempo real en otras pantallas, WebSocket, presencia ("quién está mirando"), escalar a más de una instancia del backend.

**Supuestos de partida.** Una sola instancia del backend (despliegue local): el registro en memoria alcanza.

**Tests.** Integración con dos suscriptores a la misma lista: el cambio de uno llega al otro; no llegan eventos de otra lista ni de una transacción con rollback; `401` sin token. Front: un evento simulado invalida la query; reconexión tras un corte.

CA:
- Dos clientes ven los cambios del otro sin refrescar.
- La conexión se autentica con el mismo JWT y no expone listas de otro hogar.
- El frontend reconecta solo tras un corte.
- Test de integración con dos suscriptores; `make verify` en verde.

**BL-307 · Despliegue cloud + backups automáticos [M] · BL-160** · `TODO`
**Objetivo.** La app accesible por HTTPS fuera de casa, con backup diario de la base (riesgo R5 de `02`).

**Contexto.** BL-160 deja las imágenes Docker, el perfil Spring `docker` y `scripts/backup.sh`. El Postgres del compose local corre con `fsync=off`: no sirve para producción. El proveedor no está elegido.

**Alcance.**
- Primer paso: presentar al usuario 2 opciones de proveedor (por ejemplo un VPS con Docker Compose y Caddy, o una plataforma gestionada con Postgres gestionado) con costo mensual estimado y una recomendación; seguir con la elegida. Registrar la decisión como ADR y cerrar R5.
- Configuración de despliegue versionada (compose de producción o archivo del proveedor), HTTPS, `CORS_ALLOWED_ORIGINS` con el dominio real, Postgres con durabilidad normal.
- Secretos (`JWT_SECRET`, credenciales de la base) solo en el gestor del proveedor.
- Backup diario automático con retención definida y una restauración de prueba documentada.
- Runbook `docs/08-deploy.md`: desplegar, hacer rollback, restaurar un backup, rotar `JWT_SECRET`.

**Fuera de alcance.** Multi-hogar, CI/CD completo (alcanza con un despliegue manual documentado), monitoreo avanzado.

**Supuestos de partida.** Las acciones que crean recursos pagos o exponen la app a internet las confirma el usuario antes de ejecutarse.

CA:
- La app funciona en una URL pública con HTTPS y `make smoke` pasa contra ella (`API_BASE`), usando un usuario de prueba.
- Los secretos viven solo en el gestor del proveedor; el escaneo de secretos pasa.
- Backup diario verificado con una restauración de prueba.
- Runbook en `docs/`; `make verify` en verde.

**BL-308 · Presupuestos por categoría y alertas [M] · BL-107, BL-158** · `TODO`
**Objetivo.** Definir un presupuesto mensual por categoría de gasto y ver cuánto se lleva consumido, con aviso al pasar el 80 % y el 100 %.

**Contexto.** `GET /expenses/summary?groupBy=category` ya agrega por categoría y moneda (`report/`). Los gastos de compras no tienen categoría propia y caen todos en "Sin categoría" (ver BL-110 en "Cambios de contrato"), así que hoy un presupuesto por categoría solo mediría gastos manuales.

**Alcance.**
- Migración con `budget` (`household_id`, `category_id`, `amount_minor`, `currency`, `UNIQUE (household_id, category_id)`): un monto mensual por categoría, que vale para todos los meses.
- Contrato primero: `GET /budgets`, `PUT /budgets/{categoryId}` `{amount: Money}`, `DELETE /budgets/{categoryId}`, y `GET /budgets/status?month=YYYY-MM` → `[{category, budget, spent, pct, level: "OK" | "WARNING" | "EXCEEDED"}]` (`WARNING` desde 80 %, `EXCEEDED` desde 100 %).
- `spent` = gastos no borrados de esa categoría en el mes, en la moneda base. `pct` como string con 2 decimales, calculado sin float.
- Frontend: sección "Presupuestos" en `/reportes` con una barra por categoría, el estado en texto además del color, y edición del monto.

**Fuera de alcance.** Presupuestos distintos por mes, notificaciones push, presupuesto global del hogar.

**Supuestos de partida.** El gasto de una compra se reparte entre las categorías de sus productos en proporción al total de cada línea, usando `Allocator` (ADR-005); la diferencia entre el total de la compra y la suma de líneas sigue la misma proporción. Esto aplica solo al cálculo de `spent`: los reportes existentes no cambian.

**Tests.** `*UnitTest` del nivel (79,99 % / 80 % / 100 %) y del reparto de una compra por categoría (suma exacta); integración: CRUD, gastos en distintos meses, gasto borrado excluido, compra con productos de dos categorías; MSW de la sección.

CA:
- CRUD de presupuestos por categoría.
- `GET /budgets/status` devuelve consumo vs presupuesto por mes, con gastos de otros meses excluidos.
- La UI marca las categorías en `WARNING` y `EXCEEDED` sin depender solo del color.
- `api/openapi.yaml`, `04`, DM y `schema.d.ts` actualizados; `make verify` en verde.

---

## Orden sugerido de ejecución del MVP

```
BL-001 → BL-002 → BL-003/005 (paralelo) → BL-012 → BL-004 → BL-006/007/008/009
→ BL-101 → BL-102 → BL-103 → BL-104
→ BL-105 ∥ BL-106 ∥ BL-107 → BL-108 → BL-109/110/111
Frontend en paralelo, siguiendo deps: 151 → 152 → 153 → 154 …
```
