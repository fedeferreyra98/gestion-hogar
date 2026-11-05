# Gestión del Hogar

App de gestión del hogar: listas de compra, histórico de gastos, stock con vencimientos, gastos compartidos y contribución proporcional al sueldo.

## Estructura

| Carpeta | Contenido |
|---|---|
| `backend/` | Kotlin + Spring Boot + PostgreSQL (monolito modular, ADR-003) |
| `frontend/` | React + TypeScript (Vite) |
| `api/` | Contrato OpenAPI (`openapi.yaml`, fuente de verdad) |
| `docs/` | Documentación de producto, arquitectura y backlog |
| `scripts/` | Smoke test, seed, escáner de secretos, generador de issues |

## Requisitos

JDK 21, Node 20+, Docker (Compose v2), `make`, `curl`, `python3`.

## Cómo levantar el proyecto

```bash
make setup     # instala hooks, crea .env e instala dependencias
make up        # Postgres en localhost:5432
make backend   # API en http://localhost:8080 (otra terminal)
make frontend  # UI en http://localhost:5173 (otra terminal)
make seed      # crea el owner de desarrollo
```

`make help` lista todos los comandos. Detalle y escalera de verificación en [`docs/06-local-dev.md`](docs/06-local-dev.md).

## Validación

```bash
make test-fast   # unit tests, sin Docker
make verify      # antes de abrir un PR (secretos + lint + tests + build)
make smoke       # E2E con el backend corriendo
```

## Contribuir

Leé [`CLAUDE.md`](CLAUDE.md) y [`docs/README.md`](docs/README.md). Una tarea de [`docs/05-backlog.md`](docs/05-backlog.md) por rama/PR (`feature/BL-xxx-slug`). Secretos y datos reales nunca en el repo ([`docs/07-sensitive-data.md`](docs/07-sensitive-data.md)).
