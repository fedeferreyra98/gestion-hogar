import {
  useIsMutating,
  useMutation,
  type QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { Client } from 'openapi-fetch'
import { getApiClient, unwrap, unwrapVoid } from '../client.ts'
import { isProblemError, type ProblemError } from '../errors.ts'
import { expensesRootQueryKey } from './useExpenses.ts'
import { stockRootQueryKey } from './useStock.ts'
import type {
  CompleteListRequest,
  Purchase,
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
  try {
    await unwrapVoid(
      (client ?? getApiClient()).DELETE('/shopping-lists/{id}/items/{itemId}', {
        params: { path: { id: listId, itemId } },
      }),
    )
  } catch (err) {
    // Idempotent: if the item is already gone (double tap, other device) the goal is met.
    if (isProblemError(err) && err.status === 404) return
    throw err
  }
}

export async function completeShoppingList(
  id: string,
  input: CompleteListRequest,
  client?: Client<paths>,
): Promise<Purchase> {
  return unwrap(
    (client ?? getApiClient()).POST('/shopping-lists/{id}/complete', {
      params: { path: { id } },
      body: input,
    }),
  )
}

export const completeListMutationKey = (id: string) => ['shopping-lists', 'complete', id] as const

/** `true` while a "complete" of this list is in flight (blocks double submits across mounts). */
export function useIsCompletingShoppingList(id: string): boolean {
  return useIsMutating({ mutationKey: completeListMutationKey(id) }) > 0
}

/**
 * Completa la lista (UC-13). Afecta listas, gastos (nuevo gasto PURCHASE) y stock (lotes nuevos):
 * se revalidan las tres, también ante error (un 422 LIST_NOT_OPEN indica vista desactualizada).
 * La revalidación no se espera: la navegación posterior no debe depender de ella.
 */
export function useCompleteShoppingList(id: string, client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Purchase, ProblemError, CompleteListRequest>({
    mutationKey: completeListMutationKey(id),
    mutationFn: (input) => completeShoppingList(id, input, client),
    onSettled: () => {
      for (const queryKey of [shoppingListsRootQueryKey, expensesRootQueryKey, stockRootQueryKey])
        void queryClient.invalidateQueries({ queryKey })
    },
  })
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

/** Common key prefix of every item mutation of a list (used to know if any is in flight). */
const listMutationsKey = (listId: string) => ['shopping-lists', 'mutation', listId] as const

/**
 * Revalidate only when this is the last in-flight mutation of the list: refetching while
 * others are pending would overwrite their optimistic state with a stale server snapshot.
 */
function invalidateWhenIdle(queryClient: QueryClient, listId: string) {
  if (queryClient.isMutating({ mutationKey: listMutationsKey(listId) }) > 1) return
  return queryClient.invalidateQueries({ queryKey: shoppingListsRootQueryKey })
}

export function useAddShoppingListItem(listId: string, client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<ShoppingListItem, ProblemError, ShoppingListItemInput>({
    mutationKey: [...listMutationsKey(listId), 'add'],
    mutationFn: (input) => addShoppingListItem(listId, input, client),
    onSettled: () => invalidateWhenIdle(queryClient, listId),
  })
}

/** One instance per item row, so each row tracks its own pending state. */
export function useDeleteShoppingListItem(
  listId: string,
  itemId: string,
  onError?: (error: ProblemError) => void,
  client?: Client<paths>,
) {
  const queryClient = useQueryClient()
  return useMutation<void, ProblemError, void>({
    mutationKey: [...listMutationsKey(listId), 'delete', itemId],
    mutationFn: () => deleteShoppingListItem(listId, itemId, client),
    onError: (err) => onError?.(err),
    onSettled: () => invalidateWhenIdle(queryClient, listId),
  })
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
 * Tildado con optimistic update: la UI cambia al instante y, si el servidor lo rechaza,
 * se restaura el valor previo de ese ítem y se avisa (`onError` del hook: corre una vez por
 * cada fallo, a diferencia del de `mutate()` que solo corre para la última llamada).
 * Los tildados del mismo ítem se encolan (`scope`) y solo se revalida cuando no quedan
 * mutaciones de la lista en vuelo. Una instancia por fila.
 */
export function useToggleShoppingListItem(
  listId: string,
  itemId: string,
  onError?: (error: ProblemError) => void,
  client?: Client<paths>,
) {
  const queryClient = useQueryClient()
  const key = shoppingListQueryKey(listId)
  return useMutation<ShoppingListItem, ProblemError, boolean, { previous?: boolean }>({
    mutationKey: [...listMutationsKey(listId), 'toggle', itemId],
    scope: { id: `shopping-list-${listId}-item-${itemId}` },
    mutationFn: (checked) => setShoppingListItemChecked(listId, itemId, checked, client),
    onMutate: async (checked) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient
        .getQueryData<ShoppingList>(key)
        ?.items.find((it) => it.id === itemId)?.checked
      queryClient.setQueryData<ShoppingList>(key, (old) => patchItemChecked(old, itemId, checked))
      return { previous }
    },
    onError: (err, checked, context) => {
      queryClient.setQueryData<ShoppingList>(key, (old) =>
        patchItemChecked(old, itemId, context?.previous ?? !checked),
      )
      onError?.(err)
    },
    onSettled: () => invalidateWhenIdle(queryClient, listId),
  })
}
