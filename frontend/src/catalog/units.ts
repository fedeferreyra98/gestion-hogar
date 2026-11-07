import type { Unit } from '@/api/types'

export const UNITS: readonly Unit[] = ['UNIT', 'KG', 'G', 'L', 'ML', 'PACK'] as const

export const UNIT_LABELS: Record<Unit, string> = {
  UNIT: 'Unidad (u)',
  KG: 'Kilogramo (kg)',
  G: 'Gramo (g)',
  L: 'Litro (L)',
  ML: 'Mililitro (ml)',
  PACK: 'Paquete (pack)',
}

export const UNIT_SHORT_LABELS: Record<Unit, string> = {
  UNIT: 'u',
  KG: 'kg',
  G: 'g',
  L: 'L',
  ML: 'ml',
  PACK: 'pack',
}
