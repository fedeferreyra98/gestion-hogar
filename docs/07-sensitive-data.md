# 07 — Datos sensibles y secretos

Regla de oro: **en el repo solo hay datos mock y referencias a variables de entorno. Nunca credenciales, API keys ni datos personales reales** (de los integrantes del hogar o de terceros). Esto incluye sueldos reales, CUIT/CUIL, CBU, DNI, tarjetas, teléfonos y emails reales.

## Defensa en capas

| Capa | Dónde | Cubre | Se puede saltear con `--no-verify` |
|---|---|---|---|
| 1. pre-commit | `.githooks/pre-commit` | Líneas agregadas en el índice | Sí |
| 2. pre-push | `.githooks/pre-push` | Todo lo que se sube (commits hechos con `--no-verify` incluidos) | Sí |
| 3. CI | Job `secrets` del pipeline (BL-014) | Todo el repo en cada PR; bloquea el merge | **No** |

Instalación: `make hooks` (también lo hace `make setup`). Escaneo manual: `make check-secrets`. Tests del escáner: `make test-hooks`. Ambos corren dentro de `make verify`.

Implementación: `scripts/check_secrets.py` (solo biblioteca estándar de Python). No imprime nunca el valor completo detectado.

## Qué detecta

| Categoría | Reglas |
|---|---|
| Credenciales | Claves privadas (PEM), AWS, GitHub, Slack, Google, Stripe, claves tipo `sk-...` de proveedores LLM, JWT, `Bearer` literal, credenciales en URLs, asignaciones `password/secret/token/api_key = "<valor>"`, cadenas de alta entropía |
| Datos personales | CUIT/CUIL y CBU **con dígito verificador válido**, tarjetas (Luhn válido), DNI, teléfonos argentinos, emails fuera de dominios mock |
| Archivos | `.env` reales (solo `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.jks`, `id_rsa`, `credentials.json`, `.npmrc`, `.pgpass`, dumps SQL / `*.sqlite` / `*.db` / `*.tfstate` |

## Convenciones para datos mock (lo que el escáner acepta)

| Tipo | Cómo escribirlo | Ejemplo |
|---|---|---|
| Password / secret / token / API key | El valor lleva un token mock separado por `-`, `_` o `.`: `dev`, `mock`, `fake`, `example`, `dummy`, `test`, `sample`, `placeholder`, `changeme`, `redacted` | `dev-owner-password-123`, `mock-api-key-abc` |
| Referencias a configuración | Variables de entorno, nunca literales | `${JWT_SECRET}`, `System.getenv("X")` |
| Emails | Dominios reservados: `@example.com/.org/.net`, `@hogar.local`, `*.test`, `*.invalid` | `owner@hogar.local`, `ana@example.com` |
| CUIT / CUIL / CBU / tarjetas | Valores con dígito verificador inválido, todos los dígitos iguales, secuenciales, o tarjetas de prueba conocidas (ej. `4111 1111 1111 1111`) | `20-00000000-0`, `0000000000000000000000` |
| DNI | Dígitos repetidos o secuenciales | `11111111`, `12345678` |
| Sueldos / montos | Cualquier número inventado. **No usar los sueldos reales** de los integrantes en tests, seeds ni docs | `monthlyIncome = 500000` |
| Nombres de personas | Nombres ficticios genéricos (Ana, Luis); no los de los integrantes reales | |
| URLs de conexión | Hosts locales (`localhost`, `postgres`, `db`) pueden llevar credenciales de dev | `postgresql://hogar:hogar@localhost:5432/hogar` |

Reglas para tests y seeds (agentes): los datos de prueba se generan o se declaran con las convenciones de arriba; no se copian datos de entornos reales; un test que necesita un secreto usa un valor con token `mock`/`test`.

## Falsos positivos

1. Primero intentá cambiar el dato para que siga la convención mock (casi siempre alcanza).
2. Si es un falso positivo real, agregá un comentario `allow-secret: <motivo>` en esa misma línea.
3. Para casos recurrentes: `path:<glob>` o `regex:<re>` en `.secrets-allow`. Cambios en ese archivo se revisan en el PR, nunca se agregan reglas sin motivo.

Ejemplo: `val sample = "30.123.457"  // allow-secret: fixture del test del escáner`

## Si se filtró algo de verdad

1. **Rotar/revocar la credencial inmediatamente** (borrar el commit no alcanza: puede estar en caché, forks o clones).
2. Si fue un dato personal, borrarlo del historial (`git filter-repo`) y avisar a la persona afectada.
3. Agregar una regla o test al escáner si el patrón no estaba cubierto.

## Configuración obligatoria en GitHub (BL-014)

El job `secrets` (`.github/workflows/ci.yml`) ejecuta `python3 -I scripts/check_secrets.py --all` y `make test-hooks` en cada PR y push a `main`. Para que el control sea imposible de omitir al mergear y a nivel de push remoto, un administrador del repositorio debe aplicar la siguiente configuración en GitHub:

### 1. Activar Secret Scanning y Push Protection del repositorio

1. En GitHub, abrir el repositorio y navegar a **Settings** → **Code security** (en la barra lateral izquierda, sección *Security*).
2. En el bloque **Secret scanning**, hacer clic en **Enable** para activar la detección nativa de secretos conocidos de proveedores.
3. Debajo de *Secret scanning*, en **Push protection**, hacer clic en **Enable** para bloquear en el `git push` cualquier commit que contenga secretos de alta confianza detectados por GitHub.

### 2. Marcar el job `secrets` como check requerido en la protección de `main`

1. Ir a **Settings** → **Branches** (o **Rules** → **Rulesets**).
2. En **Branch protection rules**, hacer clic en **Add branch protection rule** (o editar la regla existente para `main`):
   - **Branch name pattern**: `main`
   - Marcar **Require a pull request before merging**.
   - Marcar **Require status checks to pass before merging**.
   - Marcar **Require branches to be up to date before merging** (recomendado).
   - En el buscador de status checks, buscar y seleccionar **`secrets`** (y opcionalmente `Backend` y `Frontend`).
   - Marcar **Do not allow bypassing the above settings** para que la regla aplique también a administradores.
3. Hacer clic en **Create** / **Save changes**.

> **Nota**: Para que el check `secrets` aparezca en el buscador de GitHub, el workflow `.github/workflows/ci.yml` con el job `secrets` debe haberse ejecutado al menos una vez (por ejemplo, en el PR de `BL-014`).

## Límites conocidos

- Es heurístico: puede dar falsos positivos y no detecta secretos con formato desconocido y baja entropía (ej. una contraseña corta y común).
- No escanea el historial previo a la instalación de los hooks; `make check-secrets` revisa el árbol actual.
- Los hooks locales dependen de que cada clon ejecute `make hooks`; por eso el CI (BL-014) es el control que no se puede omitir. Complementar con *push protection* de GitHub (Settings → Code security → Secret scanning) y protección de rama en `main`.
