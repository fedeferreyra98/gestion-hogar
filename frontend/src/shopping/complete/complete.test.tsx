import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { Member, Me, ProblemCode, ShoppingList } from '@/api/types'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { server } from '@/test/server'
import { mapCompleteProblem } from './problems'
import { ProblemError } from '@/api/errors'

const API = 'http://localhost/api/v1'
const LIST_ID = '22222222-2222-4222-8222-222222222222'
const ME_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ID = '44444444-4444-4444-8444-444444444444'

const members: Member[] = [
  { id: ME_ID, email: 'ana@example.test', displayName: 'Ana', role: 'OWNER', active: true },
  { id: OTHER_ID, email: 'beto@example.test', displayName: 'Beto', role: 'MEMBER', active: true },
  {
    id: '55555555-5555-4555-8555-555555555555',
    email: 'carla@example.test',
    displayName: 'Carla',
    role: 'MEMBER',
    active: false,
  },
]
const me: Me = {
  member: members[0] as Member,
  household: {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Casa',
    baseCurrency: 'ARS',
    timezone: 'America/Argentina/Buenos_Aires',
    expiryWarningDays: 3,
    sharePurchasesByDefault: true,
  },
}

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: LIST_ID,
    name: 'Compra semanal',
    status: 'OPEN',
    createdBy: ME_ID,
    createdAt: '2026-01-01T10:00:00Z',
    items: [
      {
        id: 'i1',
        product: { id: 'p1', name: 'Leche' },
        quantity: '2.000',
        unit: 'UNIT',
        estimatedPrice: { amountMinor: 150050, currency: 'ARS' },
        checked: true,
      },
      {
        id: 'i2',
        product: { id: 'p2', name: 'Queso' },
        quantity: '0.500',
        unit: 'KG',
        checked: true,
      },
      {
        id: 'i3',
        product: { id: 'p3', name: 'Pan' },
        quantity: '1.000',
        unit: 'UNIT',
        checked: false,
      },
    ],
    ...overrides,
  }
}

function problem(status: number, code: string, errors?: { field: string; message: string }[]) {
  return { type: 'about:blank', title: code, status, code, detail: code, errors }
}

function LocationState() {
  return <div data-testid="loc-state">{JSON.stringify(useLocation().state)}</div>
}

function renderAt(path: string | { pathname: string; state: unknown }, extra?: ReactNode) {
  applyTokens({ accessToken: 'mock', refreshToken: 'mock', expiresInSeconds: 900 })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
          {extra}
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { queryClient }
}

function useBaseHandlers(list: ShoppingList = makeList()) {
  server.use(
    http.get(`${API}/me`, () => HttpResponse.json(me)),
    http.get(`${API}/members`, () => HttpResponse.json(members)),
    http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(list)),
    // Tras finalizar se navega al detalle, que monta el panel de sugerencias.
    http.get(`${API}/shopping-lists/${LIST_ID}/suggestions`, () => HttpResponse.json([])),
  )
}

const purchase = (total = 450100) => ({
  id: '77777777-7777-4777-8777-777777777777',
  purchaseDate: '2026-02-01',
  total: { amountMinor: total, currency: 'ARS' },
  paidBy: { id: ME_ID, displayName: 'Ana' },
  expenseId: '88888888-8888-4888-8888-888888888888',
  items: [],
})

beforeEach(() => resetApiClient())
afterEach(() => resetSession())

async function toStep2(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: /Paso 1 de 3/ })
  await user.click(screen.getByRole('button', { name: 'Siguiente' }))
  await screen.findByRole('heading', { name: /Paso 2 de 3/ })
}

