import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { isProblemError } from '@/api/errors'
import { bootstrapSession, getSessionState } from './session'
import { useSession } from './useSession'

/**
 * Restaura la sesión al montar, reintenta una vez las queries que fallaron con 401
 * (el cliente no reintenta: el gancho onUnauthorized ya refrescó el token cuando el
 * error llega acá) y limpia la caché al perder la sesión.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { status } = useSession()

  useEffect(() => {
    void bootstrapSession()
  }, [])

  useEffect(() => {
    // Un solo reintento por query: si tras refrescar vuelve a dar 401 no hay loop.
    const retried = new Set<string>()
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return
      const { query, action } = event
      if (action.type === 'success') retried.delete(query.queryHash)
      if (
        action.type === 'error' &&
        isProblemError(action.error) &&
        action.error.status === 401 &&
        getSessionState().status === 'authenticated' &&
        !retried.has(query.queryHash)
      ) {
        retried.add(query.queryHash)
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true })
      }
    })
  }, [queryClient])

  useEffect(() => {
    if (status === 'unauthenticated') queryClient.clear()
  }, [status, queryClient])

  return children
}
