export type TokenGetter = () => string | null | Promise<string | null>

let inMemoryToken: string | null = null
let customProvider: TokenGetter | null = null

/**
 * Obtiene el token de acceso actual en memoria.
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
 * Resuelve el token actual usando el proveedor configurado o el token en memoria.
 */
export async function resolveAccessToken(): Promise<string | null> {
  if (customProvider) {
    return await customProvider()
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
