import { getApiClient, setUnauthorizedHandler, unwrap, unwrapVoid } from '@/api/client.ts'
import { clearAccessToken, setAccessToken } from '@/api/token.ts'
import { isProblemError } from '@/api/errors.ts'
import type { AuthTokens, RegisterOwnerRequest } from '@/api/types.ts'

/**
 * Sesión de la UI. Decisión: el access token vive solo en memoria (token.ts) y el
 * refresh token en localStorage para sobrevivir a recargas; al arrancar se canjea
 * por un access token nuevo (bootstrapSession).
 */
export const REFRESH_TOKEN_KEY = 'gh.refreshToken' // allow-secret: nombre de clave de storage, no secreto

export type SessionStatus = 'unknown' | 'authenticated' | 'unauthenticated'

export interface SessionState {
  status: SessionStatus
  /** true si la sesión se perdió por un refresh fallido (no por logout voluntario). */
  expired: boolean
}

const initialState: SessionState = { status: 'unknown', expired: false }
let state: SessionState = initialState
const listeners = new Set<() => void>()
let refreshInFlight: Promise<boolean> | null = null

function setState(patch: Partial<SessionState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function getSessionState(): SessionState {
  return state
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function applyTokens(issued: AuthTokens): void {
  setAccessToken(issued.accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, issued.refreshToken)
  setState({ status: 'authenticated', expired: false })
}

function endSession(expired: boolean): void {
  clearAccessToken()
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  setState({ status: 'unauthenticated', expired })
}

export async function login(email: string, password: string): Promise<void> {
  applyTokens(await unwrap(getApiClient().POST('/auth/login', { body: { email, password } })))
}

export async function registerOwner(body: RegisterOwnerRequest): Promise<void> {
  applyTokens(await unwrap(getApiClient().POST('/auth/register-owner', { body })))
}

/**
 * Canjea el refresh token por tokens nuevos. Una sola llamada en vuelo a la vez
 * (el backend rota el refresh token, así que dos concurrentes invalidarían una).
 * Si el servidor lo rechaza (400/401) o no hay refresh token, cierra la sesión como
 * expirada; ante un fallo de red/5xx conserva la sesión y devuelve false.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = readRefreshToken()
  if (!refreshToken) {
    endSession(state.status === 'authenticated')
    return false
  }
  try {
    const tokens = await unwrap(getApiClient().POST('/auth/refresh', { body: { refreshToken } }))
    applyTokens(tokens)
    return true
  } catch (e) {
    if (isProblemError(e) && (e.status === 401 || e.status === 400)) endSession(true)
    return false
  }
}

/** Gancho `onUnauthorized` del cliente API: refresca; si falla, la sesión expira. */
export async function handleUnauthorized(): Promise<void> {
  if (state.status !== 'authenticated') return
  await refreshSession()
}

/** Al arrancar la app: restaura la sesión desde el refresh token guardado, si hay. */
export async function bootstrapSession(): Promise<void> {
  if (state.status !== 'unknown') return
  if (!readRefreshToken()) {
    setState({ status: 'unauthenticated' })
    return
  }
  await refreshSession()
}

/** Cierra sesión: revoca el refresh token en el servidor (best-effort) y limpia todo. */
export async function logout(): Promise<void> {
  const refreshToken = readRefreshToken()
  try {
    if (refreshToken) {
      await unwrapVoid(getApiClient().POST('/auth/logout', { body: { refreshToken } }))
    }
  } catch {
    // Idempotente del lado del usuario: aunque falle la revocación, se cierra localmente.
  } finally {
    endSession(false)
  }
}

setUnauthorizedHandler(handleUnauthorized)

/** Solo para tests. */
export function resetSession(): void {
  clearAccessToken()
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  refreshInFlight = null
  state = initialState
  listeners.forEach((l) => l())
}
