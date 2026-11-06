export type TokenGetter = () => string | null | Promise<string | null>

let inMemoryToken: string | null = null
let customProvider: TokenGetter | null = null

/**
 * Obtiene el token guardado en memoria (el seteado con `setAccessToken`).
 * OJO: NO refleja el token que se envía si hay un proveedor configurado con valor;
 * para eso usar `resolveAccessToken`, que es lo que usa el cliente HTTP.
 */
export function getAccessToken(): string | null {
  return inMemoryToken
}

/**
 * Establece el token de acceso (JWT).
 */
export function setAccessToken(token: string | null): void {
  inMemoryToken = token
}

/**
 * Limpia el token de acceso actual.
 */
export function clearAccessToken(): void {
  inMemoryToken = null
}

/**
 * Configura un proveedor personalizado para obtener el token (útil para auth stores o refresh).
 */
export function setTokenProvider(provider: TokenGetter | null): void {
  customProvider = provider
}

/**
 * Resuelve el token que se envía: el del proveedor si devuelve un valor (prioridad);
 * si el proveedor no existe o devuelve null/undefined, cae al token en memoria.
 */
export async function resolveAccessToken(): Promise<string | null> {
  if (customProvider) {
    const provided = await customProvider()
    if (provided) return provided
  }
  return inMemoryToken
}

/**
 * Restaura el estado de tokens (útil entre tests).
 */
export function resetTokenState(): void {
  inMemoryToken = null
  customProvider = null
}
