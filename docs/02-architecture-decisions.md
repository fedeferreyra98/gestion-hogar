# 02 — Decisiones de arquitectura

## Stack

| Capa | Elección |
|---|---|
| Backend | Kotlin 2.x, JDK 21, Spring Boot 3.x, Gradle (Kotlin DSL) |
| Persistencia | PostgreSQL 16, Spring Data JPA (Hibernate), Flyway |
| Auth | Spring Security + JWT (access + refresh), BCrypt |
| Tests backend | JUnit 5, MockK, Testcontainers (Postgres), Spring MockMvc |
| Frontend | React 18 + TypeScript (strict), Vite, React Router |
| Estado servidor | TanStack Query |
| Formularios | React Hook Form + Zod |
| UI | Tailwind CSS + shadcn/ui |
| Tests frontend | Vitest, React Testing Library, MSW |
| Contrato API | OpenAPI 3.1 (`api/openapi.yaml`) → cliente TS generado (`openapi-typescript`) |
| Infra local | docker-compose (postgres + backend + frontend) |
| CI | GitHub Actions (build + test backend y frontend) |

## Estructura del repo (monorepo)

```
/
├─ api/openapi.yaml            # fuente de verdad del contrato
├─ backend/
│  ├─ build.gradle.kts
│  └─ src/main/kotlin/ar/hogar/
│     ├─ HogarApplication.kt
│     ├─ common/               # Money, errores, paginación, config
│     ├─ auth/                 # login, JWT, miembros
│     ├─ catalog/              # productos, categorías
│     ├─ shopping/             # listas de compra, compras
│     ├─ expenses/             # gastos, splits, balances, liquidaciones
│     ├─ stock/                # stock, alertas
│     └─ contribution/         # ingresos, % contribución
│     └─ (cada módulo: api/ (controllers+DTOs), domain/ (entidades+servicios), infra/ (repositorios))
│  └─ src/main/resources/db/migration/   # V1__..., V2__...
├─ frontend/
│  └─ src/
│     ├─ api/                  # cliente generado + hooks TanStack
│     ├─ features/{shopping,expenses,stock,contribution,auth}/
│     ├─ components/           # UI compartida
│     └─ lib/                  # money.ts, dates.ts
├─ docs/
├─ docker-compose.yml
└─ CLAUDE.md                   # instrucciones para agentes
```

## ADRs

### ADR-001 — Backend en Kotlin + Spring Boot
- **Contexto**: dominio con lógica de negocio (splits, balances), no con requisitos extremos de throughput.
- **Decisión**: Kotlin/Spring Boot. Tipado rico (sealed/data classes), `BigDecimal` maduro, ecosistema completo (security, validation, scheduling, migraciones).
- **Alternativa descartada**: Go (más liviano, pero más código propio para lo que Spring da hecho). Reevaluar solo si el hosting cloud exige footprint mínimo.
- **Consecuencia**: arranque y RAM mayores; aceptable en local y en un VPS chico.

### ADR-002 — PostgreSQL (SQL) en lugar de documental
- **Contexto**: datos fuertemente relacionales; balances y reportes requieren agregaciones; dinero requiere ACID.
- **Decisión**: PostgreSQL. `JSONB` solo si hace falta algo sin esquema (ej. metadata de tickets).
- **Consecuencia**: migraciones versionadas con Flyway; esquema explícito.

### ADR-003 — Monolito modular
- **Decisión**: una sola app Spring con módulos por paquete (`auth`, `catalog`, `shopping`, `expenses`, `stock`, `contribution`). Sin microservicios.
- **Reglas de dependencia**: `shopping` puede usar `expenses`, `stock` y `catalog` (orquesta UC-13). `expenses`, `stock`, `contribution` solo dependen de `catalog`/`auth`/`common`. Prohibidos ciclos. Los módulos se hablan por servicios de dominio (interfaces), no accediendo a repositorios ajenos.

### ADR-004 — Dinero como entero en unidades menores + moneda
- **Decisión**: todo monto se persiste como `BIGINT amount_minor` + `CHAR(3) currency`. En Kotlin: `data class Money(val amountMinor: Long, val currency: Currency)`. En API: `{ "amountMinor": 150050, "currency": "ARS" }`. En front: helper `formatMoney` con `Intl.NumberFormat`.
- **Por qué**: evita errores de punto flotante y deja la puerta abierta a multimoneda sin migrar datos.
- **MVP**: moneda única del hogar (`household.base_currency`); la API rechaza otra moneda hasta la fase 3 (validación en un solo lugar: `CurrencyPolicy`).
- Cantidades de productos (kg, litros): `NUMERIC(12,3)`, nunca float.

### ADR-005 — Reparto con método de mayor resto
- **Decisión**: todo reparto proporcional (splits, % de contribución) usa el algoritmo de §Split en `03-domain-model.md`, implementado en una única función pura `Allocator.allocate(total, weights)` con tests de propiedades (suma exacta).
- **Por qué**: evitar que se pierdan o sobren centavos.

