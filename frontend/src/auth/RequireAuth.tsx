import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from './useSession'

export function RequireAuth() {
  const { status, expired } = useSession()
  const location = useLocation()

  if (status === 'unknown') {
    return (
      <p role="status" className="p-4 text-muted-foreground">
        Cargando…
      </p>
    )
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname, expired }} />
  }
  return <Outlet />
}
