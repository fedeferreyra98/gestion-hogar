import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/server.ts'
import { isProblemError, type ProblemError } from '../errors.ts'
import type { Me, Problem } from '../types.ts'
import { fetchMe, meQueryKey, useMe } from './useMe.ts'

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useMe hook', () => {
  it('exposes meQueryKey', () => {
    expect(meQueryKey).toEqual(['me'])
  })

  it('fetches authenticated user successfully', async () => {
    const mockMe: Me = {
      member: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        displayName: 'Usuario Prueba',
        email: 'usuario@hogar.local',
        role: 'OWNER',
        active: true,
      },
      household: {
        id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        name: 'Hogar Test',
        baseCurrency: 'ARS',
        timezone: 'America/Argentina/Buenos_Aires',
        expiryWarningDays: 5,
        sharePurchasesByDefault: false,
      },
    }

    server.use(
      http.get('*/api/v1/me', () => {
        return HttpResponse.json(mockMe)
      }),
    )

    const { result } = renderHook(() => useMe(), {
      wrapper: createTestWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(mockMe)
    expect(result.current.data?.member.email).toBe('usuario@hogar.local')
    expect(result.current.data?.member.role).toBe('OWNER')
  })

  it('handles Problem error when unauthenticated (401)', async () => {
    const problem: Problem = {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'No autenticado',
    }

    server.use(
      http.get('*/api/v1/me', () => {
        return HttpResponse.json(problem, {
          status: 401,
          headers: { 'Content-Type': 'application/problem+json' },
        })
      }),
    )

    const { result } = renderHook(() => useMe(), {
      wrapper: createTestWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    const err = result.current.error as ProblemError
    expect(isProblemError(err)).toBe(true)
    expect(err.status).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.detail).toBe('No autenticado')
  })

  it('allows fetchMe to be called directly', async () => {
    const mockMe: Me = {
      member: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        displayName: 'Usuario Directo',
        email: 'directo@hogar.local',
        role: 'MEMBER',
        active: true,
      },
      household: {
        id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        name: 'Hogar Directo',
        baseCurrency: 'ARS',
        timezone: 'America/Argentina/Buenos_Aires',
        expiryWarningDays: 5,
        sharePurchasesByDefault: false,
      },
    }

    server.use(
      http.get('*/api/v1/me', () => {
        return HttpResponse.json(mockMe)
      }),
    )

    const data = await fetchMe()
    expect(data.member.displayName).toBe('Usuario Directo')
    expect(data.member.role).toBe('MEMBER')
  })
})
