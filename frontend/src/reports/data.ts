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

export interface MonthBounds {
  /** YYYY-MM-DD (o YYYY-MM): primer mes a mostrar. Sin valor, el primer mes con datos. */
  from?: string
  /** YYYY-MM-DD (o YYYY-MM): último mes a mostrar. Sin valor, el último mes con datos. */
  to?: string
}

/**
 * El backend no devuelve meses sin gastos: los huecos se completan con 0 entre el primer y el
 * último mes del período elegido (`from`/`to`; si falta alguno, el primero/último mes con datos de
 * todo el reporte, para que las monedas compartan eje).
 */
export function fillMonths(
  rows: SummaryRow[],
  bounds: MonthBounds = {},
  allKeys: string[] = rows.map((r) => r.key),
) {
  const raw = (rows_: SummaryRow[]) =>
    rows_.map((r) => ({ key: r.key, amountMinor: r.total.amountMinor }))
  const valid = allKeys.filter((k) => MONTH_KEY.test(k)).sort()
  const monthOf = (date?: string) =>
    date && MONTH_KEY.test(date.slice(0, 7)) ? date.slice(0, 7) : ''
  // Los datos mandan si caen fuera del período (no deberían): nunca se pierde una barra.
  const first = [monthOf(bounds.from), valid[0]].filter(Boolean).sort()[0]
  const last = [monthOf(bounds.to), valid[valid.length - 1]].filter(Boolean).sort().at(-1)
  if (!first || !last) return raw(rows)
  const [fy, fm] = first.split('-').map(Number) as [number, number]
  const [ly, lm] = last.split('-').map(Number) as [number, number]
  const span = (ly - fy) * 12 + (lm - fm) + 1
  if (span > MAX_FILLED_MONTHS) return raw(rows)
  const byKey = new Map(rows.map((r) => [r.key, r.total.amountMinor]))
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

/** Unidades presentes en los puntos, en orden estable (las desconocidas, al final y ordenadas). */
export function unitsIn(points: PricePoint[]): Unit[] {
  const present = new Set(points.map((p) => p.unit))
  const known = UNIT_ORDER.filter((u) => present.has(u))
  const unknown = [...present].filter((u) => !UNIT_ORDER.includes(u)).sort()
  return [...known, ...unknown]
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
