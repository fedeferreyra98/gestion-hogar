import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.getByText(/Ingresá un monto mayor a cero/)).toBeInTheDocument()
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

const INACTIVE_ID = '00000000-0000-4000-8000-000000000003'
const problem = (status: number, code: string, errors?: { field: string; message: string }[]) =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Error', status, code, detail: 'Invalid payer', errors },
    { status },
  )

function withInactiveMember() {
  server.use(
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
        {
          id: INACTIVE_ID,
          email: 'carla@example.test',
          displayName: 'Carla',
          role: 'MEMBER',
          active: false,
        },
      ]),
    ),
  )
}

describe('Gastos: filtros y URL robustos', () => {
  it('con Desde > Hasta no consulta la API y muestra una única validación en español', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/expenses`, () => {
        calls += 1
        return HttpResponse.json(page([]))
      }),
    )
    renderAt('/gastos?from=2026-03-31&to=2026-03-01')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('no puede ser posterior')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Desde')).toHaveAttribute('aria-invalid', 'true')
    expect(calls).toBe(0)
  })

  it('descarta parámetros de URL inválidos y normaliza la URL', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/expenses`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json(page([MANUAL]))
      }),
    )
    renderAt('/gastos?source=foo&categoryId=abc&paidBy=1&from=2026-13-01&to=ayer&page=zz')

    await screen.findByRole('list', { name: 'Gastos' })
    expect(screen.queryByText('No pudimos cargar los gastos.')).not.toBeInTheDocument()
    await waitFor(() => expect(currentUrl).toBe('/gastos'))
    for (const params of seen) {
      for (const key of ['source', 'categoryId', 'paidBy', 'from', 'to'])
        expect(params.has(key)).toBe(false)
      expect(params.get('page')).toBe('0')
    }
    expect(screen.getByLabelText('Origen')).toHaveValue('')
    expect(screen.getByLabelText('Categoría')).toHaveValue('')
  })

  it('un id válido pero inexistente se refleja en el select como desconocido', async () => {
    server.use(http.get(`${API}/expenses`, () => HttpResponse.json(page([]))))
    renderAt(`/gastos?categoryId=${'00000000-0000-4000-8000-0000000000ff'}`)
    await screen.findByText('No hay gastos que coincidan con los filtros.')
    const select = screen.getByLabelText('Categoría') as HTMLSelectElement
    await waitFor(() =>
      expect(select.selectedOptions[0]?.textContent).toBe('Categoría desconocida'),
    )
  })

  it('con page fuera de rango salta a la última página válida', async () => {
    const pages: string[] = []
    server.use(
      http.get(`${API}/expenses`, ({ request }) => {
        const p = Number(new URL(request.url).searchParams.get('page') ?? '0')
        pages.push(String(p))
        return HttpResponse.json(
          p >= 3
            ? page([], { page: p, totalPages: 3, totalElements: 41 })
            : page([MANUAL], { page: p, totalPages: 3, totalElements: 41 }),
        )
      }),
    )
    renderAt('/gastos?page=99')

    expect(await screen.findByText('Página 3 de 3')).toBeInTheDocument()
    expect(screen.queryByText('Aún no hay gastos registrados.')).not.toBeInTheDocument()
    expect(currentUrl).toContain('page=3')
    expect(pages.at(-1)).toBe('2')
  })

  it('con page fuera de rango y sin resultados vuelve a la primera página', async () => {
    server.use(
      http.get(`${API}/expenses`, ({ request }) => {
        const p = Number(new URL(request.url).searchParams.get('page') ?? '0')
        return HttpResponse.json(page([], { page: p, totalPages: 0, totalElements: 0 }))
      }),
    )
    renderAt('/gastos?page=5')
    expect(await screen.findByText('Aún no hay gastos registrados.')).toBeInTheDocument()
    expect(currentUrl).toBe('/gastos')
  })

  it('el filtro de pagador incluye miembros inactivos marcados', async () => {
    withInactiveMember()
    server.use(http.get(`${API}/expenses`, () => HttpResponse.json(page([MANUAL]))))
    renderAt('/gastos')
    await screen.findByRole('list', { name: 'Gastos' })
    expect(
      await within(screen.getByLabelText('Pagó')).findByRole('option', {
        name: 'Carla (inactivo)',
      }),
    ).toBeInTheDocument()
  })

  it('la búsqueda usa debounce (timers falsos): una sola consulta tras la última tecla', async () => {
    const qs: (string | null)[] = []
    server.use(
      http.get(`${API}/expenses`, ({ request }) => {
        qs.push(new URL(request.url).searchParams.get('q'))
        return HttpResponse.json(page([MANUAL]))
      }),
    )
    renderAt('/gastos')
    await screen.findByRole('list', { name: 'Gastos' })
    const before = qs.length

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const input = screen.getByLabelText('Buscar en la descripción')
      for (const text of ['v', 've', 'ver', 'verd']) {
        fireEvent.change(input, { target: { value: text } })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100)
        })
      }
      expect(qs.length).toBe(before)
      expect(currentUrl).toBe('/gastos')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20)
        })
      }
      expect(currentUrl).toBe('/gastos?q=verd')
      expect(qs.slice(before)).toEqual(['verd'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('la caja de búsqueda se resincroniza cuando la URL cambia desde afuera', async () => {
    server.use(http.get(`${API}/expenses`, () => HttpResponse.json(page([MANUAL]))))
    const user = userEvent.setup()
    renderAt('/gastos?q=leche')
    const input = await screen.findByLabelText('Buscar en la descripción')
    expect(input).toHaveValue('leche')

    await user.click(screen.getAllByRole('link', { name: 'Gastos' })[0]!)
    await waitFor(() => expect(input).toHaveValue(''))
    expect(currentUrl).toBe('/gastos')
  })

  it('conserva filtros y página al volver desde el detalle', async () => {
    server.use(
      http.get(`${API}/expenses`, () => HttpResponse.json(page([MANUAL]))),
      http.get(`${API}/expenses/${MANUAL.id}`, () => HttpResponse.json(MANUAL)),
    )
    const user = userEvent.setup()
    renderAt('/gastos?source=MANUAL&q=verd')
    await user.click(await screen.findByRole('link', { name: /Verdulería/ }))
    await screen.findByRole('heading', { name: 'Editar gasto' })
    await user.click(screen.getByRole('link', { name: /Volver a gastos/ }))
    await waitFor(() => expect(currentUrl).toBe('/gastos?source=MANUAL&q=verd'))
  })
})

