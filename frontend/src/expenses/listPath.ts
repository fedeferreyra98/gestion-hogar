import { useLocation } from 'react-router-dom'

/** Query string del listado desde el que se llegó (filtros y página), para volver sin perderla. */
export function useListPath(): string {
  const { state } = useLocation()
  const search =
    typeof state === 'object' && state !== null && 'listSearch' in state
      ? String((state as { listSearch: unknown }).listSearch)
      : ''
  return `/gastos${search.startsWith('?') ? search : ''}`
}
