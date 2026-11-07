import { describe, expect, it } from 'vitest'
import type { PricePoint, SummaryRow } from '@/api/hooks/useReports'
import {
  categoryLabel,
  fillMonths,
  formatMonth,
  groupByCurrency,
  seriesForUnit,
  storeLabel,
  sumMinor,
  unitsIn,
} from './data'

const row = (key: string, amountMinor: number, currency = 'ARS', label = key): SummaryRow => ({
  key,
  label,
  total: { amountMinor, currency },
})

describe('reports/data', () => {
  it('completa los meses sin gastos con 0, también cruzando el año', () => {
    const filled = fillMonths([row('2025-11', 100), row('2026-02', 300)])
    expect(filled).toEqual([
      { key: '2025-11', amountMinor: 100 },
      { key: '2025-12', amountMinor: 0 },
      { key: '2026-01', amountMinor: 0 },
      { key: '2026-02', amountMinor: 300 },
    ])
  })

  it('usa el rango de todo el reporte para que las monedas compartan eje', () => {
    const ars = [row('2026-01', 100)]
    const filled = fillMonths(ars, ['2026-01', '2026-03'])
    expect(filled.map((m) => m.key)).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('no suma monedas distintas y suma en enteros', () => {
    const groups = groupByCurrency([row('a', 1, 'USD'), row('b', 250, 'ARS'), row('c', 50, 'ARS')])
    expect(groups.map((g) => g.currency)).toEqual(['ARS', 'USD'])
    expect(sumMinor(groups[0]!.rows)).toBe(300)
    expect(sumMinor([row('x', Number.MAX_SAFE_INTEGER), row('y', 1)])).toBeNull()
  })

  it('etiqueta las claves especiales del backend', () => {
    expect(categoryLabel(row('uncategorized', 1, 'ARS', 'Sin categoría'))).toBe('Sin categoría')
    expect(storeLabel(row('', 1, 'ARS', ''))).toBe('Sin comercio')
    expect(storeLabel(row('coto', 1, 'ARS', 'Coto'))).toBe('Coto')
    expect(formatMonth('2026-03')).toBe('mar 2026')
  })

  it('arma series homogéneas por unidad y moneda, ordenadas por fecha', () => {
    const p = (date: string, unit: PricePoint['unit'], amountMinor: number, currency = 'ARS') =>
      ({ date, unit, unitPrice: { amountMinor, currency } }) as PricePoint
    const points = [p('2026-02-01', 'KG', 2), p('2026-01-01', 'KG', 1), p('2026-01-05', 'G', 9)]
    expect(unitsIn(points)).toEqual(['KG', 'G'])
    expect(seriesForUnit(points, 'KG')[0]!.points.map((x) => x.date)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ])
    expect(seriesForUnit(points, 'G')).toHaveLength(1)
  })
})
