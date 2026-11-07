import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { ShoppingList, ShoppingListItem, Suggestion } from '@/api/types'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { server } from '@/test/server'

const API = 'http://localhost/api/v1'
const LIST_ID = '22222222-2222-4222-8222-222222222222'
const LECHE_ID = '11111111-1111-4111-8111-111111111111'
const PAN_ID = '44444444-4444-4444-8444-444444444444'

const suggestions: Suggestion[] = [
  { product: { id: LECHE_ID, name: 'Leche' }, reason: 'OUT_OF_STOCK', defaultUnit: 'L' },
  {
    product: { id: PAN_ID, name: 'Pan' },
    reason: 'EXPIRING',
    defaultUnit: 'UNIT',
    detail: '2026-11-09',
  },
  {
    product: { id: 'p3', name: 'Yogur' },
    reason: 'EXPIRED',
    defaultUnit: 'KG',
    detail: '2026-11-01',
  },
]

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: LIST_ID,
    name: 'Compra semanal',
    status: 'OPEN',
    createdBy: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-01-01T10:00:00Z',
    items: [],
    ...overrides,
  }
}

function problem(status: number, code: string) {
  return { type: 'about:blank', title: code, status, code, detail: code }
}

function renderDetail() {
  applyTokens({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresInSeconds: 900,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/listas/${LIST_ID}`]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => resetApiClient())
afterEach(() => resetSession())

describe('SuggestionsPanel', () => {
  it('muestra el motivo en texto, con fecha es-AR, y agrega con unidad por defecto', async () => {
    let added = false
    let addBody: unknown
    const lecheItem: ShoppingListItem = {
      id: 'i1',
      product: { id: LECHE_ID, name: 'Leche' },
      quantity: '1.000',
      unit: 'L',
      checked: false,
    }
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(makeList({ items: added ? [lecheItem] : [] })),
      ),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () =>
        HttpResponse.json(added ? suggestions.slice(1) : suggestions),
      ),
      http.post(`${API}/shopping-lists/${LIST_ID}/items`, async ({ request }) => {
        addBody = await request.json()
        added = true
        return HttpResponse.json(
          {
            id: 'i1',
            product: { id: LECHE_ID, name: 'Leche' },
            quantity: '1.000',
            unit: 'L',
            checked: false,
          },
          { status: 201 },
        )
      }),
    )
    const user = userEvent.setup()
    renderDetail()

    const panel = await screen.findByRole('region', { name: 'Te puede faltar' })
    const list = await within(panel).findByRole('list', { name: 'Sugerencias' })
    expect(within(list).getByText('Sin stock')).toBeInTheDocument()
    expect(within(list).getByText('Vence el 09/11/2026')).toBeInTheDocument()
    expect(within(list).getByText('Vencido el 01/11/2026')).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: 'Agregar Leche' }))

    await waitFor(() =>
      expect(
        within(panel).queryByRole('button', { name: 'Agregar Leche' }),
      ).not.toBeInTheDocument(),
    )
    expect(addBody).toEqual({ productId: LECHE_ID, quantity: '1', unit: 'L' })
    // CA: la sugerencia entra a la lista real y sale del panel.
    const items = await screen.findByRole('list', { name: 'Ítems de la lista' })
    expect(within(items).getByRole('checkbox', { name: /Leche/ })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Agregar Pan' })).toBeInTheDocument()
    expect(await screen.findByText('Agregamos Leche a la lista.')).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Te puede faltar' })).toHaveFocus()
  })

  it('doble clic en Agregar envía una sola alta', async () => {
    let posts = 0
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () =>
        HttpResponse.json(suggestions.slice(0, 1)),
      ),
      http.post(`${API}/shopping-lists/${LIST_ID}/items`, async () => {
        posts += 1
        await delay(50)
        return HttpResponse.json(
          {
            id: 'i1',
            product: { id: LECHE_ID, name: 'Leche' },
            quantity: '1.000',
            unit: 'L',
            checked: false,
          },
          { status: 201 },
        )
      }),
    )
    renderDetail()

    const button = await screen.findByRole('button', { name: 'Agregar Leche' })
    // Dos clics en el mismo tick (sin re-render entre ambos): solo la guarda síncrona los frena.
    act(() => {
      button.click()
      button.click()
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Agregar Leche' })).not.toBeInTheDocument(),
    )
    expect(posts).toBe(1)
  })

  it('si la alta falla, avisa con role=alert y deja la sugerencia para reintentar', async () => {
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () =>
        HttpResponse.json(suggestions.slice(0, 1)),
      ),
      http.post(`${API}/shopping-lists/${LIST_ID}/items`, () =>
        HttpResponse.json(problem(500, 'INTERNAL_ERROR'), { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Agregar Leche' }))

    expect(await screen.findByText('No pudimos agregar Leche.')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Agregar Leche' })).toBeEnabled()
  })

  it('LIST_NOT_OPEN al agregar: el aviso sobrevive al desmontaje del panel y la lista pasa a solo lectura', async () => {
    let rejected = false
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(makeList({ status: rejected ? 'COMPLETED' : 'OPEN' })),
      ),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () =>
        HttpResponse.json(suggestions.slice(0, 1)),
      ),
      http.post(`${API}/shopping-lists/${LIST_ID}/items`, () => {
        rejected = true
        return HttpResponse.json(problem(422, 'LIST_NOT_OPEN'), { status: 422 })
      }),
    )
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Agregar Leche' }))

    expect(
      await screen.findByText('La lista ya no está abierta, no se puede modificar.'),
    ).toHaveAttribute('role', 'alert')
    expect(await screen.findByRole('note')).toHaveTextContent('solo lectura')
    expect(screen.queryByRole('region', { name: 'Te puede faltar' })).not.toBeInTheDocument()
  })

  it('muestra 5 sugerencias y el resto se expande con un botón accesible', async () => {
    const many: Suggestion[] = Array.from({ length: 8 }, (_, i) => ({
      product: { id: `p-${i}`, name: `Producto ${i + 1}` },
      reason: 'OUT_OF_STOCK',
      defaultUnit: 'UNIT',
    }))
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () => HttpResponse.json(many)),
    )
    const user = userEvent.setup()
    renderDetail()

    const list = await screen.findByRole('list', { name: 'Sugerencias' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    const toggle = screen.getByRole('button', { name: 'Ver las 8 sugerencias' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(within(list).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Ver menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('error al cargar: alerta con Reintentar (no se muestra como vacío) y se recupera', async () => {
    let fail = true
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () =>
        fail
          ? HttpResponse.json(problem(500, 'INTERNAL_ERROR'), { status: 500 })
          : HttpResponse.json(suggestions.slice(0, 1)),
      ),
    )
    const user = userEvent.setup()
    renderDetail()

    expect(await screen.findByText('No pudimos cargar las sugerencias.')).toHaveAttribute(
      'role',
      'alert',
    )
    expect(screen.queryByText(/no hay sugerencias/i)).not.toBeInTheDocument()
    // El resto de la pantalla sigue montada.
    expect(screen.getByRole('heading', { name: 'Compra semanal' })).toBeInTheDocument()

    fail = false
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'Agregar Leche' })).toBeInTheDocument()
  })

  it('un refetch fallido con datos previos conserva la lista y avisa con Reintentar', async () => {
    let calls = 0
    const withItem = makeList({
      items: [
        {
          id: 'i1',
          product: { id: PAN_ID, name: 'Pan' },
          quantity: '1.000',
          unit: 'UNIT',
          checked: false,
        },
      ],
    })
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(withItem)),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () => {
        calls += 1
        return calls === 2
          ? HttpResponse.json(problem(500, 'INTERNAL_ERROR'), { status: 500 })
          : HttpResponse.json(suggestions.slice(0, 1))
      }),
      http.patch(`${API}/shopping-lists/${LIST_ID}/items/i1`, () =>
        HttpResponse.json({ ...withItem.items[0], checked: true }),
      ),
    )
    const user = userEvent.setup()
    renderDetail()
    await screen.findByRole('button', { name: 'Agregar Leche' })

    // Tildar un ítem revalida las listas (incluidas las sugerencias): ese refetch falla.
    await user.click(await screen.findByRole('checkbox', { name: /Pan/ }))
    const alert = await screen.findByText('No pudimos actualizar las sugerencias.')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Agregar Leche' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Compra semanal' })).toBeInTheDocument()

    const retry = within(screen.getByRole('region', { name: 'Te puede faltar' })).getByRole(
      'button',
      {
        name: 'Reintentar',
      },
    )
    await user.click(retry)
    await waitFor(() =>
      expect(screen.queryByText('No pudimos actualizar las sugerencias.')).not.toBeInTheDocument(),
    )
  })

  it('estado vacío y estado de carga', async () => {
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, async () => {
        await delay(30)
        return HttpResponse.json([])
      }),
    )
    renderDetail()

    expect(await screen.findByText('Cargando sugerencias…')).toHaveAttribute('role', 'status')
    expect(await screen.findByText(/Por ahora no hay sugerencias/)).toBeInTheDocument()
  })

  it('no se muestra (ni se pide) en listas que no están OPEN', async () => {
    let requested = false
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(makeList({ status: 'ARCHIVED' })),
      ),
      http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () => {
        requested = true
        return HttpResponse.json(suggestions)
      }),
    )
    renderDetail()

    expect(await screen.findByRole('note')).toHaveTextContent('solo lectura')
    expect(screen.queryByRole('region', { name: 'Te puede faltar' })).not.toBeInTheDocument()
    expect(requested).toBe(false)
  })
})
