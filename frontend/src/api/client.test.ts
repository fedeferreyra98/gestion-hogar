import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server.ts'
import { createApiClient, unwrap } from './client.ts'
import { isProblem, isProblemError, ProblemError, toProblemError } from './errors.ts'
import {
  clearAccessToken,
  getAccessToken,
  resetTokenState,
  resolveAccessToken,
  setAccessToken,
  setTokenProvider,
} from './token.ts'
import type { Me, Problem } from './types.ts'

describe('token management', () => {
  beforeEach(() => {
    resetTokenState()
  })

  it('stores and retrieves access token in memory', () => {
    expect(getAccessToken()).toBeNull()
    setAccessToken('jwt-mock-token')
    expect(getAccessToken()).toBe('jwt-mock-token')
    clearAccessToken()
    expect(getAccessToken()).toBeNull()
  })

  it('supports custom async token provider', async () => {
    setTokenProvider(async () => 'dynamic-jwt-token')
    const token = await resolveAccessToken()
    expect(token).toBe('dynamic-jwt-token')
  })
})

describe('errors & Problem details', () => {
  it('identifies RFC 7807 problem objects correctly', () => {
    const validProblem: Problem = {
      type: 'about:blank',
      title: 'Validation failed',
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'Invalid payload',
      errors: [{ field: 'name', message: 'required' }],
    }
    expect(isProblem(validProblem)).toBe(true)
    expect(isProblem({ foo: 'bar' })).toBe(false)
    expect(isProblem(null)).toBe(false)
    expect(isProblem('string')).toBe(false)
  })

  it('creates ProblemError with field errors mapping', () => {
    const problem: Problem = {
      type: 'about:blank',
      title: 'Validation failed',
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'Check fields',
      errors: [
        { field: 'email', message: 'must be a valid email' },
        { field: 'password', message: 'too short' },
      ],
    }
    const err = new ProblemError(problem)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ProblemError)
    expect(isProblemError(err)).toBe(true)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.status).toBe(400)
    expect(err.message).toBe('Check fields')
    expect(err.getFieldErrors()).toEqual({
      email: 'must be a valid email',
      password: 'too short',
    })
  })

  it('normalizes fallback errors with toProblemError', () => {
    const fallback = toProblemError(
      new Error('Network disconnected'),
      new Response(null, { status: 503, statusText: 'Service Unavailable' }),
    )
    expect(fallback.status).toBe(503)
    expect(fallback.message).toBe('Network disconnected')
    expect(fallback.code).toBe('BUSINESS_RULE')
  })
})

describe('apiClient & auth middleware', () => {
  beforeEach(() => {
    resetTokenState()
  })

  it('attaches Bearer token to request when present', async () => {
    let capturedAuthHeader: string | null = null

    server.use(
      http.get('*/api/v1/me', ({ request }) => {
        capturedAuthHeader = request.headers.get('Authorization')
        const mockMe: Me = {
          member: {
            id: '11111111-1111-1111-1111-111111111111',
            displayName: 'Owner Dev',
            email: 'owner@hogar.local',
            role: 'OWNER',
            active: true,
          },
          household: {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Hogar Principal',
            baseCurrency: 'ARS',
            timezone: 'America/Argentina/Buenos_Aires',
            expiryWarningDays: 3,
            sharePurchasesByDefault: true,
          },
        }
        return HttpResponse.json(mockMe)
      }),
    )

    const client = createApiClient({ baseUrl: '/api/v1' })
    setAccessToken('mock-access-token-123')

    const result = await unwrap(client.GET('/me'))

    expect(capturedAuthHeader).toBe('Bearer mock-access-token-123')
    expect(result.member.email).toBe('owner@hogar.local')
  })

  it('does not send Authorization header when token is null', async () => {
    let capturedAuthHeader: string | null = null

    server.use(
      http.get('*/api/v1/me', ({ request }) => {
        capturedAuthHeader = request.headers.get('Authorization')
        const mockMe: Me = {
          member: {
            id: '11111111-1111-1111-1111-111111111111',
            displayName: 'Owner Dev',
            email: 'owner@hogar.local',
            role: 'OWNER',
            active: true,
          },
          household: {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Hogar Principal',
            baseCurrency: 'ARS',
            timezone: 'America/Argentina/Buenos_Aires',
            expiryWarningDays: 3,
            sharePurchasesByDefault: true,
          },
        }
        return HttpResponse.json(mockMe)
      }),
    )

    const client = createApiClient({ baseUrl: '/api/v1' })
    clearAccessToken()

    await unwrap(client.GET('/me'))
    expect(capturedAuthHeader).toBeNull()
  })

  it('does not overwrite existing Authorization header if explicitly set', async () => {
    let capturedAuthHeader: string | null = null

    server.use(
      http.get('*/api/v1/me', ({ request }) => {
        capturedAuthHeader = request.headers.get('Authorization')
        const mockMe: Me = {
          member: {
            id: '11111111-1111-1111-1111-111111111111',
            displayName: 'Owner Dev',
            email: 'owner@hogar.local',
            role: 'OWNER',
            active: true,
          },
          household: {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Hogar Principal',
            baseCurrency: 'ARS',
            timezone: 'America/Argentina/Buenos_Aires',
            expiryWarningDays: 3,
            sharePurchasesByDefault: true,
          },
        }
        return HttpResponse.json(mockMe)
      }),
    )

    const client = createApiClient({ baseUrl: '/api/v1' })
    setAccessToken('default-token')

    await unwrap(
      client.GET('/me', {
        headers: {
          Authorization: 'Bearer mock-override-token',
        },
      }),
    )

    expect(capturedAuthHeader).toBe('Bearer mock-override-token')
  })

  it('unwraps Problem errors on HTTP 400 validation error', async () => {
    const problemPayload: Problem = {
      type: 'about:blank',
      title: 'Validation failed',
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'Uno o más campos son inválidos',
      errors: [{ field: 'name', message: 'must not be blank' }],
    }

    server.use(
      http.post('*/api/v1/categories', () => {
        return HttpResponse.json(problemPayload, {
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' },
        })
      }),
    )

    const client = createApiClient({ baseUrl: '/api/v1' })

    await expect(
      unwrap(
        client.POST('/categories', {
          body: { name: '' },
        }),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expect(isProblemError(err)).toBe(true)
      const pe = err as ProblemError
      expect(pe.status).toBe(400)
      expect(pe.code).toBe('VALIDATION_ERROR')
      expect(pe.detail).toBe('Uno o más campos son inválidos')
      expect(pe.getFieldErrors()).toEqual({ name: 'must not be blank' })
      return true
    })
  })

  it('unwraps Problem error on 401 UNAUTHORIZED', async () => {
    const problemPayload: Problem = {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Token expired',
    }

    server.use(
      http.get('*/api/v1/me', () => {
        return HttpResponse.json(problemPayload, {
          status: 401,
          headers: { 'Content-Type': 'application/problem+json' },
        })
      }),
    )

    const client = createApiClient({ baseUrl: '/api/v1' })

    await expect(unwrap(client.GET('/me'))).rejects.toSatisfy((err: unknown) => {
      expect(isProblemError(err)).toBe(true)
      const pe = err as ProblemError
      expect(pe.status).toBe(401)
      expect(pe.code).toBe('UNAUTHORIZED')
      return true
    })
  })
})
