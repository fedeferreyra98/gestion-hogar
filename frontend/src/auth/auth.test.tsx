import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { getApiClient, resetApiClient, unwrap } from '@/api/client'
import { getAccessToken } from '@/api/token'
import { LoginPage } from '@/pages/LoginPage'
import { emptyPageHandlers } from '@/test/pageHandlers'
import { server } from '@/test/server'
import { AuthProvider } from './AuthProvider'
import { RequireAuth } from './RequireAuth'
import {
  applyTokens,
  getSessionState,
  logout,
  REFRESH_TOKEN_KEY,
  refreshSession,
  resetSession,
} from './session'

const API = 'http://localhost/api/v1'
const tokens = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `mock-refresh-${n}`,
  expiresInSeconds: 900,
})

function renderAt(path: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetApiClient()
  server.use(...emptyPageHandlers)
})
afterEach(() => resetSession())

describe('rutas protegidas', () => {
  it('redirige a /login sin sesión', async () => {
    renderAt('/gastos')
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('restaura la sesión con el refresh token guardado', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'mock-refresh-0')
    server.use(
      http.post(`${API}/auth/refresh`, async ({ request }) => {
        expect(await request.json()).toEqual({ refreshToken: 'mock-refresh-0' })
        return HttpResponse.json(tokens(1))
      }),
    )
    renderAt('/gastos')
    expect(await screen.findByRole('heading', { name: 'Gastos' })).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-1')
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('mock-refresh-1')
  })
})

describe('login', () => {
  it('inicia sesión, guarda tokens y vuelve a la ruta pedida', async () => {
    server.use(
      http.post(`${API}/auth/login`, async ({ request }) => {
        expect(await request.json()).toEqual({
          email: 'ana@example.com',
          password: 'mock-password-123',
        })
        return HttpResponse.json(tokens(1))
      }),
    )
    renderAt('/stock')
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mock-password-123')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-1')
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('mock-refresh-1')
  })

  it('muestra error con credenciales inválidas', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' },
          { status: 401 },
        ),
      ),
    )
    renderAt('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala-clave')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos.')
    expect(getSessionState().status).toBe('unauthenticated')
  })
})

describe('registro de hogar', () => {
  it('crea el hogar y entra a la app', async () => {
    server.use(
      http.post(`${API}/auth/register-owner`, async ({ request }) => {
        expect(await request.json()).toEqual({
          householdName: 'Casa Demo',
          displayName: 'Ana Demo',
          email: 'ana@example.com',
          password: 'mock-password-123',
        })
        return HttpResponse.json(tokens(1), { status: 201 })
      }),
    )
    renderAt('/registro')
    await userEvent.type(await screen.findByLabelText('Nombre del hogar'), 'Casa Demo')
    await userEvent.type(screen.getByLabelText('Tu nombre'), 'Ana Demo')
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mock-password-123')
    await userEvent.click(screen.getByRole('button', { name: 'Crear hogar' }))
    expect(await screen.findByRole('heading', { name: 'Listas' })).toBeInTheDocument()
  })

  it('avisa si ya existe un hogar (409)', async () => {
    server.use(
      http.post(`${API}/auth/register-owner`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, code: 'CONFLICT' },
          { status: 409 },
        ),
      ),
    )
    renderAt('/registro')
    await userEvent.type(await screen.findByLabelText('Nombre del hogar'), 'Casa Demo')
    await userEvent.type(screen.getByLabelText('Tu nombre'), 'Ana Demo')
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mock-password-123')
    await userEvent.click(screen.getByRole('button', { name: 'Crear hogar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un hogar registrado')
  })
})

