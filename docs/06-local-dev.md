# 06 — Entorno de desarrollo local (localdev)

Objetivo: que cualquier agente (o persona) pueda **levantar el sistema y validar sus cambios en minutos**, con comandos únicos y sin decisiones.

## Requisitos

JDK 21, Node 20+, Docker (con Compose v2), `make`, `curl`, `python3` (lo usa `smoke.sh` para parsear JSON).

## Arranque rápido

```bash
make setup     # crea .env e instala dependencias
make up        # Postgres en localhost:5432 (espera al healthcheck)
make backend   # API en http://localhost:8080  (otra terminal)
make frontend  # UI en http://localhost:5173   (otra terminal)
make seed      # crea el owner dev: owner@hogar.local / dev-owner-password-123
# o todo junto: make dev
```

`make help` lista todos los comandos. `make reset-db` deja la base limpia; `make psql` abre una consola SQL.

## Escalera de verificación (usar de arriba hacia abajo)

| Nivel | Comando | Requiere | Tiempo objetivo | Cuándo usarlo |
|---|---|---|---|---|
| 1. Unit | `make test-fast` | Nada (sin Docker) | < 15 s | Durante cada cambio: dominio puro (`Allocator`, FEFO, balances, `Money`) y componentes front |
| 2. Integración | `make test-backend` | Docker (Testcontainers) | < 2 min | Al terminar una tarea: repositorios, migraciones, flujos transaccionales |
| 3. Smoke E2E | `make up && make backend` + `make smoke` | Sistema corriendo | < 30 s | Tareas que cambian endpoints o el flujo central (UC-13) |
| 4. Verify | `make verify` | Docker | < 5 min | **Antes de abrir el PR** (lint + tests + build) |

Reglas para agentes:
- Una tarea no está `DONE` hasta que `make verify` pase.
- Si la tarea toca endpoints, además `make smoke` debe terminar sin fallidos y, si agrega un endpoint del flujo central, extender `scripts/smoke.sh` (secciones se saltean solas con 404, así que no se rompen entre tareas).
- Nombrado para que el nivel 1 funcione: los tests unitarios terminan en `UnitTest` o viven en paquetes `*.domain.*`; los que usan Spring/Testcontainers terminan en `IntegrationTest`.

## Qué incluye (y dónde vive)

| Pieza | Archivo | Estado |
|---|---|---|
| Postgres 16 con healthcheck y tuning de velocidad (sin fsync, solo dev) | `docker-compose.yml` | Hecho |
| Variables de entorno de ejemplo | `.env.example` | Hecho |
| Comandos unificados | `Makefile` | Hecho |
| Smoke test E2E incremental | `scripts/smoke.sh` | Hecho (se activa por secciones) |
| Seed del owner dev | `scripts/seed.sh` | Hecho |
| Perfil Spring `local` (`application-local.yml`) y `test` | `backend/` | Hecho |
| Datos demo de catálogo (idempotente, paquete `devseed`) | `backend/` | Hecho (BL-111) |
| Tests de integración con Testcontainers reutilizables (`IntegrationTestBase`) | `backend/` | Hecho (BL-012) |
| Proxy de Vite al backend / CORS local | `frontend/` | BL-005 |
| Servicios `backend`+`frontend` en compose (profile `full`) | `docker-compose.yml` | BL-160 |

## Especificación para el backend (perfil `local`)

`backend/src/main/resources/application-local.yml` debe:
- Conectar a `jdbc:postgresql://localhost:${DB_PORT:5432}/${DB_NAME:hogar}` con `DB_USER`/`DB_PASSWORD`.
- Ejecutar Flyway al arrancar (`spring.flyway.enabled=true`); `spring.jpa.hibernate.ddl-auto=validate` (nunca `update`).
- Leer `JWT_SECRET` y `CORS_ALLOWED_ORIGINS` del entorno.
- Exponer `/actuator/health` (público) y Swagger UI en `/swagger-ui.html` (solo perfil `local`).
- Activar `spring-boot-devtools` (reinicio rápido) como `developmentOnly`.
- Loguear SQL solo si `LOG_SQL=true`.

