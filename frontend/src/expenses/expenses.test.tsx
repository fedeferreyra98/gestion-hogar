import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { Expense, ExpensePage } from '@/api/hooks/useExpenses'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { server } from '@/test/server'

const API = 'http://localhost/api/v1'
const ME_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-000000000002'
const CAT_ID = '00000000-0000-4000-8000-0000000000c1'

const MANUAL: Expense = {
  id: '10000000-0000-4000-8000-000000000001',
  description: 'Verdulería',
  amount: { amountMinor: 150050, currency: 'ARS' },
  expenseDate: '2026-03-10',
  categoryId: CAT_ID,
  paidBy: ME_ID,
  source: 'MANUAL',
  shared: false,
  createdAt: '2026-03-10T12:00:00Z',
}
const PURCHASE: Expense = {
  ...MANUAL,
  id: '10000000-0000-4000-8000-000000000002',
  description: 'Compra supermercado',
  amount: { amountMinor: 2500000, currency: 'ARS' },
  categoryId: null,
  paidBy: OTHER_ID,
  source: 'PURCHASE',
}

function page(content: Expense[], extra: Partial<ExpensePage> = {}): ExpensePage {
  return {
    content,
    page: 0,
    size: 20,
    totalElements: content.length,
    totalPages: content.length ? 1 : 0,
    totalFiltered: [
      { amountMinor: content.reduce((a, e) => a + e.amount.amountMinor, 0), currency: 'ARS' },
    ],
    ...extra,
  }
}

function useBaseHandlers() {
  server.use(
    http.get(`${API}/me`, () =>
      HttpResponse.json({
        member: {
          id: ME_ID,
          email: 'ana@example.test',
          displayName: 'Ana',
          role: 'OWNER',
          active: true,
        },
        household: {
          id: '00000000-0000-4000-8000-0000000000aa',
          name: 'Casa',
          baseCurrency: 'ARS',
          timezone: 'America/Argentina/Buenos_Aires',
          expiryWarningDays: 3,
          sharePurchasesByDefault: false,
        },
      }),
    ),
    http.get(`${API}/members`, () =>
      HttpResponse.json([
        { id: ME_ID, email: 'ana@example.test', displayName: 'Ana', role: 'OWNER', active: true },
        {
          id: OTHER_ID,
          email: 'beto@example.test',
          displayName: 'Beto',
          role: 'MEMBER',
          active: true,
        },
      ]),
    ),
    http.get(`${API}/categories`, () => HttpResponse.json([{ id: CAT_ID, name: 'Verdulería' }])),
  )
}

let currentUrl = ''
function LocationProbe() {
  const loc = useLocation()
  useEffect(() => {
    currentUrl = loc.pathname + loc.search
  }, [loc])
  return null
}

function renderAt(path: string) {
  applyTokens({ accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresInSeconds: 900 })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetApiClient()
  useBaseHandlers()
})
afterEach(() => resetSession())

