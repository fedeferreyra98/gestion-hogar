import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { applyTokens, resetSession } from './auth/session'
import { emptyPageHandlers } from './test/pageHandlers'
import { server } from './test/server'

function renderAt(path: string) {
  applyTokens({ accessToken: 'test-access', refreshToken: 'test-refresh', expiresInSeconds: 900 })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('app shell', () => {
  beforeEach(() => {
    server.use(...emptyPageHandlers)
  })
  afterEach(() => {
    // No es redundante con el cleanup() de setup.ts: este afterEach es del describe y corre
    // ANTES que los de nivel archivo (sequence.hooks solo ordena hooks del mismo nivel).
    // Desmontar antes de resetear la sesión evita updates fuera de act().
    cleanup()
    resetSession()
  })

  it('redirects / to Listas', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Listas' })).toBeInTheDocument()
  })

  it('navigates between sections', async () => {
    renderAt('/listas')
    await userEvent.click(screen.getAllByRole('link', { name: 'Gastos' })[0]!)
    expect(await screen.findByRole('heading', { name: 'Gastos' })).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('link', { name: 'Stock' })[0]!)
    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeInTheDocument()
  })
})

describe('msw + tanstack query', () => {
  it('fetches mocked data', async () => {
    server.use(http.get('*/api/ping', () => HttpResponse.json({ ok: true })))
    function Ping() {
      const { data } = useQuery({
        queryKey: ['ping'],
        queryFn: async () =>
          (await fetch('http://localhost/api/ping')).json() as Promise<{ ok: boolean }>,
      })
      return <p>{data ? 'ok' : 'cargando'}</p>
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Ping />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('ok')).toBeInTheDocument()
  })
})
