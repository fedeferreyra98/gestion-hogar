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
  Category,
  CategoryInput,
  Product,
  ProductInput,
  ProductPage,
  paths,
} from '../types.ts'

export interface ListProductsParams {
  q?: string
  categoryId?: string
  includeArchived?: boolean
  page?: number
  size?: number
  sort?: string
}

export const categoriesQueryKey = ['categories'] as const
export const productsRootQueryKey = ['products'] as const
export const productsQueryKey = (params: ListProductsParams = {}) => ['products', params] as const

export async function fetchCategories(client?: Client<paths>): Promise<Category[]> {
  return unwrap((client ?? getApiClient()).GET('/categories'))
}

export async function createCategory(
  input: CategoryInput,
  client?: Client<paths>,
): Promise<Category> {
  return unwrap((client ?? getApiClient()).POST('/categories', { body: input }))
}

export async function updateCategory(
  id: string,
  input: CategoryInput,
  client?: Client<paths>,
): Promise<Category> {
  return unwrap(
    (client ?? getApiClient()).PUT('/categories/{id}', {
      params: { path: { id } },
      body: input,
    }),
  )
}

export async function deleteCategory(id: string, client?: Client<paths>): Promise<void> {
  return unwrapVoid(
    (client ?? getApiClient()).DELETE('/categories/{id}', {
      params: { path: { id } },
    }),
  )
}

export async function fetchProducts(
  params: ListProductsParams = {},
  client?: Client<paths>,
): Promise<ProductPage> {
  const query: NonNullable<paths['/products']['get']['parameters']['query']> = {}
  if (params.q !== undefined && params.q !== '') query.q = params.q
  if (params.categoryId !== undefined && params.categoryId !== '')
    query.categoryId = params.categoryId
  if (params.includeArchived !== undefined) query.includeArchived = params.includeArchived
  if (params.page !== undefined) query.page = params.page
  if (params.size !== undefined) query.size = params.size
  if (params.sort !== undefined) query.sort = params.sort

  return (await unwrap(
    (client ?? getApiClient()).GET('/products', {
      params: { query },
    }),
  )) as ProductPage
}

export async function createProduct(input: ProductInput, client?: Client<paths>): Promise<Product> {
  return unwrap((client ?? getApiClient()).POST('/products', { body: input }))
}

export async function updateProduct(
  id: string,
  input: ProductInput,
  client?: Client<paths>,
): Promise<Product> {
  return unwrap(
    (client ?? getApiClient()).PUT('/products/{id}', {
      params: { path: { id } },
      body: input,
    }),
  )
}

export async function archiveProduct(id: string, client?: Client<paths>): Promise<Product> {
  return unwrap(
    (client ?? getApiClient()).POST('/products/{id}/archive', {
      params: { path: { id } },
    }),
  )
}

export async function unarchiveProduct(id: string, client?: Client<paths>): Promise<Product> {
  return unwrap(
    (client ?? getApiClient()).POST('/products/{id}/unarchive', {
      params: { path: { id } },
    }),
  )
}

export type UseCategoriesOptions = Omit<
  UseQueryOptions<Category[], ProblemError, Category[], typeof categoriesQueryKey>,
  'queryKey' | 'queryFn'
> & {
  client?: Client<paths>
}

export function useCategories(
  options: UseCategoriesOptions = {},
): UseQueryResult<Category[], ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: categoriesQueryKey,
    queryFn: () => fetchCategories(client),
    ...queryOptions,
  })
}

export function useCreateCategory(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Category, ProblemError, CategoryInput>({
    mutationFn: (input) => createCategory(input, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesQueryKey })
    },
  })
}

export function useUpdateCategory(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Category, ProblemError, { id: string; input: CategoryInput }>({
    mutationFn: ({ id, input }) => updateCategory(id, input, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesQueryKey })
    },
  })
}

export function useDeleteCategory(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<void, ProblemError, string>({
    mutationFn: (id) => deleteCategory(id, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesQueryKey })
    },
  })
}

export type UseProductsOptions = Omit<
  UseQueryOptions<ProductPage, ProblemError, ProductPage, ReturnType<typeof productsQueryKey>>,
  'queryKey' | 'queryFn'
> & {
  client?: Client<paths>
}

export function useProducts(
  params: ListProductsParams = {},
  options: UseProductsOptions = {},
): UseQueryResult<ProductPage, ProblemError> {
  const { client, ...queryOptions } = options
  return useQuery({
    queryKey: productsQueryKey(params),
    queryFn: () => fetchProducts(params, client),
    ...queryOptions,
  })
}

export function useCreateProduct(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Product, ProblemError, ProductInput>({
    mutationFn: (input) => createProduct(input, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productsRootQueryKey })
    },
  })
}

export function useUpdateProduct(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Product, ProblemError, { id: string; input: ProductInput }>({
    mutationFn: ({ id, input }) => updateProduct(id, input, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productsRootQueryKey })
    },
  })
}

export function useArchiveProduct(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Product, ProblemError, string>({
    mutationFn: (id) => archiveProduct(id, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productsRootQueryKey })
    },
  })
}

export function useUnarchiveProduct(client?: Client<paths>) {
  const queryClient = useQueryClient()
  return useMutation<Product, ProblemError, string>({
    mutationFn: (id) => unarchiveProduct(id, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productsRootQueryKey })
    },
  })
}
