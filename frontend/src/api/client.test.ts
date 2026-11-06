import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server.ts'
import { createApiClient, unwrap, unwrapVoid } from './client.ts'
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

  it('falls back to in-memory token when provider returns null', async () => {
    setAccessToken('memory-token')
    setTokenProvider(async () => null)
    expect(await resolveAccessToken()).toBe('memory-token')
  })

  it('prefers provider token over in-memory token', async () => {
    setAccessToken('memory-token')
    setTokenProvider(() => 'provider-token')
    expect(await resolveAccessToken()).toBe('provider-token')
  })

  it('resetTokenState clears both memory token and provider', async () => {
    setAccessToken('memory-token')
    setTokenProvider(() => 'provider-token')
    resetTokenState()
    expect(getAccessToken()).toBeNull()
    expect(await resolveAccessToken()).toBeNull()
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
    expect(fallback.code).toBe('INTERNAL_ERROR')
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

describe('unwrap robustness', () => {
  beforeEach(() => {
    resetTokenState()
  })

  it('wraps network failures (fetch TypeError) in ProblemError with status 0', async () => {
    server.use(http.get('*/api/v1/me', () => HttpResponse.error()))
    const client = createApiClient({ baseUrl: '/api/v1' })

    await expect(unwrap(client.GET('/me'))).rejects.toSatisfy((err: unknown) => {
      expect(isProblemError(err)).toBe(true)
      const pe = err as ProblemError
      expect(pe.status).toBe(0)
      expect(pe.code).toBe('NETWORK_ERROR')
      return true
    })
  })

  it('wraps a throwing token provider in ProblemError', async () => {
    const client = createApiClient({
      baseUrl: '/api/v1',
      getToken: async () => {
        throw new Error('token boom')
      },
    })

    await expect(unwrap(client.GET('/me'))).rejects.toSatisfy((err: unknown) => {
      expect(isProblemError(err)).toBe(true)
      expect((err as ProblemError).code).toBe('NETWORK_ERROR')
      expect((err as ProblemError).detail).toBe('token boom')
      return true
    })
  })

  it('re-throws AbortError untouched when the caller aborts', async () => {
    const client = createApiClient({
      baseUrl: '/api/v1',
      fetch: async () => {
        throw new DOMException('The operation was aborted.', 'AbortError')
      },
    })

    await expect(unwrap(client.GET('/me'))).rejects.toSatisfy((err: unknown) => {
      expect(isProblemError(err)).toBe(false)
      expect((err as Error).name).toBe('AbortError')
      return true
    })
  })

  it.each([502, 503])('maps HTML %i to INTERNAL_ERROR, not BUSINESS_RULE', async (status) => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.text('<html><body>Bad gateway</body></html>', {
          status,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    )
    const client = createApiClient({ baseUrl: '/api/v1' })

    await expect(unwrap(client.GET('/me'))).rejects.toSatisfy((err: unknown) => {
      expect(isProblemError(err)).toBe(true)
      const pe = err as ProblemError
      expect(pe.status).toBe(status)
      expect(pe.code).toBe('INTERNAL_ERROR')
      return true
    })
  })

  it('maps 429 and 405 to INTERNAL_ERROR while 422 stays BUSINESS_RULE', () => {
    expect(toProblemError(undefined, new Response(null, { status: 429 })).code).toBe(
      'INTERNAL_ERROR',
    )
    expect(toProblemError(undefined, new Response(null, { status: 405 })).code).toBe(
      'INTERNAL_ERROR',
    )
    expect(toProblemError(undefined, new Response(null, { status: 422 })).code).toBe(
      'BUSINESS_RULE',
    )
  })

  it('unwrapVoid resolves undefined on 204', async () => {
    server.use(http.get('*/api/v1/me', () => new HttpResponse(null, { status: 204 })))
    const client = createApiClient({ baseUrl: '/api/v1' })

    const result: void = await unwrapVoid(client.GET('/me'))
    expect(result).toBeUndefined()
  })

  it('unwrap rejects with EMPTY_RESPONSE when a body was expected but 204 arrived', async () => {
    server.use(http.get('*/api/v1/me', () => new HttpResponse(null, { status: 204 })))
    const client = createApiClient({ baseUrl: '/api/v1' })

    await expect(unwrap(client.GET('/me'))).rejects.toSatisfy((err: unknown) => {
      expect(isProblemError(err)).toBe(true)
      expect((err as ProblemError).code).toBe('EMPTY_RESPONSE')
      return true
    })
  })

  it('unwrapVoid still throws ProblemError on HTTP failure', async () => {
    server.use(http.get('*/api/v1/me', () => new HttpResponse(null, { status: 503 })))
    const client = createApiClient({ baseUrl: '/api/v1' })
    await expect(unwrapVoid(client.GET('/me'))).rejects.toBeInstanceOf(ProblemError)
  })

  describe('onUnauthorized hook', () => {
    const unauthorized = () =>
      HttpResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' },
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
      )

    it('is called on 401 when the request carried Authorization, error still propagates', async () => {
      server.use(http.get('*/api/v1/me', unauthorized))
      const onUnauthorized = vi.fn()
      const client = createApiClient({ baseUrl: '/api/v1', onUnauthorized })
      setAccessToken('expired-token')

      await expect(unwrap(client.GET('/me'))).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      expect(onUnauthorized).toHaveBeenCalledTimes(1)
      expect(onUnauthorized.mock.calls[0]?.[0].status).toBe(401)
    })

    it('is not called on 401 from /auth/login', async () => {
      server.use(http.post('*/api/v1/auth/login', unauthorized))
      const onUnauthorized = vi.fn()
      const client = createApiClient({ baseUrl: '/api/v1', onUnauthorized })
      setAccessToken('some-token')

      await expect(
        unwrap(client.POST('/auth/login', { body: { email: 'a@b.local', password: 'x' } })),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      expect(onUnauthorized).not.toHaveBeenCalled()
    })

    it('does nothing without a hook and still throws ProblemError', async () => {
      server.use(http.get('*/api/v1/me', unauthorized))
      const client = createApiClient({ baseUrl: '/api/v1' })
      setAccessToken('expired-token')

      await expect(unwrap(client.GET('/me'))).rejects.toBeInstanceOf(ProblemError)
    })
  })
})