Tests de integración:
- Un único contenedor Postgres compartido por toda la suite (singleton container) y `testcontainers.reuse.enable=true` en `~/.testcontainers.properties` para reutilizarlo entre corridas.
- Cada test que escribe datos limpia sus tablas (`@Sql` o `TRUNCATE ... CASCADE` en `@BeforeEach`) en vez de recrear el contexto.
- `Clock` inyectable para tests de vencimientos (ya requerido en BL-106).

## Seed del catálogo (perfil `local`)

Con el perfil `local` el backend carga datos mock de catálogo: 7 categorías (Almacén, Lácteos, Limpieza, Verdura, Carne, Bebidas, Higiene) y ~30 productos con unidad por defecto y vida útil típica (`defaultShelfLifeDays`). Código en `backend/src/main/kotlin/ar/hogar/devseed/`.

- **Cuándo se carga:** el hogar existe recién tras `register-owner` (p. ej. `make seed`). Se carga (a) apenas se confirma ese registro (evento `HouseholdRegisteredEvent`, tras el commit) y (b) en cada arranque de `local` si el hogar ya existe (`ApplicationRunner`).
- **Idempotente:** salta categorías/productos cuyo nombre ya exista (case-insensitive, igual que el 409 de la API) y nunca modifica datos existentes. Arrancar N veces los carga una sola vez; si borrás un producto del seed, reaparece en el próximo arranque.
- **Solo `local`:** los beans llevan `@Profile("local")`; no existen en `test` ni en prod. Un fallo del seed tras el registro se loguea y no afecta al registro.

## Harness de validación para agentes

Flujo único que sigue todo agente por tarea:

1. `make up` (si no está arriba) → implementar con `make test-fast` en loop.
2. Al terminar: `make verify`. Si la tarea toca endpoints: `make backend` en segundo plano + `make smoke`.
3. Pegar el reporte de validación en la descripción del PR, con este formato:

```
## Validación
- Tarea: BL-xxx
- make test-fast: OK (N tests)
- make verify: OK | FALLÓ (detalle)
- make smoke: OK (a ok, b salteados) | N/A (no toca endpoints)
- Smoke extendido: sí/no (qué sección)
- Supuestos / desvíos del contrato: ...
```

Reglas del harness:
- Un agente nunca marca `DONE` con algo en rojo ni salteado sin decirlo: si un paso no pudo correrse (ej. sin Docker), se reporta como `NO EJECUTADO` con el motivo.
- Los tests no se desactivan ni se debilitan para pasar; si un test es incorrecto, se corrige y se explica en el PR.
- El reporte debe contener resultados reales de la corrida, no una descripción de lo que "debería" pasar.

## Dependencias externas y mocks (hoy: ninguna)

El sistema depende solo de Postgres, que se levanta real (compose para dev, Testcontainers para tests), así que no se necesitan mocks de terceros ni la herramienta corporativa de mocks.

Si aparecen dependencias externas, el punto de extensión es el mismo `docker-compose.yml`, con un servicio mock por dependencia bajo el profile `mocks`, y un target `make up-mocks`:

| Dependencia futura | Tarea | Mock sugerido |
|---|---|---|
| API de tipo de cambio (dólar oficial/MEP/blue) | BL-301/302 | WireMock con stubs versionados en `mocks/fx/` |
| Servicio de web push | BL-305 | Endpoint stub local |
| SMTP (si se agregan emails/recuperación de clave) | — | Mailpit |

Regla: el código accede a cada dependencia detrás de una interfaz de dominio (ej. `FxRateProvider`), con una implementación real y una fake en memoria para tests unitarios; el mock por Docker se reserva para integración y smoke.

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| `make up` falla con "port is already allocated" | Otro Postgres usa 5432 | Cambiar `DB_PORT` en `.env` |
| Backend: "password authentication failed" | Volumen viejo con otras credenciales | `make reset-db` |
| `smoke.sh` aborta en `[health]` | Backend no está corriendo | `make backend` en otra terminal |
| Flyway: checksum mismatch | Se editó una migración ya aplicada | Nunca editar migraciones; en dev local `make reset-db` |
| Tests de integración muy lentos | Sin reuse de Testcontainers | Ver sección de tests de integración |
