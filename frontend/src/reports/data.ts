import type { PricePoint, SummaryRow } from '@/api/hooks/useReports'
import type { Unit } from '@/api/types'

export const UNCATEGORIZED_KEY = 'uncategorized'
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/
const MAX_FILLED_MONTHS = 240

/** Filas de un mismo reporte agrupadas por moneda (nunca se suman monedas distintas). */
export interface CurrencyRows {
  currency: string
  rows: SummaryRow[]
}

export function groupByCurrency(rows: SummaryRow[]): CurrencyRows[] {
  const map = new Map<string, SummaryRow[]>()
  for (const row of rows) {
    const list = map.get(row.total.currency) ?? []
    list.push(row)
    map.set(row.total.currency, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => ({ currency, rows: list }))
}

/** Suma entera en unidades menores (BigInt: sin float). `null` si no es un entero seguro. */
export function sumMinor(rows: SummaryRow[]): number | null {
  const total = rows.reduce((acc, r) => acc + BigInt(r.total.amountMinor), 0n)
  return total <= BigInt(Number.MAX_SAFE_INTEGER) && total >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(total)
    : null
}

/** "2026-03" → "mar 2026". */
export function formatMonth(key: string): string {
  const match = MONTH_KEY.exec(key)
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : key
}

/**
 * El backend no devuelve meses sin gastos: los huecos entre el primero y el último mes
 * (de todo el reporte, para que las monedas compartan eje) se completan con 0.
 */
export function fillMonths(rows: SummaryRow[], allKeys: string[] = rows.map((r) => r.key)) {
  const valid = allKeys.filter((k) => MONTH_KEY.test(k)).sort()
  const first = valid[0]
  const last = valid[valid.length - 1]
  const byKey = new Map(rows.map((r) => [r.key, r.total.amountMinor]))
  if (!first || !last) return rows.map((r) => ({ key: r.key, amountMinor: r.total.amountMinor }))
  const [fy, fm] = first.split('-').map(Number) as [number, number]
  const [ly, lm] = last.split('-').map(Number) as [number, number]
  const span = (ly - fy) * 12 + (lm - fm) + 1
  if (span > MAX_FILLED_MONTHS) {
    return rows.map((r) => ({ key: r.key, amountMinor: r.total.amountMinor }))
  }
  const out: { key: string; amountMinor: number }[] = []
  for (let i = 0; i < span; i++) {
    const index = fy * 12 + (fm - 1) + i
    const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
    out.push({ key, amountMinor: byKey.get(key) ?? 0 })
  }
  return out
}

export function categoryLabel(row: SummaryRow): string {
  return row.key === UNCATEGORIZED_KEY ? 'Sin categoría' : row.label || 'Sin nombre'
}

export function storeLabel(row: SummaryRow): string {
  return row.key === '' ? 'Sin comercio' : row.label || 'Sin nombre'
}

export const UNIT_ORDER: readonly Unit[] = ['UNIT', 'KG', 'G', 'L', 'ML', 'PACK']

/** Unidades presentes en los puntos, en orden estable. */
export function unitsIn(points: PricePoint[]): Unit[] {
  const present = new Set(points.map((p) => p.unit))
  return UNIT_ORDER.filter((u) => present.has(u))
}

/** Puntos de UNA unidad agrupados por moneda: cada serie es homogénea (sin mezclar unidades ni monedas). */
export function seriesForUnit(points: PricePoint[], unit: Unit) {
  const map = new Map<string, PricePoint[]>()
  for (const p of points) {
    if (p.unit !== unit) continue
    const list = map.get(p.unitPrice.currency) ?? []
    list.push(p)
    map.set(p.unitPrice.currency, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => ({
      currency,
      points: [...list].sort((a, b) => a.date.localeCompare(b.date)),
    }))
}
