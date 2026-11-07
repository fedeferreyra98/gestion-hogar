import { isValidIsoDate } from '@/expenses/dates'

export interface ReportRange {
  from: string
  to: string
}

/** Lee el período de la URL descartando fechas inválidas (links viejos o editados a mano). */
export function parseRange(params: URLSearchParams): ReportRange {
  const date = (key: string) => {
    const value = params.get(key) ?? ''
    return isValidIsoDate(value) ? value : ''
  }
  return { from: date('from'), to: date('to') }
}

/** Forma canónica de la query string (conserva params ajenos). */
export function canonicalRangeSearch(params: URLSearchParams, range: ReportRange): string {
  const next = new URLSearchParams(params)
  for (const key of ['from', 'to'] as const) {
    if (range[key]) next.set(key, range[key])
    else next.delete(key)
  }
  return next.toString()
}

export function isInvalidRange({ from, to }: ReportRange): boolean {
  return from !== '' && to !== '' && from > to
}
