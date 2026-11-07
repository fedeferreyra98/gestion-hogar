import type { Suggestion } from '@/api/types'

/** `YYYY-MM-DD` → `DD/MM/YYYY` (sin pasar por Date: evita corrimientos por zona horaria). */
function formatIsoDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

/** Motivo de la sugerencia en texto (no depende solo del color). */
export function reasonText(s: Suggestion): string {
  if (s.reason === 'OUT_OF_STOCK') return 'Sin stock'
  const date = s.detail ? formatIsoDate(s.detail) : null
  if (s.reason === 'EXPIRED') return date ? `Vencido el ${date}` : 'Vencido'
  return date ? `Vence el ${date}` : 'Por vencer'
}
