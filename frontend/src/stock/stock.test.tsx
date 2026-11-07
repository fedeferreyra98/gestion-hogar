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

  function mockConsume(bodies: unknown[]) {
    server.use(
      http.post(`${API}/stock/:id/consume`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(EXPIRED)
      }),
    )
  }

  it('consume 1 con un solo toque', async () => {
    mockList([EXPIRED])
    const bodies: unknown[] = []
    mockConsume(bodies)
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Consumir 1 u de Yogur' }))
    await waitFor(() => expect(bodies).toEqual([{ quantity: '1' }]))
  })

  it('−1 no consume más de lo que queda', async () => {
    mockList([SOON])
    const bodies: unknown[] = []
    mockConsume(bodies)
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Consumir 1 L de Leche' }))
    await waitFor(() => expect(bodies).toEqual([{ quantity: '0.500' }]))
  })

  it('deshabilita las acciones mientras hay una mutación en curso', async () => {
    mockList([EXPIRED, SOON])
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post(`${API}/stock/:id/consume`, async () => {
        await gate
        return HttpResponse.json(EXPIRED)
      }),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Consumir todo Yogur' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Consumir todo Leche' })).toBeDisabled(),
    )
    release()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Consumir todo Leche' })).toBeEnabled(),
    )
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
    // the batch is gone after the refresh: error is shown at page level, not lost

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

  it('muestra el error 404 de un lote inexistente al consumir', async () => {
    mockList([EXPIRED])
    server.use(
      http.post(`${API}/stock/:id/consume`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not found', status: 404, code: 'NOT_FOUND' },
          { status: 404 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Consumir todo Yogur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No encontramos ese lote/)
  })

  it('muestra el error al descartar un lote ya descartado (409)', async () => {
    mockList([EXPIRED])
    server.use(
      http.post(`${API}/stock/:id/discard`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, code: 'CONFLICT' },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Descartar Yogur' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar descarte de Yogur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no está activo/)
  })

  it('ofrece reintentar cuando falla la carga', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/stock`, () => {
        calls++
        return calls === 1
          ? HttpResponse.json(
              { type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR' },
              { status: 500 },
            )
          : HttpResponse.json(page([EXPIRED]))
      }),
      http.get(`${API}/stock/alerts`, () => HttpResponse.json({ expired: [], expiringSoon: [] })),
    )
    const user = userEvent.setup()
    renderStock()
    expect(await screen.findByText('No pudimos cargar el stock.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Yogur')).toBeInTheDocument()
  })

  it('maneja el foco del descarte con teclado', async () => {
    mockList([EXPIRED])
    server.use(http.post(`${API}/stock/:id/discard`, () => HttpResponse.json(EXPIRED)))
    const user = userEvent.setup()
    renderStock()
    const discardBtn = await screen.findByRole('button', { name: 'Descartar Yogur' })
    discardBtn.focus()
    await user.keyboard('{Enter}')
    // focus moves to the confirm button
    expect(screen.getByRole('button', { name: 'Confirmar descarte de Yogur' })).toHaveFocus()
    // cancel returns the focus to the button that opened the confirmation
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Descartar Yogur' })).toHaveFocus()
    // confirm moves focus to a stable target (the page title)
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { level: 1, name: 'Stock' })).toHaveFocus()
  })

  it('vuelve a la última página existente cuando la actual queda vacía', async () => {
    let consumed = false
    server.use(
      http.get(`${API}/stock`, ({ request }) => {
        const p = Number(new URL(request.url).searchParams.get('page') ?? 0)
        if (consumed) {
          // Only one page left; page 1 is out of range.
          return HttpResponse.json({
            content: p === 0 ? [EXPIRED] : [],
            page: p,
            size: 100,
            totalElements: 1,
            totalPages: 1,
          })
        }
        return HttpResponse.json({
          content: p === 0 ? [EXPIRED] : [SOON],
          page: p,
          size: 100,
          totalElements: 101,
          totalPages: 2,
        })
      }),
      http.get(`${API}/stock/alerts`, () => HttpResponse.json({ expired: [], expiringSoon: [] })),
      http.post(`${API}/stock/:id/consume`, () => {
        consumed = true
        return HttpResponse.json(SOON)
      }),
    )
    const user = userEvent.setup()
    renderStock()
    await user.click(await screen.findByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Consumir todo Leche' }))
    expect(await screen.findByText('Yogur')).toBeInTheDocument()
    expect(screen.queryByText(/Todavía no hay stock/)).not.toBeInTheDocument()
  })

  it('pagina y no muestra "no hay stock" si hay más páginas', async () => {
    server.use(
      http.get(`${API}/stock`, ({ request }) => {
        const p = Number(new URL(request.url).searchParams.get('page') ?? 0)
        return HttpResponse.json({
          content: p === 0 ? [EXPIRED] : [SOON],
          page: p,
          size: 100,
          totalElements: 101,
          totalPages: 2,
        })
      }),
      http.get(`${API}/stock/alerts`, () => HttpResponse.json({ expired: [], expiringSoon: [] })),
    )
    const user = userEvent.setup()
    renderStock()
    expect(await screen.findByText('Yogur')).toBeInTheDocument()
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('Leche')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument()
    expect(screen.queryByText(/Todavía no hay stock/)).not.toBeInTheDocument()
  })

  describe('alta manual: validación', () => {
    const leche: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Leche entera',
      categoryId: null,
      defaultUnit: 'L',
      defaultShelfLifeDays: 7,
      archived: false,
    }

    async function openFormWithProduct() {
      mockList([])
      server.use(
        http.get(`${API}/products`, () =>
          HttpResponse.json({
            content: [leche],
            page: 0,
            size: 10,
            totalElements: 1,
            totalPages: 1,
          }),
        ),
      )
      const user = userEvent.setup()
      renderStock()
      await user.click(await screen.findByRole('button', { name: 'Agregar stock' }))
      const form = screen.getByRole('form', { name: 'Agregar stock' })
      await user.click(within(form).getByRole('combobox', { name: 'Producto' }))
      await user.click(await screen.findByRole('option', { name: /Leche entera/ }))
      return { user, form }
    }

    it('valida cantidad (decimales, magnitud, cero) y fecha en el cliente, por campo', async () => {
      let posts = 0
      server.use(
        http.post(`${API}/stock`, () => {
          posts++
          return HttpResponse.json(SOON, { status: 201 })
        }),
      )
      const { user, form } = await openFormWithProduct()
      const qty = within(form).getByLabelText('Cantidad')
      const save = () => user.click(within(form).getByRole('button', { name: 'Guardar' }))

      await user.clear(qty)
      await user.type(qty, '0,2505')
      await save()
      expect(qty).toBeInvalid()
      expect(within(form).getByText('Usá como máximo 3 decimales.')).toBeInTheDocument()

      await user.clear(qty)
      await user.type(qty, '1000000000')
      await save()
      expect(within(form).getByText('La cantidad es demasiado grande.')).toBeInTheDocument()

      await user.clear(qty)
      await user.type(qty, '0')
      await save()
      expect(within(form).getByText('La cantidad debe ser mayor a cero.')).toBeInTheDocument()

      await user.clear(qty)
      await user.type(qty, '2')
      await user.type(within(form).getByLabelText(/Vencimiento/), '3000-01-01')
      await save()
      expect(within(form).getByText('El año debe estar entre 1900 y 2999.')).toBeInTheDocument()
      expect(posts).toBe(0)
    })

    it('mapea errores 400 del backend (errors[]) a los campos', async () => {
      server.use(
        http.post(`${API}/stock`, () =>
          HttpResponse.json(
            {
              type: 'about:blank',
              title: 'Bad Request',
              status: 400,
              code: 'VALIDATION_ERROR',
              errors: [{ field: 'expiryDate', message: 'must be between x and y' }],
            },
            { status: 400 },
          ),
        ),
      )
      const { user, form } = await openFormWithProduct()
      await user.click(within(form).getByRole('button', { name: 'Guardar' }))
      const msg = await within(form).findByText('La fecha de vencimiento no es válida.')
      expect(within(form).getByLabelText(/Vencimiento/)).toHaveAccessibleDescription(
        msg.textContent ?? '',
      )
    })

    it('informa si el producto ya no existe (404) y muestra error genérico en otros fallos', async () => {
      let status = 404
      server.use(
        http.post(`${API}/stock`, () =>
          HttpResponse.json(
            {
              type: 'about:blank',
              title: 'x',
              status,
              code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
            },
            { status },
          ),
        ),
      )
      const { user, form } = await openFormWithProduct()
      await user.click(within(form).getByRole('button', { name: 'Guardar' }))
      expect(
        await within(form).findByText('Ese producto ya no existe. Elegí otro.'),
      ).toBeInTheDocument()
      status = 500
      await user.click(within(form).getByRole('button', { name: 'Guardar' }))
      expect(
        await within(form).findByText('No pudimos agregar el stock. Intentá de nuevo.'),
      ).toBeInTheDocument()
    })

    it('tras guardar anuncia el éxito y devuelve el foco al botón', async () => {
      server.use(http.post(`${API}/stock`, () => HttpResponse.json(SOON, { status: 201 })))
      const { user, form } = await openFormWithProduct()
      await user.click(within(form).getByRole('button', { name: 'Guardar' }))
      expect(await screen.findByText('Agregamos Leche entera al stock.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Agregar stock' })).toHaveFocus()
    })
  })
})
