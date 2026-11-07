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
import type { Member, Schemas, paths } from '../types.ts'

export type Expense = Schemas['Expense']
export type ExpenseInput = Schemas['ExpenseInput']
export type ExpenseSource = Schemas['ExpenseSource']
export type ExpensePage = Omit<Schemas['ExpensePage'], 'content'> & { content: Expense[] }

export interface ListExpensesParams {
  from?: string
  to?: string
  categoryId?: string
  paidBy?: string
  source?: ExpenseSource
  q?: string
  page?: number
  size?: number
  sort?: string
}

export const expensesRootQueryKey = ['expenses'] as const
export const expensesQueryKey = (params: ListExpensesParams = {}) =>
  ['expenses', 'list', params] as const
export const expenseQueryKey = (id: string) => ['expenses', 'detail', id] as const
export const membersQueryKey = ['members'] as const

export async function fetchExpenses(
  params: ListExpensesParams = {},
  client?: Client<paths>,
): Promise<ExpensePage> {
  const query: NonNullable<paths['/expenses']['get']['parameters']['query']> = {}
  if (params.from) query.from = params.from
  if (params.to) query.to = params.to
  if (params.categoryId) query.categoryId = params.categoryId
  if (params.paidBy) query.paidBy = params.paidBy
  if (params.source) query.source = params.source
  if (params.q) query.q = params.q
  if (params.page !== undefined) query.page = params.page
  if (params.size !== undefined) query.size = params.size
  if (params.sort) query.sort = params.sort
  return (await unwrap(
    (client ?? getApiClient()).GET('/expenses', { params: { query } }),
  )) as ExpensePage
}

export async function fetchExpense(id: string, client?: Client<paths>): Promise<Expense> {
  return unwrap((client ?? getApiClient()).GET('/expenses/{id}', { params: { path: { id } } }))
}

export async function createExpense(input: ExpenseInput, client?: Client<paths>): Promise<Expense> {
  return unwrap((client ?? getApiClient()).POST('/expenses', { body: input }))
}

export async function updateExpense(
  id: string,
  input: ExpenseInput,
  client?: Client<paths>,
): Promise<Expense> {
  return unwrap(
    (client ?? getApiClient()).PUT('/expenses/{id}', { params: { path: { id } }, body: input }),
  )
}

export async function deleteExpense(id: string, client?: Client<paths>): Promise<void> {
  return unwrapVoid(
    (client ?? getApiClient()).DELETE('/expenses/{id}', { params: { path: { id } } }),
  )
}

export async function fetchMembers(client?: Client<paths>): Promise<Member[]> {
  return unwrap((client ?? getApiClient()).GET('/members'))
}

type Opts<T, K extends readonly unknown[]> = Omit<
  UseQueryOptions<T, ProblemError, T, K>,
  'queryKey' | 'queryFn'
> & { client?: Client<paths> }

export function useExpenses(
  params: ListExpensesParams = {},
  options: Opts<ExpensePage, ReturnType<typeof expensesQueryKey>> = {},
): UseQueryResult<ExpensePage, ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: expensesQueryKey(params),
    queryFn: () => fetchExpenses(params, client),
    ...queryOptions,
  })
}

export function useExpense(
  id: string,
  options: Opts<Expense, ReturnType<typeof expenseQueryKey>> = {},
): UseQueryResult<Expense, ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: expenseQueryKey(id),
    queryFn: () => fetchExpense(id, client),
    ...queryOptions,
  })
}

/** Miembros del hogar (activos e inactivos: el histórico los necesita). */
export function useMembers(
  options: Opts<Member[], typeof membersQueryKey> = {},
): UseQueryResult<Member[], ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: membersQueryKey,
    queryFn: () => fetchMembers(client),
    ...queryOptions,
  })
}

export function useCreateExpense(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Expense, ProblemError, ExpenseInput>({
    mutationFn: (input) => createExpense(input, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: expensesRootQueryKey })
    },
  })
}

export function useUpdateExpense(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Expense, ProblemError, { id: string; input: ExpenseInput }>({
    mutationFn: ({ id, input }) => updateExpense(id, input, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: expensesRootQueryKey })
    },
  })
}

export function useDeleteExpense(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<void, ProblemError, string>({
    mutationFn: (id) => deleteExpense(id, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: expensesRootQueryKey })
    },
  })
}
