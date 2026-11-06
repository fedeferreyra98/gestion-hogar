import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch'
import { ProblemError, toProblemError } from './errors.ts'
import { resolveAccessToken, type TokenGetter } from './token.ts'
import type { paths } from './types.ts'

export interface ApiClientOptions extends Omit<ClientOptions, 'baseUrl'> {
  baseUrl?: string
  getToken?: TokenGetter
  /**
   * Gancho invocado ante un 401 de una request que llevaba Authorization (excepto
   * /auth/login, /auth/refresh y /auth/register-owner, donde un 401 es esperado).
   * NO reintenta ni refresca: el error igual se propaga como ProblemError UNAUTHORIZED.
   * El refresh automático es alcance de BL-151.
   */
  onUnauthorized?: (response: Response) => void | Promise<void>
}

const UNAUTHORIZED_EXCLUDED_PATHS = ['/auth/login', '/auth/refresh', '/auth/register-owner']

function isExcludedFromUnauthorizedHook(url: string): boolean {
  const { pathname } = new URL(url, 'http://localhost')
  return UNAUTHORIZED_EXCLUDED_PATHS.some((p) => pathname.endsWith(p))
}

/**
 * Middleware que invoca `onUnauthorized` ante un 401 de una request autenticada.
 * No modifica ni reintenta la respuesta.
 */
export function createUnauthorizedMiddleware(
  onUnauthorized: (response: Response) => void | Promise<void>,
): Middleware {
  return {
    async onResponse({ request, response }) {
      if (
        response.status === 401 &&
        request.headers.has('Authorization') &&
        !isExcludedFromUnauthorizedHook(request.url)
      ) {
        await onUnauthorized(response.clone())
      }
    },
  }
}

/**
 * Normaliza la baseUrl:
 * - Si es relativa y existe window.location.origin (navegador o jsdom),
 *   la convierte en absoluta para compatibilidad con el constructor Request.
 * - Respeta variables de entorno (VITE_API_BASE_URL) o el valor por defecto '/api/v1'.
 */
export function normalizeBaseUrl(baseUrl?: string): string {
  const envBase = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) as
    string | undefined
  const raw = baseUrl || envBase || '/api/v1'

  if (raw.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${raw}`
  }

  return raw
}

/**
 * Middleware que inyecta el token Bearer en el header Authorization si está presente.
 */
export function createAuthMiddleware(
  getToken: TokenGetter = resolveAccessToken, // allow-secret: callback de resolución, no secreto
): Middleware {
  return {
    async onRequest({ request }) {
      const token = await getToken()
      if (token && !request.headers.has('Authorization')) {
        request.headers.set('Authorization', `Bearer ${token}`)
      }
    },
  }
}

/**
 * Crea una instancia configurada del cliente OpenAPI typed.
 * Base URL por defecto: /api/v1 (relativo/origin-aware, compatible con proxy de Vite y producción).
 */
export function createApiClient(options: ApiClientOptions = {}): Client<paths> {
  const {
    baseUrl,
    getToken = resolveAccessToken, // allow-secret: callback de resolución, no secreto
    fetch: customFetch,
    onUnauthorized,
    ...restOptions
  } = options

  const client = createClient<paths>({
    baseUrl: normalizeBaseUrl(baseUrl),
    // Usar función dinámica para evaluar globalThis.fetch en cada llamada.
    // Esto asegura que mocks como MSW (server.listen()) sean respetados aunque
    // el cliente se instancie a nivel de módulo antes del hook beforeAll de tests.
    fetch: customFetch ?? ((input: Request) => globalThis.fetch(input)),
    ...restOptions,
  })

  client.use(createAuthMiddleware(getToken))
  if (onUnauthorized) client.use(createUnauthorizedMiddleware(onUnauthorized))

  return client
}

type ApiResult<T> = { data?: T; error?: unknown; response: Response }

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

async function settle<T>(promise: Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  let result: ApiResult<T>
  try {
    result = await promise
  } catch (e) {
    // Decisión: si el caller aborta (AbortController / cancelación de TanStack Query),
    // se re-lanza el AbortError original para que los consumidores puedan distinguir
    // una cancelación de un fallo real. Todo lo demás (fetch rechazado con TypeError,
    // token provider que lanza, etc.) se normaliza a ProblemError (status 0, NETWORK_ERROR).
    if (isAbortError(e)) throw e
    throw toProblemError(e)
  }
  if (result.error !== undefined || !result.response.ok) {
    throw toProblemError(result.error, result.response)
  }
  return result
}

/**
 * Desenvuelve la respuesta de openapi-fetch cuando se espera un cuerpo:
 * - Exitosa con cuerpo: retorna `data`.
 * - Falla HTTP o de red: lanza siempre un `ProblemError` (excepto AbortError, ver `settle`).
 * - Exitosa pero sin cuerpo (204/vacío): lanza `ProblemError` EMPTY_RESPONSE; para
 *   endpoints sin contenido usar `unwrapVoid`.
 */
export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  const { data, response } = await settle(promise)
  if (data === undefined) {
    throw new ProblemError(
      {
        type: 'about:blank',
        title: 'Empty response',
        status: response.status,
        code: 'EMPTY_RESPONSE',
        detail: 'Expected a response body but received none',
      },
      response,
    )
  }
  return data
}

/**
 * Variante para endpoints sin contenido (204): resuelve `void` si fue exitosa,
 * lanza `ProblemError` en cualquier fallo.
 */
export async function unwrapVoid(promise: Promise<ApiResult<unknown>>): Promise<void> {
  await settle(promise)
}

/**
 * Instancia singleton por defecto del cliente API.
 */
export const apiClient: Client<paths> = createApiClient()