describe('Gastos: errores de formularios', () => {
  async function fillAndSubmitNew(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Descripción'), 'Feria')
    await user.type(screen.getByLabelText(/Monto/), '100')
    await user.click(screen.getByRole('button', { name: 'Guardar gasto' }))
  }

  it('400 con errors[]: traduce al español y mapea amount.amountMinor al campo Monto', async () => {
    server.use(
      http.post(`${API}/expenses`, () =>
        problem(400, 'VALIDATION_ERROR', [
          { field: 'amount.amountMinor', message: 'must be greater than 0' },
          { field: 'paidBy', message: 'must be an active member' },
        ]),
      ),
    )
    const user = userEvent.setup()
    renderAt('/gastos/nuevo')
    await fillAndSubmitNew(user)

    const amountError = await screen.findByText('El monto no es válido: debe ser mayor a cero.')
    expect(screen.getByLabelText(/Monto/)).toHaveAttribute('aria-describedby', amountError.id)
    expect(screen.getByText('Elegí un miembro activo del hogar como pagador.')).toBeInTheDocument()
    expect(screen.queryByText(/Invalid payer|must be/)).not.toBeInTheDocument()
  })

  it('400 sin campos mapeables muestra un mensaje general en español', async () => {
    server.use(http.post(`${API}/expenses`, () => problem(400, 'VALIDATION_ERROR')))
    const user = userEvent.setup()
    renderAt('/gastos/nuevo')
    await fillAndSubmitNew(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisá los datos del formulario.')
    expect(screen.queryByText(/Invalid payer/)).not.toBeInTheDocument()
  })

  it('422 UNSUPPORTED_CURRENCY se muestra en el campo Monto', async () => {
    server.use(http.post(`${API}/expenses`, () => problem(422, 'UNSUPPORTED_CURRENCY')))
    const user = userEvent.setup()
    renderAt('/gastos/nuevo')
    await fillAndSubmitNew(user)
    expect(await screen.findByText('La moneda no coincide con la del hogar.')).toBeInTheDocument()
  })

  it('409 en PUT informa en español y no navega', async () => {
    server.use(
      http.get(`${API}/expenses/${MANUAL.id}`, () => HttpResponse.json(MANUAL)),
      http.put(`${API}/expenses/${MANUAL.id}`, () => problem(409, 'CONFLICT')),
    )
    const user = userEvent.setup()
    renderAt(`/gastos/${MANUAL.id}`)
    await user.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se puede modificar/)
    expect(currentUrl).toBe(`/gastos/${MANUAL.id}`)
  })

  it('al editar conserva un pagador desactivado', async () => {
    withInactiveMember()
    let body: { paidBy?: string } = {}
    const inactivePayer = { ...MANUAL, paidBy: INACTIVE_ID }
    server.use(
      http.get(`${API}/expenses/${MANUAL.id}`, () => HttpResponse.json(inactivePayer)),
      http.get(`${API}/expenses`, () => HttpResponse.json(page([]))),
      http.put(`${API}/expenses/${MANUAL.id}`, async ({ request }) => {
        body = (await request.json()) as { paidBy?: string }
        return HttpResponse.json(inactivePayer)
      }),
    )
    const user = userEvent.setup()
    renderAt(`/gastos/${MANUAL.id}`)
    const select = (await screen.findByLabelText('Pagó')) as HTMLSelectElement
    expect(select.selectedOptions[0]?.textContent).toBe('Carla (inactivo)')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(currentUrl).toBe('/gastos'))
    expect(body.paidBy).toBe(INACTIVE_ID)
  })

  it('al borrar no refetchea el detalle ni muestra "no existe"', async () => {
    let detailGets = 0
    let deleted = false
    server.use(
      http.get(`${API}/expenses/${MANUAL.id}`, () => {
        detailGets += 1
        return deleted ? problem(404, 'NOT_FOUND') : HttpResponse.json(MANUAL)
      }),
      http.get(`${API}/expenses`, () => HttpResponse.json(page([]))),
      http.delete(`${API}/expenses/${MANUAL.id}`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderAt(`/gastos/${MANUAL.id}`)
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))
    await waitFor(() => expect(currentUrl).toBe('/gastos'))
    expect(screen.queryByText('El gasto no existe o fue eliminado.')).not.toBeInTheDocument()
    expect(detailGets).toBe(1)
  })

  it('la confirmación de borrado mueve el foco, cierra con Escape y lo devuelve', async () => {
    server.use(http.get(`${API}/expenses/${MANUAL.id}`, () => HttpResponse.json(MANUAL)))
    const user = userEvent.setup()
    renderAt(`/gastos/${MANUAL.id}`)
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    expect(screen.getByRole('button', { name: 'No eliminar' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toHaveFocus()
  })

  it('un monto con punto decimal se rechaza con ayuda y foco en el campo', async () => {
    const user = userEvent.setup()
    renderAt('/gastos/nuevo')
    await user.type(await screen.findByLabelText('Descripción'), 'Feria')
    await user.type(screen.getByLabelText(/Monto/), '12.50')
    await user.click(screen.getByRole('button', { name: 'Guardar gasto' }))
    expect(await screen.findByText(/con coma decimal/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Monto/)).toHaveFocus()
  })
})
