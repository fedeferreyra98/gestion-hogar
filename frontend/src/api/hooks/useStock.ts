import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { Client } from 'openapi-fetch'
import { getApiClient, unwrap } from '../client.ts'
import type { ProblemError } from '../errors.ts'
import type {
  CreateStockItemRequest,
  Decimal,
  StockAlerts,
  StockItem,
  StockItemPage,
  paths,
} from '../types.ts'

export interface ListStockParams {
  page?: number
  size?: number
}

export const stockRootQueryKey = ['stock'] as const
export const stockListQueryKey = (params: ListStockParams = {}) =>
  ['stock', 'list', params] as const
export const stockAlertsQueryKey = ['stock', 'alerts'] as const

export async function fetchStock(
  params: ListStockParams = {},
  client?: Client<paths>,
): Promise<StockItemPage> {
  // Fixed FEFO order (server side); only ACTIVE batches are shown.
  const query: NonNullable<paths['/stock']['get']['parameters']['query']> = { status: 'ACTIVE' }
  if (params.page !== undefined) query.page = params.page
  if (params.size !== undefined) query.size = params.size
  return (await unwrap(
    (client ?? getApiClient()).GET('/stock', { params: { query } }),
  )) as StockItemPage
}

export async function fetchStockAlerts(client?: Client<paths>): Promise<StockAlerts> {
  return unwrap((client ?? getApiClient()).GET('/stock/alerts'))
}

export async function createStockItem(
  input: CreateStockItemRequest,
  client?: Client<paths>,
): Promise<StockItem> {
  return unwrap((client ?? getApiClient()).POST('/stock', { body: input }))
}

export async function consumeStockItem(
  id: string,
  quantity: Decimal,
  client?: Client<paths>,
): Promise<StockItem> {
  return unwrap(
    (client ?? getApiClient()).POST('/stock/{id}/consume', {
      params: { path: { id } },
      body: { quantity },
    }),
  )
}

export async function discardStockItem(id: string, client?: Client<paths>): Promise<StockItem> {
  return unwrap(
    (client ?? getApiClient()).POST('/stock/{id}/discard', {
      params: { path: { id } },
      body: {},
    }),
  )
}

export function useStock(
  params: ListStockParams = {},
  client?: Client<paths>,
): UseQueryResult<StockItemPage, ProblemError> {
  return useQuery({
    queryKey: stockListQueryKey(params),
    queryFn: () => fetchStock(params, client),
  })
}

export function useStockAlerts(client?: Client<paths>): UseQueryResult<StockAlerts, ProblemError> {
  return useQuery({
    queryKey: stockAlertsQueryKey,
    queryFn: () => fetchStockAlerts(client),
  })
}

export function useCreateStockItem(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<StockItem, ProblemError, CreateStockItemRequest>({
    mutationFn: (input) => createStockItem(input, client),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stockRootQueryKey }),
  })
}

export function useConsumeStockItem(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<StockItem, ProblemError, { id: string; quantity: Decimal }>({
    mutationFn: ({ id, quantity }) => consumeStockItem(id, quantity, client),
    // Also on error: a 409 means the batch is stale and the list must be refreshed.
    onSettled: () => queryClient.invalidateQueries({ queryKey: stockRootQueryKey }),
  })
}

export function useDiscardStockItem(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<StockItem, ProblemError, { id: string }>({
    mutationFn: ({ id }) => discardStockItem(id, client),
    onSettled: () => queryClient.invalidateQueries({ queryKey: stockRootQueryKey }),
  })
}