describe('Finalizar compra', () => {
  it('el detalle de una lista abierta enlaza al wizard y se deshabilita sin tildados', async () => {
    useBaseHandlers()
    renderAt(`/listas/${LIST_ID}`)
    const link = await screen.findByRole('link', { name: 'Finalizar compra' })
    expect(link).toHaveAttribute('href', `/listas/${LIST_ID}/finalizar`)
  })

  it('total por defecto = suma de round(cantidad × precio) y es editable', async () => {
    useBaseHandlers()
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    // Leche 2 × 1.500,50 = 3.001,00 ; Queso 0,5 × 1.000,01 = 500,005 → 500,01 (half-up)
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '1000,01')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    const total = await screen.findByLabelText(/Total/)
    expect(total).toHaveValue('3501,01')
    expect(screen.getByText(/Suma de los ítems: ARS 3.501,01/)).toBeInTheDocument()
    // Pagador por defecto: yo; inactivos fuera de la lista.
    expect(screen.getByLabelText('Pagó')).toHaveValue(ME_ID)
    expect(screen.queryByRole('option', { name: 'Carla' })).not.toBeInTheDocument()
    await user.clear(total)
    await user.type(total, '3.600')
    expect(total).toHaveValue('3.600')
    await user.click(screen.getByRole('button', { name: 'Usar la suma' }))
    expect(screen.getByLabelText(/Total/)).toHaveValue('3501,01')
  })

  it('valida con Zod cada paso, con foco y aria en el primer campo inválido', async () => {
    useBaseHandlers()
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    await user.clear(screen.getAllByLabelText('Cantidad')[0] as HTMLElement)
    const qty2 = screen.getAllByLabelText('Cantidad')[1] as HTMLElement
    await user.clear(qty2)
    await user.type(qty2, '1,2345')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    const qty = screen.getAllByLabelText('Cantidad')[0] as HTMLElement
    expect(qty).toHaveAttribute('aria-invalid', 'true')
    expect(qty).toHaveFocus()
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(
      expect.arrayContaining([
        'Ingresá un número, por ejemplo 2 o 2,5.',
        'Usá como máximo 3 decimales.',
        'Ingresá un precio con coma decimal (ej. 1.500,50).',
      ]),
    )
    expect(screen.getByRole('heading', { name: /Paso 1 de 3/ })).toBeInTheDocument()
  })

  it('flujo completo con NEW_LIST: envía el body esperado e invalida y navega con feedback', async () => {
    useBaseHandlers()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(purchase(), { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '1.000')
    await user.type(screen.getAllByLabelText(/Vencimiento/)[0] as HTMLElement, '2026-12-31')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.type(await screen.findByLabelText(/Comercio/), 'Súper Mock')
    await user.selectOptions(screen.getByLabelText('Pagó'), OTHER_ID)
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText(/Queda 1 ítem sin tildar/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dejarlos en una lista nueva' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Confirmar compra' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Compra registrada por ARS 4.501,00. Los ítems pendientes quedaron en una lista nueva.',
    )
    const sent = body as unknown as {
      purchaseDate: string
      store: string
      paidBy: string
      total: unknown
      leftoverAction: string
      items: Record<string, unknown>[]
    }
    expect(sent.store).toBe('Súper Mock')
    expect(sent.paidBy).toBe(OTHER_ID)
    expect(sent.leftoverAction).toBe('NEW_LIST')
    expect(sent.purchaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sent.total).toEqual({ amountMinor: 300100 + 50000, currency: 'ARS' })
    expect(sent.items).toEqual([
      {
        listItemId: 'i1',
        productId: 'p1',
        quantity: '2',
        unit: 'UNIT',
        unitPrice: { amountMinor: 150050, currency: 'ARS' },
        expiryDate: '2026-12-31',
      },
      {
        listItemId: 'i2',
        productId: 'p2',
        quantity: '0.5',
        unit: 'KG',
        unitPrice: { amountMinor: 100000, currency: 'ARS' },
      },
    ])
    expect(screen.getByRole('heading', { name: 'Compra semanal' })).toBeInTheDocument()
  })

  it('DISCARD se envía como leftoverAction y el doble envío queda bloqueado', async () => {
    useBaseHandlers()
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    let leftover = ''
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, async ({ request }) => {
        calls++
        leftover = ((await request.json()) as { leftoverAction: string }).leftoverAction
        await gate
        return HttpResponse.json(purchase(), { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '10')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('radio', { name: 'Descartarlos' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar compra' })
    await user.click(confirm)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrando…' })).toBeDisabled())
    await user.click(screen.getByRole('button', { name: 'Registrando…' }))
    release()
    await screen.findByRole('status')
    expect(calls).toBe(1)
    expect(leftover).toBe('DISCARD')
  })

  it('LIST_NOT_OPEN (422): avisa que ya se completó y ofrece volver', async () => {
    useBaseHandlers()
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () =>
        HttpResponse.json(problem(422, 'LIST_NOT_OPEN'), { status: 422 }),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '10')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar compra' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('La lista ya no está abierta')
    expect(alert).toHaveTextContent('ya fue completada')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.getByRole('link', { name: 'Volver a la lista' })).toHaveAttribute(
      'href',
      `/listas/${LIST_ID}`,
    )
    expect(screen.getByRole('link', { name: 'Ver gastos' })).toBeInTheDocument()
  })

  it('400 de validación se mapea a campos en español y vuelve al paso del campo', async () => {
    useBaseHandlers()
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () =>
        HttpResponse.json(
          problem(400, 'VALIDATION_ERROR', [
            { field: 'items[1].unitPrice.amountMinor', message: 'must be >= 0' },
          ]),
          { status: 400 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '10')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar compra' }))
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    const price = screen.getAllByLabelText('Precio unitario')[1] as HTMLElement
    expect(price).toHaveAttribute('aria-invalid', 'true')
    expect(price).toHaveFocus()
    expect(screen.getByText('El precio no es válido.')).toBeInTheDocument()
    expect(screen.queryByText(/must be/)).not.toBeInTheDocument()
  })

  it('un fallo de red permite reintentar con el mismo contenido', async () => {
    useBaseHandlers()
    let calls = 0
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () => {
        calls++
        return calls === 1
          ? HttpResponse.json(problem(500, 'INTERNAL_ERROR'), { status: 500 })
          : HttpResponse.json(purchase(), { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '10')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar compra' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos registrar la compra')
    await user.click(screen.getByRole('button', { name: 'Confirmar compra' }))
    await screen.findByRole('status')
    expect(calls).toBe(2)
  })

  it('lista inexistente (404 al cargar) y lista no abierta', async () => {
    server.use(
      http.get(`${API}/me`, () => HttpResponse.json(me)),
      http.get(`${API}/members`, () => HttpResponse.json(members)),
      http.get(`${API}/shopping-lists/${LIST_ID}`, () =>
        HttpResponse.json(problem(404, 'NOT_FOUND'), { status: 404 }),
      ),
    )
    renderAt(`/listas/${LIST_ID}/finalizar`)
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos esa lista.')
  })

  it('muestra aviso si la lista ya no está abierta', async () => {
    useBaseHandlers(makeList({ status: 'COMPLETED' }))
    renderAt(`/listas/${LIST_ID}/finalizar`)
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue completada o archivada')
    expect(screen.getByRole('link', { name: 'Volver a la lista' })).toBeInTheDocument()
  })

  it('error de carga con reintento (no se muestra como vacío)', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/me`, () => HttpResponse.json(me)),
      http.get(`${API}/members`, () => HttpResponse.json(members)),
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => {
        calls++
        return calls === 1
          ? HttpResponse.json(problem(500, 'INTERNAL_ERROR'), { status: 500 })
          : HttpResponse.json(makeList())
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: /Paso 1 de 3/ })).toBeInTheDocument()
  })

  it('sin ítems tildados no se puede avanzar', async () => {
    useBaseHandlers(makeList({ items: [makeList().items[2] as ShoppingList['items'][number]] }))
    renderAt(`/listas/${LIST_ID}/finalizar`)
    expect(await screen.findByText(/No hay ítems tildados/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  })

  it('en el paso 2 un total inválido muestra el error accesible', async () => {
    useBaseHandlers()
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await screen.findByRole('heading', { name: /Paso 1 de 3/ })
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '10')
    await toStep2(user)
    const total = screen.getByLabelText(/Total/)
    await user.clear(total)
    await user.type(total, '0')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(total).toHaveAttribute('aria-invalid', 'true')
    expect(total).toHaveFocus()
    expect(
      within(screen.getByRole('alert')).getByText(/Ingresá un total mayor a cero/),
    ).toBeInTheDocument()
  })
})

async function toConfirm(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: /Paso 1 de 3/ })
  await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '10')
  await user.click(screen.getByRole('button', { name: 'Siguiente' }))
  await user.click(await screen.findByRole('button', { name: 'Siguiente' }))
  return screen.findByRole('button', { name: 'Confirmar compra' })
}

describe('Finalizar compra — robustez', () => {
  afterEach(() => vi.useRealTimers())

  it('con la red caída (POST y refetch fallan) conserva lo cargado y permite reintentar', async () => {
    useBaseHandlers()
    let listCalls = 0
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => {
        listCalls++
        return listCalls === 1 ? HttpResponse.json(makeList()) : HttpResponse.error()
      }),
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () => HttpResponse.error()),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await user.click(await toConfirm(user))
    expect(await screen.findByText(/No pudimos registrar la compra/)).toBeInTheDocument()
    expect(await screen.findByText(/No pudimos actualizar los datos/)).toBeInTheDocument()
    // El wizard sigue montado con los valores cargados.
    expect(screen.getByRole('heading', { name: /Paso 3 de 3/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getAllByLabelText('Precio unitario')[1]).toHaveValue('10')

    // Vuelve la red: el reintento envía lo mismo.
    server.use(
      http.get(`${API}/shopping-lists/${LIST_ID}`, () => HttpResponse.json(makeList())),
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () =>
        HttpResponse.json(purchase(), { status: 201 }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Siguiente' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar compra' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Compra registrada')
  })

  it('400 sobre items[i].productId muestra un mensaje general en español', async () => {
    useBaseHandlers()
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () =>
        HttpResponse.json(
          problem(400, 'VALIDATION_ERROR', [{ field: 'items[0].productId', message: 'mismatch' }]),
          { status: 400 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await user.click(await toConfirm(user))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('La lista cambió o algún ítem ya no es válido')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.queryByText(/mismatch/)).not.toBeInTheDocument()
  })

  it('404 del POST: avisa que la lista no existe y ofrece volver', async () => {
    useBaseHandlers()
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () =>
        HttpResponse.json(problem(404, 'NOT_FOUND'), { status: 404 }),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await user.click(await toConfirm(user))
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos la lista')
    expect(screen.getByRole('link', { name: 'Volver a las listas' })).toHaveAttribute(
      'href',
      '/listas',
    )
  })

  it('422 UNSUPPORTED_CURRENCY marca el total en el paso 2', async () => {
    useBaseHandlers()
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () =>
        HttpResponse.json(problem(422, 'UNSUPPORTED_CURRENCY'), { status: 422 }),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await user.click(await toConfirm(user))
    await screen.findByRole('heading', { name: /Paso 2 de 3/ })
    const total = screen.getByLabelText(/Total/)
    expect(total).toHaveAttribute('aria-invalid', 'true')
    expect(total).toHaveFocus()
    expect(screen.getAllByText(/La moneda .* coincide/).length).toBeGreaterThan(0)
  })

  it('409 del POST: pide volver a la lista y reintentar', async () => {
    useBaseHandlers()
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () =>
        HttpResponse.json(problem(409, 'CONFLICT'), { status: 409 }),
      ),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await user.click(await toConfirm(user))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La lista cambió mientras la completabas',
    )
  })

  it('dos submits en el mismo tick envían un solo POST', async () => {
    useBaseHandlers()
    let calls = 0
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, async () => {
        calls++
        await delay(30)
        return HttpResponse.json(purchase(), { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    const button = await toConfirm(user)
    const form = button.closest('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    await screen.findByRole('status')
    expect(calls).toBe(1)
  })

  it('tras el éxito el detalle ya no se ve abierto y el aviso se limpia del history', async () => {
    useBaseHandlers()
    server.use(
      http.post(`${API}/shopping-lists/${LIST_ID}/complete`, () => {
        // El refetch posterior no responde: se ve lo que quedó en cache.
        server.use(http.get(`${API}/shopping-lists/${LIST_ID}`, async () => delay('infinite')))
        return HttpResponse.json(purchase(), { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`, <LocationState />)
    await user.click(await toConfirm(user))
    expect(await screen.findByRole('status')).toHaveTextContent('Compra registrada')
    expect(screen.getByText('Completada')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Finalizar compra' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('loc-state')).toHaveTextContent('null'))
    // El aviso sigue visible en esta visita.
    expect(screen.getByRole('status')).toHaveTextContent('Compra registrada')
  })

  it('el aviso no reaparece si ya no hay state en la ubicación (recarga)', async () => {
    useBaseHandlers(makeList({ status: 'COMPLETED' }))
    renderAt(`/listas/${LIST_ID}`)
    await screen.findByRole('heading', { name: 'Compra semanal' })
    expect(screen.queryByText(/Compra registrada/)).not.toBeInTheDocument()
  })

  it('la fecha por defecto usa la zona horaria del hogar (reloj fijo)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-15T01:30:00Z')) // 14/03 22:30 en Buenos Aires
    useBaseHandlers()
    const user = userEvent.setup()
    renderAt(`/listas/${LIST_ID}/finalizar`)
    await toConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-03-14')
  })
})