### ADR-006 — Splits como foto histórica
- **Decisión**: al crear un gasto compartido se persisten las partes (`expense_split`). Cambios futuros de sueldos o miembros no alteran gastos pasados.
- **Consecuencia**: editar un gasto recalcula sus splits con la contribución *vigente a la fecha del gasto* (usa ingresos con `effective_from <= expense_date`).

### ADR-007 — Compra como operación transaccional única
- **Decisión**: UC-13 se implementa en un único `@Transactional` en `PurchaseService.completeList(...)`. Sin eventos asíncronos en MVP (más simple, consistente).
- **Evolución**: si más adelante se necesita desacople, migrar a eventos de dominio (outbox).

### ADR-008 — Auth con JWT stateless
- **Decisión**: access token JWT (1 h, HS256 con secreto por env) + refresh token opaco persistido (hash en BD, rotación). Sin OAuth/social en MVP.
- **Autorización**: roles `OWNER` y `MEMBER`. Todas las consultas filtran por `household_id` del token aunque haya un solo hogar (prepara multi-hogar).

### ADR-009 — Privacidad de ingresos
- **Decisión**: los ingresos individuales son datos sensibles. Cada miembro ve/edita solo el suyo; el `OWNER` ve todos. Los endpoints de contribución devuelven solo porcentajes (no sueldos) a miembros no owner.
- **Alternativa**: transparencia total entre miembros (configurable más adelante).

### ADR-010 — Soft delete y archivado
- **Decisión**: gastos, liquidaciones y productos usan `deleted_at` / `archived` en vez de borrado físico. Los listados excluyen eliminados por defecto. Esto preserva el histórico y balances auditables.

### ADR-011 — Contrato API-first
- **Decisión**: `api/openapi.yaml` es la fuente de verdad. Backend implementa y se valida contra él en tests (springdoc compara o contract test); frontend genera tipos desde él. Cambios de API = primero el yaml.

### ADR-012 — Fechas y zonas horarias
- **Decisión**: fechas de negocio (`expense_date`, `expiry_date`) son `DATE` sin zona. Timestamps técnicos son `TIMESTAMPTZ` en UTC. Zona de negocio por defecto `America/Argentina/Buenos_Aires` (config del hogar) para calcular "hoy" en alertas de vencimiento.

### ADR-013 — Prevención de filtración de secretos y datos reales en capas
- **Contexto**: el sistema maneja sueldos y datos financieros del hogar; trabajan agentes automáticos que pueden copiar datos o credenciales a código, tests o docs.
- **Decisión**: escáner propio sin dependencias (`scripts/check_secrets.py`) ejecutado en pre-commit, pre-push y CI (este último obligatorio). Reglas para credenciales, datos personales argentinos (CUIT/CBU/DNI con validación de dígito verificador) y archivos peligrosos; convenciones de datos mock en `07-sensitive-data.md`.
- **Alternativas**: gitleaks/trufflehog (más cobertura de proveedores, pero dependencia externa y sin reglas de PII local). Pueden sumarse en CI sin reemplazar este escáner.
- **Consecuencia**: los datos de prueba deben seguir convenciones mock; falsos positivos se resuelven con `allow-secret` o `.secrets-allow`.

## Convenciones de código

**Backend**
- Paquetes por módulo (arriba). Controllers delgados; lógica en servicios de dominio.
- Entidades JPA separadas de DTOs de API; mapeo explícito (sin exponer entidades).
- Validación con Bean Validation en DTOs; reglas de negocio en servicios lanzando excepciones de dominio (`DomainException` → mapeadas a RFC 7807).
- Migraciones Flyway inmutables una vez mergeadas; nombre `V{n}__{descripcion}.sql`.
- Tests: unitarios para dominio (Allocator, balances, FEFO); integración con Testcontainers para repositorios y flujos (UC-13).
- Formato: ktlint. Análisis estático: detekt (opcional).

**Frontend**
- TypeScript `strict: true`, sin `any`. Una carpeta por feature.
- Datos del servidor solo vía TanStack Query; estado local con `useState`/form state.
- Formularios con RHF + Zod; los esquemas Zod espejan los DTOs del OpenAPI.
- Mobile-first; componentes accesibles (shadcn/Radix).
- Lint: ESLint + Prettier.

**Git**
- Ramas `feature/<TASK-ID>-slug`. Commits convencionales (`feat:`, `fix:`, `docs:`...). PR pequeño por tarea del backlog.

## Riesgos y decisiones abiertas

| # | Tema | Estado |
|---|---|---|
| R1 | Multimoneda: tipo de cambio manual vs API externa (dólar blue/oficial/MEP) | Abierto, fase 3 |
| R2 | Ingresos en distintas monedas para la contribución | Abierto, fase 3 |
| R3 | Tiempo real en listas (SSE/WebSocket) cuando dos personas editan | Fuera del MVP |
| R4 | Escaneo de tickets/OCR | Fuera del alcance |
| R5 | Despliegue cloud (Fly.io/Render/VPS) y backups | Después del MVP |
