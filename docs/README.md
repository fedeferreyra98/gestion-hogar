# Gestión del Hogar — Documentación

App para gestionar un hogar: listas de compra, histórico de gastos, stock con vencimientos, gastos compartidos y contribución proporcional al sueldo.

## Índice (leer en este orden)

| Archivo | Contenido |
|---|---|
| [01-use-cases.md](01-use-cases.md) | Casos de uso, reglas de negocio y criterios de aceptación |
| [02-architecture-decisions.md](02-architecture-decisions.md) | Stack, estructura del repo, convenciones y ADRs |
| [03-domain-model.md](03-domain-model.md) | Modelo de datos (tablas, constraints) y algoritmos (split, balances) |
| [04-api-interfaces.md](04-api-interfaces.md) | Contrato REST (endpoints, DTOs, errores) |
| [05-backlog.md](05-backlog.md) | Tareas ordenadas con dependencias y criterios de aceptación |
| [06-local-dev.md](06-local-dev.md) | Entorno local: comandos `make`, escalera de verificación, smoke test |

## Decisiones de producto ya tomadas

- **Un solo hogar** por instalación (sin multi-tenancy real; el esquema deja `household_id` para migrar a cloud/multi-hogar después).
- **Una sola moneda en el MVP**, pero el modelo ya guarda `currency` en cada monto. Multimoneda (ARS/USD) es nice-to-have de fase 3.
- **Contribución proporcional al sueldo**: `% = sueldo_i / suma_sueldos`.
- **Despliegue local** (docker-compose). Migrar a cloud más adelante.
- **Fases**: MVP = listas de compra + gastos/histórico + stock. Fase 2 = gastos compartidos + contribución + liquidaciones. Fase 3 = multimoneda y extras.

## Cómo trabajar con esta documentación (para agentes)

1. Tomá UNA tarea de `05-backlog.md` cuyo estado sea `TODO` y cuyas dependencias estén `DONE`.
2. Leé solo los documentos que la tarea referencia.
3. No cambies contratos (`03`, `04`) sin dejarlo asentado: si el contrato es inconsistente o incompleto, documentá la corrección en el mismo PR y marcala en la sección "Cambios de contrato" de `04-api-interfaces.md`.
4. Validá con la escalera de `06-local-dev.md` (`make test-fast` mientras iterás; `make verify` antes del PR; `make smoke` si tocaste endpoints). Al terminar, marcá la tarea como `DONE` en el backlog.
5. Si algo es ambiguo, elegí la opción más simple, anotala en "Supuestos" de la tarea y seguí.