describe('Gastos: histórico', () => {
  it('lista gastos con total filtrado por moneda y origen en texto', async () => {
    server.use(
      http.get(`${API}/expenses`, () =>
        HttpResponse.json(
          page([MANUAL, PURCHASE], {
            totalFiltered: [
              { amountMinor: 2650050, currency: 'ARS' },
              { amountMinor: 1000, currency: 'USD' },
            ],
          }),
        ),
      ),
    )
    renderAt('/gastos')

    const list = await screen.findByRole('list', { name: 'Gastos' })
    expect(list).toHaveTextContent('Verdulería')
    expect(list).toHaveTextContent('ARS 1.500,50')
    expect(list).toHaveTextContent('10/03/2026')
    expect(list).toHaveTextContent('Compra')
    expect(list).toHaveTextContent('Manual')
    const total = screen.getByRole('region', { name: 'Total filtrado' })
    expect(total).toHaveTextContent('ARS 26.500,50')
    expect(total).toHaveTextContent('USD 10,00')
  })

  it('refleja filtros en la URL y los envía combinados a la API', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/expenses`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json(page([MANUAL]))
      }),
    )
    const user = userEvent.setup()
    renderAt('/gastos')
    await screen.findByRole('list', { name: 'Gastos' })

    await user.selectOptions(screen.getByLabelText('Categoría'), CAT_ID)
    await user.selectOptions(screen.getByLabelText('Origen'), 'MANUAL')
    await user.type(screen.getByLabelText('Buscar en la descripción'), 'verd')

    await waitFor(() => expect(currentUrl).toContain('q=verd'))
    expect(currentUrl).toContain(`categoryId=${CAT_ID}`)
    expect(currentUrl).toContain('source=MANUAL')
    await waitFor(() => {
      const last = seen.at(-1)!
      expect(last.get('categoryId')).toBe(CAT_ID)
      expect(last.get('source')).toBe('MANUAL')
      expect(last.get('q')).toBe('verd')
    })

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(currentUrl).toBe('/gastos'))
  })

  it('inicializa los filtros desde la URL', async () => {
    let query: URLSearchParams | undefined
    server.use(
      http.get(`${API}/expenses`, ({ request }) => {
        query = new URL(request.url).searchParams
        return HttpResponse.json(page([]))
      }),
    )
    renderAt(`/gastos?from=2026-03-01&to=2026-03-31&paidBy=${OTHER_ID}&page=1`)
    expect(
      await screen.findByText('No hay gastos que coincidan con los filtros.'),
    ).toBeInTheDocument()
    expect(query?.get('from')).toBe('2026-03-01')
    expect(query?.get('to')).toBe('2026-03-31')
    expect(query?.get('paidBy')).toBe(OTHER_ID)
    expect(query?.get('page')).toBe('0')
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-03-01')
  })

  it('pagina por páginas y guarda la página en la URL', async () => {
    const pages: string[] = []
    server.use(
      http.get(`${API}/expenses`, ({ request }) => {
        const p = new URL(request.url).searchParams.get('page') ?? '0'
        pages.push(p)
        return HttpResponse.json(
          page([p === '0' ? MANUAL : PURCHASE], {
            page: Number(p),
            totalPages: 2,
            totalElements: 2,
          }),
        )
      }),
    )
    const user = userEvent.setup()
    renderAt('/gastos')
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument()
    expect(currentUrl).toContain('page=2')
    expect(pages).toContain('1')
    expect(await screen.findByText('Compra supermercado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  })

  it('muestra error con reintento', async () => {
    server.use(
      http.get(`${API}/expenses`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500, code: 'INTERNAL_ERROR' },
          { status: 500 },
        ),
      ),
    )
    renderAt('/gastos')
    expect(await screen.findByText('No pudimos cargar los gastos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('Gastos: alta, edición y detalle', () => {
  it('crea un gasto manual convirtiendo "1.500,50" a unidades menores', async () => {
    let body: unknown
    server.use(
      http.get(`${API}/expenses`, () => HttpResponse.json(page([]))),
      http.post(`${API}/expenses`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ...MANUAL, id: 'new' }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderAt('/gastos/nuevo')

    await user.type(await screen.findByLabelText('Descripción'), '  Feria ')
    await user.type(screen.getByLabelText(/Monto/), '1.500,50')
    await user.selectOptions(screen.getByLabelText('Categoría'), CAT_ID)
    await user.click(screen.getByRole('button', { name: 'Guardar gasto' }))

    await waitFor(() => expect(currentUrl).toBe('/gastos'))
    expect(body).toMatchObject({
      description: 'Feria',
      amount: { amountMinor: 150050, currency: 'ARS' },
      categoryId: CAT_ID,
      paidBy: ME_ID,
    })
  })

  it('valida descripción y monto antes de enviar', async () => {
    const user = userEvent.setup()
    renderAt('/gastos/nuevo')
    await user.type(await screen.findByLabelText(/Monto/), 'abc')
    await user.click(screen.getByRole('button', { name: 'Guardar gasto' }))
    expect(await screen.findByText('Ingresá una descripción.')).toBeInTheDocument()
    expect(screen.getByText(/Ingresá un monto válido/)).toBeInTheDocument()
    expect(screen.getByLabelText('Descripción')).toHaveAttribute('aria-invalid', 'true')
  })

  it('edita un gasto manual', async () => {
    let body: unknown
    server.use(
      http.get(`${API}/expenses/${MANUAL.id}`, () => HttpResponse.json(MANUAL)),
      http.get(`${API}/expenses`, () => HttpResponse.json(page([]))),
      http.put(`${API}/expenses/${MANUAL.id}`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(MANUAL)
      }),
    )
    const user = userEvent.setup()
    renderAt(`/gastos/${MANUAL.id}`)

    const amount = await screen.findByLabelText(/Monto/)
    expect(amount).toHaveValue('1500,50')
    await user.clear(amount)
    await user.type(amount, '2000')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(currentUrl).toBe('/gastos'))
    expect(body).toMatchObject({ amount: { amountMinor: 200000, currency: 'ARS' } })
  })

  it('elimina un gasto manual con confirmación y muestra 409 si falla', async () => {
    let deletes = 0
    server.use(
      http.get(`${API}/expenses/${MANUAL.id}`, () => HttpResponse.json(MANUAL)),
      http.get(`${API}/expenses`, () => HttpResponse.json(page([]))),
      http.delete(`${API}/expenses/${MANUAL.id}`, () => {
        deletes += 1
        if (deletes === 1)
          return HttpResponse.json(
            { type: 'about:blank', title: 'Conflict', status: 409, code: 'CONFLICT' },
            { status: 409 },
          )
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/gastos/${MANUAL.id}`)

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se puede modificar/)

    await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))
    await waitFor(() => expect(currentUrl).toBe('/gastos'))
    expect(deletes).toBe(2)
  })

  it('muestra el detalle de una compra en solo lectura', async () => {
    server.use(http.get(`${API}/expenses/${PURCHASE.id}`, () => HttpResponse.json(PURCHASE)))
    renderAt(`/gastos/${PURCHASE.id}`)

    expect(await screen.findByRole('heading', { name: 'Detalle de compra' })).toBeInTheDocument()
    expect(screen.getByText(/solo lectura/)).toBeInTheDocument()
    expect(screen.getByText('ARS 25.000,00')).toBeInTheDocument()
    expect(screen.getByText('Beto')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Eliminar|Guardar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('informa cuando el gasto no existe', async () => {
    server.use(
      http.get(`${API}/expenses/${MANUAL.id}`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not found', status: 404, code: 'NOT_FOUND' },
          { status: 404 },
        ),
      ),
    )
    renderAt(`/gastos/${MANUAL.id}`)
    expect(await screen.findByText('El gasto no existe o fue eliminado.')).toBeInTheDocument()
  })
})
