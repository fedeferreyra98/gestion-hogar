import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch'
import { toProblemError } from './errors.ts'
import { resolveAccessToken, type TokenGetter } from './token.ts'
import type { paths } from './types.ts'

export interface ApiClientOptions extends Omit<ClientOptions, 'baseUrl'> {
  baseUrl?: string
  getToken?: TokenGetter
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

  return client
}

/**
 * Desenvuelve la respuesta de openapi-fetch:
 * - Si es exitosa (response.ok), retorna `data`.
 * - Si falló (error presente o !response.ok), lanza un `ProblemError` tipado.
 * Ideal para integrar con TanStack Query y funciones asíncronas estándar.
 */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise
  if (error !== undefined || !response.ok) {
    throw toProblemError(error, response)
  }
  return data as T
}

/**
 * Instancia singleton por defecto del cliente API.
 */
export const apiClient: Client<paths> = createApiClient()