describe('logout', () => {
  it('revoca el refresh token, limpia y vuelve a /login', async () => {
    let revoked: unknown
    server.use(
      http.post(`${API}/auth/logout`, async ({ request }) => {
        revoked = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    applyTokens(tokens(1))
    renderAt('/listas')
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(revoked).toEqual({ refreshToken: 'mock-refresh-1' })
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(screen.queryByText(/expiró/)).not.toBeInTheDocument()
  })
})

describe('refresh automático ante 401', () => {
  function Me() {
    const { data } = useQuery({
      queryKey: ['me'],
      queryFn: () => unwrap(getApiClient().GET('/me')),
    })
    return <p>{data ? `hola ${data.member.displayName}` : 'cargando'}</p>
  }
  const me = { member: { displayName: 'Ana Demo' } }

  it('refresca el token y vuelve a consultar', async () => {
    applyTokens(tokens(1))
    server.use(
      http.get(`${API}/me`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer access-2'
          ? HttpResponse.json(me)
          : HttpResponse.json(
              { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' },
              { status: 401 },
            ),
      ),
      http.post(`${API}/auth/refresh`, () => HttpResponse.json(tokens(2))),
    )
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider>
          <Me />
        </AuthProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('hola Ana Demo')).toBeInTheDocument()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('mock-refresh-2')
  })

  it('redirige a /login avisando que la sesión expiró si el refresh falla', async () => {
    applyTokens(tokens(1))
    server.use(
      http.get(`${API}/me`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' },
          { status: 401 },
        ),
      ),
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' },
          { status: 401 },
        ),
      ),
    )
    function Page() {
      useQuery({ queryKey: ['me'], queryFn: () => unwrap(getApiClient().GET('/me')) })
      return <h1>Listas</h1>
    }
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route index element={<Page />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Tu sesión expiró')
    await waitFor(() => expect(getAccessToken()).toBeNull())
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
  })
})

const problem = (status: number) => ({
  type: 'about:blank',
  title: 'Error',
  status,
  code: status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
})

describe('bootstrap con fallo transitorio', () => {
  it.each([
    ['red', () => HttpResponse.error()],
    ['5xx', () => HttpResponse.json(problem(503), { status: 503 })],
  ])('pasa a /login (sin "Cargando…" eterno) ante fallo de %s', async (_name, resolver) => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'mock-refresh-0')
    server.use(http.post(`${API}/auth/refresh`, resolver))
    renderAt('/gastos')
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(screen.queryByText(/expiró/)).not.toBeInTheDocument()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('mock-refresh-0')
  })
})

describe('logout con access token vencido', () => {
  it('refresca antes y revoca el refresh token nuevo', async () => {
    const logoutBodies: unknown[] = []
    let refreshCalls = 0
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshCalls++
        return HttpResponse.json(tokens(2))
      }),
      http.post(`${API}/auth/logout`, async ({ request }) => {
        if (request.headers.get('Authorization') !== 'Bearer access-2') {
          return HttpResponse.json(problem(401), { status: 401 })
        }
        logoutBodies.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    applyTokens(tokens(1))
    renderAt('/listas')
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(refreshCalls).toBe(1)
    expect(logoutBodies).toEqual([{ refreshToken: 'mock-refresh-2' }])
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(getSessionState().expired).toBe(false)
  })

  it('no reautentica si hay un refresh en vuelo al cerrar sesión', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.post(`${API}/auth/refresh`, async () => {
        await gate
        return HttpResponse.json(tokens(2))
      }),
      http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    )
    applyTokens(tokens(1))
    const refreshing = refreshSession()
    const loggingOut = logout()
    release()
    await Promise.all([refreshing, loggingOut])
    expect(getSessionState().status).toBe('unauthenticated')
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
  })
})

describe('refresh single-flight', () => {
  it('llamadas concurrentes comparten una sola request', async () => {
    let calls = 0
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        calls++
        return HttpResponse.json(tokens(2))
      }),
    )
    applyTokens(tokens(1))
    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()])
    expect(results).toEqual([true, true, true])
    expect(calls).toBe(1)
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('mock-refresh-2')
  })

  it('si otra pestaña rotó el token, reintenta con el nuevo en vez de desloguear', async () => {
    const seen: string[] = []
    server.use(
      http.post(`${API}/auth/refresh`, async ({ request }) => {
        const { refreshToken } = (await request.json()) as { refreshToken: string }
        seen.push(refreshToken)
        if (refreshToken === 'mock-refresh-1') {
          localStorage.setItem(REFRESH_TOKEN_KEY, 'mock-refresh-other-tab') // otra pestaña rotó
          return HttpResponse.json(problem(401), { status: 401 })
        }
        return HttpResponse.json(tokens(3))
      }),
    )
    applyTokens(tokens(1))
    expect(await refreshSession()).toBe(true)
    expect(seen).toEqual(['mock-refresh-1', 'mock-refresh-other-tab'])
    expect(getSessionState().status).toBe('authenticated')
  })
})

describe('redirect conserva query string', () => {
  it('vuelve a la ruta con ?query tras el login', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(tokens(1))))
    function Where() {
      const l = useLocation()
      return <p>{`en ${l.pathname}${l.search}`}</p>
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/gastos?mes=2026-10']}>
            <Routes>
              <Route path="login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route path="gastos" element={<Where />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mock-password-123')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('en /gastos?mes=2026-10')).toBeInTheDocument()
  })
})
