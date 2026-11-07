import type { ShoppingListStatus } from '@/api/types'

export const STATUS_LABELS: Record<ShoppingListStatus, string> = {
  OPEN: 'Abierta',
  COMPLETED: 'Completada',
  ARCHIVED: 'Archivada',
}

export function problemMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: string }).code
    if (code === 'LIST_NOT_OPEN') return 'La lista ya no está abierta, no se puede modificar.'
  }
  return fallback
}
