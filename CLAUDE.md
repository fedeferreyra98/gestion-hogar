# Gestión del Hogar

App de gestión del hogar (listas de compra, gastos, stock con vencimientos, gastos compartidos, contribución proporcional al sueldo).

**Antes de tocar código, leé `docs/README.md`** y trabajá UNA tarea de `docs/05-backlog.md` por vez.

- Backend: Kotlin + Spring Boot + PostgreSQL (`backend/`). Frontend: React + TypeScript (`frontend/`). Contrato: `api/openapi.yaml`.
- Validación local (ver `docs/06-local-dev.md`): `make setup` → `make up` → `make test-fast` (unit, sin Docker) → `make verify` antes de un PR → `make smoke` con el backend corriendo (`make backend`). `make help` lista todo. Una tarea no está DONE sin `make verify` en verde.
- **Secretos y datos reales: nunca en el repo** (ni en tests, seeds, docs o ejemplos). Usá variables de entorno y datos mock según `docs/07-sensitive-data.md`. `make hooks` instala el pre-commit/pre-push que lo valida (`make setup` lo hace); no uses `--no-verify`.
- Dinero siempre como entero en unidades menores + moneda; nunca float (ADR-004).
- Repartos siempre con `Allocator` (ADR-005).
- Cambios de API: primero `api/openapi.yaml` y `docs/04-api-interfaces.md`.
- Idioma: UI en español, código/API en inglés.
- Commits convencionales; una rama y PR por tarea (`feature/BL-xxx-slug`).