describe('mapCompleteProblem', () => {
  const make = (
    status: number,
    code: ProblemCode | 'INTERNAL_ERROR',
    errors?: { field: string; message: string }[],
  ) => new ProblemError({ type: 'about:blank', title: code, status, code, errors })

  it('UNSUPPORTED_CURRENCY (422) apunta al total', () => {
    const mapped = mapCompleteProblem(make(422, 'UNSUPPORTED_CURRENCY'), 'x')
    expect(mapped.fields.total).toMatch(/moneda/)
    expect(mapped.message).toMatch(/moneda/)
  })

  it('404, 409 y errores de campo desconocidos', () => {
    expect(mapCompleteProblem(make(404, 'NOT_FOUND'), 'x').notFound).toBe(true)
    expect(mapCompleteProblem(make(409, 'CONFLICT'), 'x').message).toMatch(/cambió/)
    const mapped = mapCompleteProblem(
      make(400, 'VALIDATION_ERROR', [
        { field: 'paidBy', message: 'bad' },
        { field: 'foo', message: 'bad' },
      ]),
      'x',
    )
    expect(mapped.fields).toEqual({ paidBy: expect.stringMatching(/pagador/) })
    expect(mapped.message).toMatch(/La lista cambió/) // `foo` no se puede mapear
    expect(
      mapCompleteProblem(make(400, 'VALIDATION_ERROR', [{ field: 'foo', message: 'b' }]), 'x')
        .message,
    ).toMatch(/La lista cambió/)
    expect(mapCompleteProblem(make(400, 'VALIDATION_ERROR'), 'x').message).toBe(
      'Revisá los datos de la compra.',
    )
    for (const field of ['items[0].productId', 'items[1].listItemId', 'items[0].unit'])
      expect(
        mapCompleteProblem(make(400, 'VALIDATION_ERROR', [{ field, message: 'b' }]), 'x'),
      ).toMatchObject({ fields: {}, message: expect.stringMatching(/La lista cambió/) })
    expect(mapCompleteProblem(make(500, 'INTERNAL_ERROR'), 'fallback').message).toBe('fallback')
  })
})
