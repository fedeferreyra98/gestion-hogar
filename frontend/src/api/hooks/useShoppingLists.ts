import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { Client } from 'openapi-fetch'
import { getApiClient, unwrap, unwrapVoid } from '../client.ts'
import type { ProblemError } from '../errors.ts'
import type {
  ShoppingList,
  ShoppingListItem,
  ShoppingListItemInput,
  ShoppingListStatus,
  ShoppingListSummaryPage,
  paths,
} from '../types.ts'

export interface ListShoppingListsParams {
  status?: ShoppingListStatus
  page?: number
  size?: number
  sort?: string
}

export const shoppingListsRootQueryKey = ['shopping-lists'] as const
export const shoppingListsQueryKey = (params: ListShoppingListsParams = {}) =>
  ['shopping-lists', 'list', params] as const
export const shoppingListQueryKey = (id: string) => ['shopping-lists', 'detail', id] as const

export async function fetchShoppingLists(
  params: ListShoppingListsParams = {},
  client?: Client<paths>,
): Promise<ShoppingListSummaryPage> {
  const query: NonNullable<paths['/shopping-lists']['get']['parameters']['query']> = {}
  if (params.status !== undefined) query.status = params.status
  if (params.page !== undefined) query.page = params.page
  if (params.size !== undefined) query.size = params.size
  if (params.sort !== undefined) query.sort = params.sort
  return (await unwrap(
    (client ?? getApiClient()).GET('/shopping-lists', { params: { query } }),
  )) as ShoppingListSummaryPage
}

export async function fetchShoppingList(id: string, client?: Client<paths>): Promise<ShoppingList> {
  return unwrap(
    (client ?? getApiClient()).GET('/shopping-lists/{id}', { params: { path: { id } } }),
  )
}

export async function createShoppingList(
  name: string,
  client?: Client<paths>,
): Promise<ShoppingList> {
  return unwrap((client ?? getApiClient()).POST('/shopping-lists', { body: { name } }))
}

export async function archiveShoppingList(
  id: string,
  client?: Client<paths>,
): Promise<ShoppingList> {
  return unwrap(
    (client ?? getApiClient()).PATCH('/shopping-lists/{id}', {
      params: { path: { id } },
      body: { status: 'ARCHIVED' },
    }),
  )
}

export async function duplicateShoppingList(
  id: string,
  client?: Client<paths>,
): Promise<ShoppingList> {
  return unwrap(
    (client ?? getApiClient()).POST('/shopping-lists/{id}/duplicate', {
      params: { path: { id } },
      body: {},
    }),
  )
}

export async function addShoppingListItem(
  listId: string,
  input: ShoppingListItemInput,
  client?: Client<paths>,
): Promise<ShoppingListItem> {
  return unwrap(
    (client ?? getApiClient()).POST('/shopping-lists/{id}/items', {
      params: { path: { id: listId } },
      body: input,
    }),
  )
}

export async function setShoppingListItemChecked(
  listId: string,
  itemId: string,
  checked: boolean,
  client?: Client<paths>,
): Promise<ShoppingListItem> {
  return unwrap(
    (client ?? getApiClient()).PATCH('/shopping-lists/{id}/items/{itemId}', {
      params: { path: { id: listId, itemId } },
      body: { checked },
    }),
  )
}

export async function deleteShoppingListItem(
  listId: string,
  itemId: string,
  client?: Client<paths>,
): Promise<void> {
  return unwrapVoid(
    (client ?? getApiClient()).DELETE('/shopping-lists/{id}/items/{itemId}', {
      params: { path: { id: listId, itemId } },
    }),
  )
}

export type UseShoppingListsOptions = Omit<
  UseQueryOptions<
    ShoppingListSummaryPage,
    ProblemError,
    ShoppingListSummaryPage,
    ReturnType<typeof shoppingListsQueryKey>
  >,
  'queryKey' | 'queryFn'
> & { client?: Client<paths> }

export function useShoppingLists(
  params: ListShoppingListsParams = {},
  options: UseShoppingListsOptions = {},
): UseQueryResult<ShoppingListSummaryPage, ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: shoppingListsQueryKey(params),
    queryFn: () => fetchShoppingLists(params, client),
    ...queryOptions,
  })
}

export function useShoppingList(
  id: string,
  options: { client?: Client<paths> } = {},
): UseQueryResult<ShoppingList, ProblemError> {
  return useQuery({
    queryKey: shoppingListQueryKey(id),
    queryFn: () => fetchShoppingList(id, options.client),
  })
}

export function useCreateShoppingList(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<ShoppingList, ProblemError, string>({
    mutationFn: (name) => createShoppingList(name, client),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shoppingListsRootQueryKey }),
  })
}

export function useArchiveShoppingList(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<ShoppingList, ProblemError, string>({
    mutationFn: (id) => archiveShoppingList(id, client),
    // Also on error: a 422 LIST_NOT_OPEN means our view of the status is stale.
    onSettled: () => queryClient.invalidateQueries({ queryKey: shoppingListsRootQueryKey }),
  })
}

export function useDuplicateShoppingList(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<ShoppingList, ProblemError, string>({
    mutationFn: (id) => duplicateShoppingList(id, client),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shoppingListsRootQueryKey }),
  })
}

export function useAddShoppingListItem(listId: string, client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<ShoppingListItem, ProblemError, ShoppingListItemInput>({
    mutationFn: (input) => addShoppingListItem(listId, input, client),
    onSettled: () => queryClient.invalidateQueries({ queryKey: shoppingListsRootQueryKey }),
  })
}

export function useDeleteShoppingListItem(listId: string, client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<void, ProblemError, string>({
    mutationFn: (itemId) => deleteShoppingListItem(listId, itemId, client),
    onSettled: () => queryClient.invalidateQueries({ queryKey: shoppingListsRootQueryKey }),
  })
}

interface ToggleVars {
  itemId: string
  checked: boolean
}

function patchItemChecked(
  list: ShoppingList | undefined,
  itemId: string,
  checked: boolean,
): ShoppingList | undefined {
  if (!list) return list
  return {
    ...list,
    items: list.items.map((it) => (it.id === itemId ? { ...it, checked } : it)),
  }
}

/**
 * Tildado con optimistic update: la UI cambia al instante y se revierte (solo ese ítem)
 * si el servidor rechaza el cambio. Siempre revalida al terminar.
 */
export function useToggleShoppingListItem(listId: string, client?: Client<paths>) {
  const queryClient = useQueryClient()
  const key = shoppingListQueryKey(listId)
  return useMutation<ShoppingListItem, ProblemError, ToggleVars>({
    mutationFn: ({ itemId, checked }) =>
      setShoppingListItemChecked(listId, itemId, checked, client),
    onMutate: async ({ itemId, checked }) => {
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<ShoppingList>(key, (old) => patchItemChecked(old, itemId, checked))
    },
    onError: (_err, { itemId, checked }) => {
      queryClient.setQueryData<ShoppingList>(key, (old) => patchItemChecked(old, itemId, !checked))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: shoppingListsRootQueryKey }),
  })
}
