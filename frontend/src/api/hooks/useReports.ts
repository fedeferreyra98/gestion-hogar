import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query'
import type { Client } from 'openapi-fetch'
import { getApiClient, unwrap } from '../client.ts'
import type { ProblemError } from '../errors.ts'
import type { Schemas, Unit, paths } from '../types.ts'

export type SummaryRow = Schemas['SummaryRow']
export type PricePoint = Schemas['PricePoint']
export type SummaryGroupBy = 'month' | 'category' | 'store'

export interface SummaryParams {
  groupBy: SummaryGroupBy
  from?: string
  to?: string
}

export interface PriceHistoryParams {
  from?: string
  to?: string
  unit?: Unit
}

// Cuelga de `expenses` para que cualquier alta/edición/borrado de gastos (o compra completada,
// que invalida `expenses`) refresque también los reportes.
export const expenseSummaryQueryKey = (params: SummaryParams) =>
  ['expenses', 'summary', params] as const
export const priceHistoryQueryKey = (productId: string, params: PriceHistoryParams = {}) =>
  ['products', 'price-history', productId, params] as const

export async function fetchExpenseSummary(
  params: SummaryParams,
  client?: Client<paths>,
): Promise<SummaryRow[]> {
  const query: paths['/expenses/summary']['get']['parameters']['query'] = {
    groupBy: params.groupBy,
  }
  if (params.from) query.from = params.from
  if (params.to) query.to = params.to
  return unwrap((client ?? getApiClient()).GET('/expenses/summary', { params: { query } }))
}

export async function fetchPriceHistory(
  productId: string,
  params: PriceHistoryParams = {},
  client?: Client<paths>,
): Promise<PricePoint[]> {
  const query: NonNullable<paths['/products/{id}/price-history']['get']['parameters']['query']> = {}
  if (params.from) query.from = params.from
  if (params.to) query.to = params.to
  if (params.unit) query.unit = params.unit
  return unwrap(
    (client ?? getApiClient()).GET('/products/{id}/price-history', {
      params: { path: { id: productId }, query },
    }),
  )
}

type Opts<T, K extends readonly unknown[]> = Omit<
  UseQueryOptions<T, ProblemError, T, K>,
  'queryKey' | 'queryFn'
> & { client?: Client<paths> }

export function useExpenseSummary(
  params: SummaryParams,
  options: Opts<SummaryRow[], ReturnType<typeof expenseSummaryQueryKey>> = {},
): UseQueryResult<SummaryRow[], ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: expenseSummaryQueryKey(params),
    queryFn: () => fetchExpenseSummary(params, client),
    ...queryOptions,
  })
}

export function usePriceHistory(
  productId: string,
  params: PriceHistoryParams = {},
  options: Opts<PricePoint[], ReturnType<typeof priceHistoryQueryKey>> = {},
): UseQueryResult<PricePoint[], ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: priceHistoryQueryKey(productId, params),
    queryFn: () => fetchPriceHistory(productId, params, client),
    ...queryOptions,
  })
}
