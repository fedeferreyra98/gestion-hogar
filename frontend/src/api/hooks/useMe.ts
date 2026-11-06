import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query'
import type { Client } from 'openapi-fetch'
import { apiClient, unwrap } from '../client.ts'
import type { ProblemError } from '../errors.ts'
import type { Me, paths } from '../types.ts'

export const meQueryKey = ['me'] as const

/**
 * Obtiene el perfil del usuario autenticado (/me).
 */
export async function fetchMe(client: Client<paths> = apiClient): Promise<Me> {
  return unwrap(client.GET('/me'))
}

export type UseMeOptions = Omit<
  UseQueryOptions<Me, ProblemError, Me, typeof meQueryKey>,
  'queryKey' | 'queryFn'
> & {
  client?: Client<paths>
}

/**
 * Hook de ejemplo basado en TanStack Query para consultar el perfil del usuario actual.
 */
export function useMe(options: UseMeOptions = {}): UseQueryResult<Me, ProblemError> {
  const { client = apiClient, ...queryOptions } = options

  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => fetchMe(client),
    ...queryOptions,
  })
}
