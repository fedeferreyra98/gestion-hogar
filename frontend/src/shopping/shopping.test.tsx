import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { ShoppingList, ShoppingListItem, ShoppingListSummary } from '@/api/types'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { server } from '@/test/server'

const API = 'http://localhost/api/v1'
const LIST_ID = '22222222-2222-4222-8222-222222222222'

function item(id: string, name: string, checked = false): ShoppingListItem {
  return {
    id,
    product: { id: `p-${id}`, name },
    quantity: '2.000',
    unit: 'UNIT',
    checked,
  }
}

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: LIST_ID,
    name: 'Compra semanal',
    status: 'OPEN',
    createdBy: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-01-01T10:00:00Z',
    items: [item('i1', 'Leche'), item('i2', 'Pan')],
    ...overrides,
  }
}

function problem(status: number, code: string) {
  return { type: 'about:blank', title: code, status, code, detail: code }
}

function renderAt(path: string) {
  applyTokens({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresInSeconds: 900,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => resetApiClient())
afterEach(() => {
  resetSession()
  vi.restoreAllMocks()
})

describe('ShoppingListsPage', () => {
  const summary: ShoppingListSummary = {
    id: LIST_ID,
    name: 'Compra semanal',
    status: 'OPEN',
    itemCount: 5,
    checkedCount: 2,
    createdAt: '2026-01-01T10:00:00Z',
  }

  it('muestra las listas con su contador y filtra por estado', async () => {
    const statuses: (string | null)[] = []
    server.use(
      http.get(`${API}/shopping-lists`, ({ request }) => {
        const status = new URL(request.url).searchParams.get('status')
        statuses.push(status)
        const content = status === 'OPEN' ? [summary] : []
        return HttpResponse.json({
          content,
          page: 0,
          size: 50,
          totalElements: content.length,
          totalPages: 1,
        })
      }),
    )
    const user = userEvent.setup()
    renderAt('/listas')

    const link = await screen.findByRole('link', { name: 'Compra semanal' })
    expect(link).toHaveAttribute('href', `/listas/${LIST_ID}`)
    expect(screen.getByText(/2 de 5 tildados/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Archivadas' }))
    expect(await screen.findByText('No hay listas archivadas.')).toBeInTheDocument()
    expect(statuses).toEqual(['OPEN', 'ARCHIVED'])
  })

  it('crea una lista y navega a su detalle', async () => {
    let body: unknown
    server.use(
      http.get(`${API}/shopping-lists`, () =>
        HttpResponse.json({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 }),
      ),
      http.post(`${API}/shopping-lists`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(makeList({ name: 'Asado', items: [] }), { status: 201 })
      }),
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(makeList({ name: 'Asado', items: [] })),
      ),
    )
    const user = userEvent.setup()
    renderAt('/listas')

    await user.type(await screen.findByLabelText('Nueva lista'), 'Asado')
    await user.click(screen.getByRole('button', { name: 'Crear lista' }))

    expect(await screen.findByRole('heading', { name: 'Asado' })).toBeInTheDocument()
    expect(body).toEqual({ name: 'Asado' })
  })

  it('archiva con confirmación', async () => {
    let archived = false
    server.use(
      http.get(`${API}/shopping-lists`, () =>
        HttpResponse.json({
          content: archived ? [] : [summary],
          page: 0,
          size: 50,
          totalElements: 1,
          totalPages: 1,
        }),
      ),
      http.patch(`${API}/shopping-lists/${LIST_ID}`, async ({ request }) => {
        expect(await request.json()).toEqual({ status: 'ARCHIVED' })
        archived = true
        return HttpResponse.json(makeList({ status: 'ARCHIVED' }))
      }),
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderAt('/listas')

    await user.click(await screen.findByRole('button', { name: 'Archivar Compra semanal' }))
    expect(await screen.findByText('No hay listas abiertas.')).toBeInTheDocument()
  })

  it('duplica una lista y navega a la copia', async () => {
    let duplicated = false
    server.use(
      http.get(`${API}/shopping-lists`, () =>
        HttpResponse.json({
          content: [summary],
          page: 0,
          size: 50,
          totalElements: 1,
          totalPages: 1,
        }),
      ),
      http.post(`${API}/shopping-lists/${LIST_ID}/duplicate`, () => {
        duplicated = true
        return HttpResponse.json(makeList({ id: 'copy', name: 'Compra semanal (copia)' }), {
          status: 201,
        })
      }),
      http.get(`${API}/shopping-lists/copy`, () =>
        HttpResponse.json(makeList({ id: 'copy', name: 'Compra semanal (copia)' })),
      ),
    )
    const user = userEvent.setup()
    renderAt('/listas')
    await user.click(await screen.findByRole('button', { name: 'Duplicar Compra semanal' }))
    expect(
      await screen.findByRole('heading', { name: 'Compra semanal (copia)' }),
    ).toBeInTheDocument()
    expect(duplicated).toBe(true)
  })
})

describe('ShoppingListDetailPage', () => {
  it('muestra ítems sin tildar primero y el contador', async () => {
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(
          makeList({ items: [item('i1', 'Leche', true), item('i2', 'Pan'), item('i3', 'Arroz')] }),
        ),
      ),
    )
    renderAt(`/listas/${LIST_ID}`)

    const list = await screen.findByRole('list', { name: 'Ítems de la lista' })
    const names = within(list)
      .getAllByRole('checkbox')
      .map((c) => c.getAttribute('id'))
    expect(names).toEqual(['item-i2', 'item-i3', 'item-i1'])
    expect(screen.getByText('1 de 3 tildados')).toBeInTheDocument()
  })

  it('tilda de forma optimista, antes de que responda el servidor', async () => {
    let patchBody: unknown
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.patch(`${API}/shopping-lists/${LIST_ID}/items/i1`, async ({ request }) => {
        patchBody = await request.json()
        await delay(300)
        return HttpResponse.json({ ...item('i1', 'Leche'), checked: true })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}`)

    const checkbox = await screen.findByRole('checkbox', { name: /Leche/ })
    await user.click(checkbox)

    // Inmediato: la request sigue en vuelo (300 ms) y la UI ya cambió.
    expect(screen.getByRole('checkbox', { name: /Leche/ })).toBeChecked()
    expect(screen.getByText('1 de 2 tildados')).toBeInTheDocument()
    await waitFor(() => expect(patchBody).toEqual({ checked: true }))
  })

  it('revierte el tildado y avisa si el servidor falla', async () => {
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.patch(`${API}/shopping-lists/${LIST_ID}/items/i1`, () =>
        HttpResponse.json(problem(500, 'INTERNAL_ERROR'), { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}`)

    await user.click(await screen.findByRole('checkbox', { name: /Leche/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos actualizar el ítem.')
    expect(screen.getByRole('checkbox', { name: /Leche/ })).not.toBeChecked()
    expect(screen.getByText('0 de 2 tildados')).toBeInTheDocument()
  })

  it('una lista archivada es de solo lectura', async () => {
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(makeList({ status: 'ARCHIVED' })),
      ),
    )
    renderAt(`/listas/${LIST_ID}`)

    expect(await screen.findByRole('note')).toHaveTextContent('solo lectura')
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).disabled)).toBe(
      true,
    )
    expect(screen.queryByRole('form', { name: 'Agregar producto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archivar lista' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Duplicar lista' })).toBeInTheDocument()
  })

  it('muestra un mensaje claro ante 422 LIST_NOT_OPEN al tildar', async () => {
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.patch(`${API}/shopping-lists/${LIST_ID}/items/i1`, () =>
        HttpResponse.json(problem(422, 'LIST_NOT_OPEN'), { status: 422 }),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}`)

    await user.click(await screen.findByRole('checkbox', { name: /Leche/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ya no está abierta')
    expect(screen.getByRole('checkbox', { name: /Leche/ })).not.toBeChecked()
  })

  it('agrega un ítem con el ProductPicker', async () => {
    let addBody: unknown
    let added = false
    const leche = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Leche entera',
      categoryId: null,
      defaultUnit: 'L',
      defaultShelfLifeDays: 7,
      archived: false,
    }
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(
          makeList({
            items: added ? [{ ...item('i9', 'Leche entera'), quantity: '3.000', unit: 'L' }] : [],
          }),
        ),
      ),
      http.get(`${API}/products`, () =>
        HttpResponse.json({
          content: [leche],
          page: 0,
          size: 10,
          totalElements: 1,
          totalPages: 1,
        }),
      ),
      http.post(`${API}/shopping-lists/${LIST_ID}/items`, async ({ request }) => {
        addBody = await request.json()
        added = true
        return HttpResponse.json(item('i9', 'Leche entera'), { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}`)

    await user.type(await screen.findByRole('combobox', { name: 'Producto' }), 'Lec')
    await user.click(await screen.findByRole('option', { name: /Leche entera/ }))
    expect(screen.getByLabelText('Unidad')).toHaveValue('L')
    await user.clear(screen.getByLabelText('Cantidad'))
    await user.type(screen.getByLabelText('Cantidad'), '3')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(await screen.findByRole('checkbox', { name: /Leche entera/ })).toBeInTheDocument()
    expect(addBody).toEqual({ productId: leche.id, quantity: '3', unit: 'L' })
  })

  it('valida producto y cantidad antes de agregar', async () => {
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(makeList({ items: [] })),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}`)

    await user.click(await screen.findByRole('button', { name: 'Agregar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Elegí un producto')
  })

  it('quita un ítem', async () => {
    let removed = false
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(makeList({ items: removed ? [item('i2', 'Pan')] : makeList().items })),
      ),
      http.delete(`${API}/shopping-lists/${LIST_ID}/items/i1`, () => {
        removed = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}`)

    await user.click(await screen.findByRole('button', { name: 'Quitar Leche' }))
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Leche/ })).not.toBeInTheDocument(),
    )
  })
})
