import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { Product, StockAlerts, StockItem } from '@/api/types'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { server } from '@/test/server'
import { compareDecimal, formatDecimal } from './decimal'

const API = 'http://localhost/api/v1'

function item(over: Partial<StockItem> & Pick<StockItem, 'id' | 'expiryStatus'>): StockItem {
  return {
    product: { id: 'p-' + over.id, name: 'Producto ' + over.id },
    quantity: '3',
    initialQuantity: '3',
    unit: 'UNIT',
    expiryDate: null,
    location: null,
    status: 'ACTIVE',
    addedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const EXPIRED = item({
  id: 'a',
  expiryStatus: 'EXPIRED',
  expiryDate: '2026-01-02',
  product: { id: 'p1', name: 'Yogur' },
})
const SOON = item({
  id: 'b',
  expiryStatus: 'EXPIRING_SOON',
  expiryDate: '2026-11-09',
  quantity: '0.500',
  unit: 'L',
  product: { id: 'p2', name: 'Leche' },
})
const OK = item({ id: 'c', expiryStatus: 'OK', expiryDate: '2027-01-01', location: 'Heladera' })
const NONE = item({ id: 'd', expiryStatus: 'NO_EXPIRY', product: { id: 'p4', name: 'Arroz' } })

const page = (content: StockItem[]) => ({
  content,
  page: 0,
  size: 100,
  totalElements: content.length,
  totalPages: 1,
})

function mockList(content: StockItem[], alerts: StockAlerts = { expired: [], expiringSoon: [] }) {
  server.use(
    http.get(`${API}/stock`, () => HttpResponse.json(page(content))),
    http.get(`${API}/stock/alerts`, () => HttpResponse.json(alerts)),
  )
}

function renderStock() {
  applyTokens({ accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresInSeconds: 900 })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/stock']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => resetApiClient())
afterEach(() => resetSession())

describe('decimal helpers', () => {
  it('compares and formats without floats', () => {
    expect(compareDecimal('0.500', '1')).toBe(-1)
    expect(compareDecimal('1.0', '1')).toBe(0)
    expect(compareDecimal('10', '9.99')).toBe(1)
    expect(formatDecimal('0.500')).toBe('0,5')
    expect(formatDecimal('3.000')).toBe('3')
  })
})

describe('StockPage', () => {
  it('agrupa por vencimiento con badges de texto y muestra el banner de alertas', async () => {
    mockList([EXPIRED, SOON, OK, NONE], { expired: [EXPIRED], expiringSoon: [SOON] })
    renderStock()

    expect(await screen.findByRole('heading', { name: /Vencidos \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Por vencer \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Vigentes \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Sin vencimiento \(1\)/ })).toBeInTheDocument()

    const group = screen.getByRole('region', { name: /Vencidos/ })
    expect(within(group).getByText('Vencido')).toBeInTheDocument()
    expect(within(group).getByText(/Vence 02\/01\/2026/)).toBeInTheDocument()

    const banner = await screen.findByRole('status', { name: 'Alertas de vencimiento' })
    expect(banner).toHaveTextContent('1 lote vencido: Yogur')
    expect(banner).toHaveTextContent('1 lote por vencer: Leche')
  })

  it('muestra el estado vacío', async () => {
    mockList([])
    renderStock()
    expect(await screen.findByText(/Todavía no hay stock/)).toBeInTheDocument()
  })

  it('consume 1 con un solo toque, y no más de lo que queda', async () => {
    mockList([EXPIRED, SOON])
    const bodies: Record<string, unknown> = {}
    server.use(
      http.post(`${API}/stock/:id/consume`, async ({ request, params }) => {
        bodies[params.id as string] = await request.json()
        return HttpResponse.json(EXPIRED)
      }),
    )
    const user = userEvent.setup()
    renderStock()

    await user.click(await screen.findByRole('button', { name: 'Consumir 1 u de Yogur' }))
    await user.click(screen.getByRole('button', { name: 'Consumir 1 L de Leche' }))
    await waitFor(() => expect(Object.keys(bodies)).toHaveLength(2))
    expect(bodies.a).toEqual({ quantity: '1' })
    expect(bodies.b).toEqual({ quantity: '0.500' })
  })

  it('consume todo el lote con un toque', async () => {
    mockList([EXPIRED])
    let body: unknown
    server.use(
      http.post(`${API}/stock/:id/consume`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(EXPIRED)
      }),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Consumir todo Yogur' }))
    await waitFor(() => expect(body).toEqual({ quantity: '3' }))
  })

  it('muestra el error 409 de lote no activo y refresca la lista', async () => {
    let lists = 0
    server.use(
      http.get(`${API}/stock`, () => {
        lists++
        return HttpResponse.json(page([EXPIRED]))
      }),
      http.get(`${API}/stock/alerts`, () => HttpResponse.json({ expired: [], expiringSoon: [] })),
      http.post(`${API}/stock/:id/consume`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, code: 'CONFLICT' },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Consumir todo Yogur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no está activo/)
    await waitFor(() => expect(lists).toBeGreaterThan(1))
  })

  it('muestra INSUFFICIENT_STOCK (422)', async () => {
    mockList([EXPIRED])
    server.use(
      http.post(`${API}/stock/:id/consume`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'x', status: 422, code: 'INSUFFICIENT_STOCK' },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Consumir todo Yogur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No hay stock suficiente/)
  })

  it('descarta con confirmación', async () => {
    mockList([EXPIRED])
    let discarded = 0
    server.use(
      http.post(`${API}/stock/:id/discard`, () => {
        discarded++
        return HttpResponse.json(EXPIRED)
      }),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Descartar Yogur' }))
    expect(discarded).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Descartar Yogur' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar descarte de Yogur' }))
    await waitFor(() => expect(discarded).toBe(1))
  })

  it('da de alta stock manual con ProductPicker', async () => {
    mockList([])
    const leche: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Leche entera',
      categoryId: null,
      defaultUnit: 'L',
      defaultShelfLifeDays: 7,
      archived: false,
    }
    server.use(
      http.get(`${API}/products`, () =>
        HttpResponse.json({ content: [leche], page: 0, size: 10, totalElements: 1, totalPages: 1 }),
      ),
    )
    let body: unknown
    server.use(
      http.post(`${API}/stock`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(SOON, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderStock()

    await user.click(await screen.findByRole('button', { name: 'Agregar stock' }))
    const form = screen.getByRole('form', { name: 'Agregar stock' })

    // Without product: validation error
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Elegí un producto.')

    await user.click(within(form).getByRole('combobox', { name: 'Producto' }))
    await user.click(await screen.findByRole('option', { name: /Leche entera/ }))
    await user.clear(within(form).getByLabelText('Cantidad'))
    await user.type(within(form).getByLabelText('Cantidad'), '2,5')
    await user.type(within(form).getByLabelText(/Vencimiento/), '2026-12-01')
    await user.type(within(form).getByLabelText(/Ubicación/), 'Heladera')
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(body).toEqual({
        productId: leche.id,
        quantity: '2.5',
        unit: 'L',
        expiryDate: '2026-12-01',
        location: 'Heladera',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Agregar stock' })).not.toBeInTheDocument(),
    )
  })
})
