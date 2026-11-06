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
let loggingOut = false
/** Se incrementa al terminar la sesión: invalida refreshes que estaban en vuelo. */
let sessionEpoch = 0

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
  sessionEpoch++
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
  const epoch = sessionEpoch
  let refreshToken = readRefreshToken()
  if (!refreshToken) {
    endSession(state.status === 'authenticated')
    return false
  }
  // Un segundo intento solo si otra pestaña rotó el refresh token mientras tanto.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const issued = await unwrap(getApiClient().POST('/auth/refresh', { body: { refreshToken } }))
      // Si la sesión terminó (logout/expiración) durante la llamada, no se reautentica.
      if (epoch !== sessionEpoch) return false
      applyTokens(issued)
      return true
    } catch (e) {
      if (epoch !== sessionEpoch) return false
      if (!isProblemError(e) || (e.status !== 401 && e.status !== 400)) return false
      const latest = readRefreshToken()
      if (latest && latest !== refreshToken && attempt === 0) {
        refreshToken = latest
        continue
      }
      endSession(true)
      return false
    }
  }
  return false
}

/** Gancho `onUnauthorized` del cliente API: refresca; si falla, la sesión expira. */
export async function handleUnauthorized(): Promise<void> {
  if (state.status !== 'authenticated' || loggingOut) return
  await refreshSession()
}

/**
 * Al arrancar la app: restaura la sesión desde el refresh token guardado, si hay.
 * Si el refresh falla por red/5xx se pasa a 'unauthenticated' (sin marcar expiración y
 * conservando el token guardado) para no dejar la app en "Cargando…" para siempre.
 */
export async function bootstrapSession(): Promise<void> {
  if (state.status !== 'unknown') return
  if (readRefreshToken()) await refreshSession()
  if (state.status === 'unknown') setState({ status: 'unauthenticated' })
}

/**
 * Cierra sesión: revoca el refresh token vigente en el servidor (best-effort) y limpia todo.
 * /auth/logout requiere access token: si venció (401) se refresca explícitamente y se
 * revoca el token NUEVO, en vez de dejar que el gancho rote el token a mitad de camino.
 */
export async function logout(): Promise<void> {
  loggingOut = true
  try {
    await refreshInFlight?.catch(() => false)
    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshToken = readRefreshToken()
      if (!refreshToken) break
      try {
        await unwrapVoid(getApiClient().POST('/auth/logout', { body: { refreshToken } }))
        break
      } catch (e) {
        if (attempt === 0 && isProblemError(e) && e.status === 401 && (await refreshSession())) {
          continue
        }
        break // Aunque falle la revocación, se cierra localmente.
      }
    }
  } finally {
    endSession(false)
    loggingOut = false
  }
}

setUnauthorizedHandler(handleUnauthorized)

/** Solo para tests. */
export function resetSession(): void {
  clearAccessToken()
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  refreshInFlight = null
  loggingOut = false
  sessionEpoch++
  state = initialState
  listeners.forEach((l) => l())
}
