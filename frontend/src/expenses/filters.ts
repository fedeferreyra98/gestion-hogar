import type { ExpenseSource } from '@/api/hooks/useExpenses'
import { isValidIsoDate } from './dates'

export const FILTER_KEYS = ['from', 'to', 'categoryId', 'paidBy', 'source', 'q'] as const

export interface ExpenseFilters {
  from: string
  to: string
  categoryId: string
  paidBy: string
  source: ExpenseSource | ''
  q: string
  /** 0-based (en la URL es 1-based). */
  page: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_Q = 255

/** Lee los filtros de la URL descartando lo inválido (links viejos o editados a mano). */
export function parseFilters(params: URLSearchParams): ExpenseFilters {
  const get = (key: string) => params.get(key) ?? ''
  const date = (key: string) => (isValidIsoDate(get(key)) ? get(key) : '')
  const uuid = (key: string) => (UUID.test(get(key)) ? get(key) : '')
  const source = get('source')
  const pageText = get('page')
  const pageNumber = /^\d{1,9}$/.test(pageText) ? Number(pageText) : 1
  return {
    from: date('from'),
    to: date('to'),
    categoryId: uuid('categoryId'),
    paidBy: uuid('paidBy'),
    source: source === 'MANUAL' || source === 'PURCHASE' ? source : '',
    q: get('q').trim().slice(0, MAX_Q),
    page: Math.max(pageNumber, 1) - 1,
  }
}

/** Forma canónica de la query string para esos filtros (conserva otros params ajenos). */
export function canonicalSearch(params: URLSearchParams, filters: ExpenseFilters): string {
  const next = new URLSearchParams(params)
  for (const key of FILTER_KEYS) {
    if (filters[key]) next.set(key, filters[key])
    else next.delete(key)
  }
  if (filters.page > 0) next.set('page', String(filters.page + 1))
  else next.delete('page')
  return next.toString()
}
