import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { PricePoint, SummaryRow } from '@/api/hooks/useReports'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { server } from '@/test/server'

const API = 'http://localhost/api/v1'
const ME_ID = '00000000-0000-4000-8000-000000000001'
const LECHE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Leche entera',
  categoryId: null,
  defaultUnit: 'L',
  defaultShelfLifeDays: 7,
  archived: false,
}

const row = (key: string, amountMinor: number, label = key, currency = 'ARS'): SummaryRow => ({
  key,
  label,
  total: { amountMinor, currency },
})

const MONTHS = [row('2026-01', 100000), row('2026-03', 250050), row('2026-03', 1000, '', 'USD')]
const CATEGORIES = [row('uncategorized', 300000, 'Sin categoría'), row('c1', 50050, 'Verdulería')]
const STORES = [row('coto', 200000, 'Coto'), row('', 50000, 'Sin comercio')]

type Rows = Record<string, SummaryRow[] | number>
const seenQueries: URLSearchParams[] = []

function useHandlers(rows: Rows = { month: MONTHS, category: CATEGORIES, store: STORES }) {
  seenQueries.length = 0
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
    http.get(`${API}/expenses/summary`, ({ request }) => {
      const params = new URL(request.url).searchParams
      seenQueries.push(params)
      const value = rows[params.get('groupBy') ?? '']
      if (typeof value === 'number') {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Error', status: value, code: 'INTERNAL_ERROR' },
          { status: value },
        )
      }
      return HttpResponse.json(value ?? [])
    }),
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

function renderAt(path: string, queryClient?: QueryClient) {
  applyTokens({ accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresInSeconds: 900 })
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
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
  useHandlers()
})
afterEach(() => resetSession())

describe('Reportes', () => {
  it('muestra el gasto mensual por moneda, rellena meses vacíos y usa tablas equivalentes', async () => {
    renderAt('/reportes')

    const monthly = await screen.findByRole('region', { name: 'Gasto mensual' })
    const arsTable = await within(monthly).findByRole('table', { name: 'Gasto mensual en ARS' })
    // enero, febrero (relleno con 0) y marzo
    expect(within(arsTable).getByRole('row', { name: /ene 2026/ })).toHaveTextContent(
      'ARS 1.000,00',
    )
    expect(within(arsTable).getByRole('row', { name: /feb 2026/ })).toHaveTextContent('ARS 0,00')
    expect(within(arsTable).getByRole('row', { name: /mar 2026/ })).toHaveTextContent(
      'ARS 2.500,50',
    )
    // un total POR MONEDA: no se mezclan
    expect(within(monthly).getByText('Total del período: ARS 3.500,50')).toBeInTheDocument()
    expect(within(monthly).getByText('Total del período: USD 10,00')).toBeInTheDocument()
    expect(
      within(monthly).getByRole('img', {
        name: /Gráfico de barras: gasto mensual en ARS, 3 meses/,
      }),
    ).toBeInTheDocument()
  })

  it('agrupa por categoría ("Sin categoría") y por comercio ("Sin comercio") con aviso', async () => {
    renderAt('/reportes')

    const categories = await screen.findByRole('region', { name: 'Gasto por categoría' })
    const catTable = await within(categories).findByRole('table')
    expect(within(catTable).getByRole('row', { name: /Sin categoría/ })).toHaveTextContent(
      'ARS 3.000,00',
    )
    expect(within(categories).getByText(/se cuenta en “Sin categoría”/)).toBeInTheDocument()

    const stores = await screen.findByRole('region', { name: 'Gasto por comercio' })
    const storeTable = await within(stores).findByRole('table')
    expect(within(storeTable).getByRole('row', { name: /Sin comercio/ })).toHaveTextContent(
      'ARS 500,00',
    )
    expect(within(stores).getByText(/gastos manuales no tienen comercio/)).toBeInTheDocument()
  })

  it('envía from/to al backend y los arrastra al histórico de gastos', async () => {
    renderAt('/reportes?from=2026-01-01&to=2026-03-31')

    await screen.findByRole('table', { name: 'Gasto mensual en ARS' })
    expect(seenQueries.length).toBe(3)
    for (const q of seenQueries) {
      expect(q.get('from')).toBe('2026-01-01')
      expect(q.get('to')).toBe('2026-03-31')
    }
    expect(screen.getByRole('link', { name: 'Ver histórico de gastos' })).toHaveAttribute(
      'href',
      '/gastos?from=2026-01-01&to=2026-03-31',
    )
  })

  it('el total del período coincide con el "Total filtrado" del histórico para el mismo filtro', async () => {
    server.use(
      http.get(`${API}/expenses`, () =>
        HttpResponse.json({
          content: [],
          page: 0,
          size: 20,
          totalElements: 0,
          totalPages: 0,
          totalFiltered: [
            { amountMinor: 350050, currency: 'ARS' },
            { amountMinor: 1000, currency: 'USD' },
          ],
        }),
      ),
      http.get(`${API}/categories`, () => HttpResponse.json([])),
      http.get(`${API}/members`, () => HttpResponse.json([])),
    )
    renderAt('/reportes?from=2026-01-01')

    const arsTotal = await screen.findByText(/Total del período: ARS/)
    const usdTotal = screen.getByText(/Total del período: USD/)
    await userEvent.click(screen.getByRole('link', { name: 'Ver histórico de gastos' }))

    const filtered = await screen.findByRole('region', { name: 'Total filtrado' })
    await within(filtered).findByText('ARS 3.500,50')
    expect(arsTotal.textContent).toBe('Total del período: ARS 3.500,50')
    expect(usdTotal.textContent).toBe('Total del período: USD 10,00')
    expect(within(filtered).getByText('USD 10,00')).toBeInTheDocument()
    expect(currentUrl).toBe('/gastos?from=2026-01-01')
  })

  it('muestra estados vacíos', async () => {
    useHandlers({ month: [], category: [], store: [] })
    renderAt('/reportes')

    const monthly = await screen.findByRole('region', { name: 'Gasto mensual' })
    await within(monthly).findByText('No hay gastos en este período.')
    const stores = screen.getByRole('region', { name: 'Gasto por comercio' })
    await within(stores).findByText('No hay compras con comercio en este período.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByText('Elegí un producto para ver cómo cambió su precio.'),
    ).toBeInTheDocument()
  })

  it('un error no se muestra como vacío: alerta en español con reintento', async () => {
    useHandlers({ month: 500, category: CATEGORIES, store: STORES })
    renderAt('/reportes')

    const monthly = await screen.findByRole('region', { name: 'Gasto mensual' })
    const alert = await within(monthly).findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cargar el gasto mensual.')
    expect(within(monthly).queryByText('No hay gastos en este período.')).not.toBeInTheDocument()

    useHandlers()
    await userEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await within(monthly).findByRole('table', { name: 'Gasto mensual en ARS' })
    expect(within(monthly).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('un refetch fallido con datos previos conserva los datos y avisa', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderAt('/reportes', queryClient)
    const monthly = await screen.findByRole('region', { name: 'Gasto mensual' })
    await within(monthly).findByRole('table', { name: 'Gasto mensual en ARS' })

    useHandlers({ month: 500, category: CATEGORIES, store: STORES })
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['expenses', 'summary'] })
    })

    const alert = await within(monthly).findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos actualizar el gasto mensual')
    expect(within(monthly).getByRole('table', { name: 'Gasto mensual en ARS' })).toBeInTheDocument()
  })

  it('rango inválido: aviso y sin pedir datos; parámetros basura se descartan', async () => {
    renderAt('/reportes?from=2026-05-01&to=2026-01-01')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La fecha “Desde” no puede ser posterior a “Hasta”.',
    )
    expect(seenQueries.length).toBe(0)
    resetSession()
  })

  it('descarta fechas inválidas de la URL y normaliza la dirección', async () => {
    renderAt('/reportes?from=nope&to=2026-02-30&x=1')
    await screen.findByRole('table', { name: 'Gasto mensual en ARS' })
    expect(screen.getByLabelText('Desde')).toHaveValue('')
    expect(screen.getByLabelText('Hasta')).toHaveValue('')
    await waitFor(() => expect(currentUrl).toBe('/reportes?x=1'))
    for (const q of seenQueries) {
      expect(q.has('from')).toBe(false)
      expect(q.has('to')).toBe(false)
    }
  })

  describe('evolución de precio', () => {
    const point = (
      date: string,
      amountMinor: number,
      unit: PricePoint['unit'],
      store?: string,
    ): PricePoint => ({ date, store, unitPrice: { amountMinor, currency: 'ARS' }, unit })

    async function pickLeche() {
      server.use(
        http.get(`${API}/products`, () =>
          HttpResponse.json({
            content: [LECHE],
            page: 0,
            size: 20,
            totalElements: 1,
            totalPages: 1,
          }),
        ),
      )
      renderAt('/reportes?from=2026-01-01')
      const input = await screen.findByRole('combobox', { name: 'Producto' })
      await userEvent.type(input, 'Leche')
      await userEvent.click(await screen.findByRole('option', { name: /Leche entera/ }))
    }

    it('una serie por unidad: no mezcla unidades y permite elegir', async () => {
      let priceQuery: URLSearchParams | undefined
      server.use(
        http.get(`${API}/products/${LECHE.id}/price-history`, ({ request }) => {
          priceQuery = new URL(request.url).searchParams
          return HttpResponse.json([
            point('2026-01-10', 150000, 'L', 'Coto'),
            point('2026-02-10', 170000, 'L'),
            point('2026-02-11', 90000, 'ML', 'Dia'),
          ])
        }),
      )
      await pickLeche()

      const table = await screen.findByRole('table', {
        name: 'Precio de Leche entera en ARS por L',
      })
      expect(priceQuery?.get('from')).toBe('2026-01-01')
      expect(within(table).getAllByRole('row')).toHaveLength(3) // encabezado + 2 puntos (solo litros)
      expect(within(table).getByRole('row', { name: /10\/01\/2026/ })).toHaveTextContent('Coto')
      expect(within(table).getByRole('row', { name: /10\/02\/2026/ })).toHaveTextContent(
        'Sin comercio',
      )
      expect(within(table).getByRole('row', { name: /10\/02\/2026/ })).toHaveTextContent(
        'ARS 1.700,00',
      )
      expect(
        screen.getByRole('img', { name: /precio de Leche entera en ARS por L, 2 compras/ }),
      ).toBeInTheDocument()

      await userEvent.selectOptions(screen.getByLabelText('Unidad'), 'ML')
      const ml = await screen.findByRole('table', { name: 'Precio de Leche entera en ARS por ml' })
      expect(within(ml).getByRole('row', { name: /11\/02\/2026/ })).toHaveTextContent('ARS 900,00')
    })

    it('producto sin compras: estado vacío', async () => {
      server.use(http.get(`${API}/products/${LECHE.id}/price-history`, () => HttpResponse.json([])))
      await pickLeche()
      expect(
        await screen.findByText('Este producto no tiene compras en el período.'),
      ).toBeInTheDocument()
    })

    it('error del histórico de precios: alerta con reintento', async () => {
      server.use(
        http.get(`${API}/products/${LECHE.id}/price-history`, () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Not found', status: 404, code: 'NOT_FOUND' },
            { status: 404 },
          ),
        ),
      )
      await pickLeche()
      const alert = await screen.findByText('Ese producto ya no existe.')
      expect(alert.closest('[role="alert"]')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    })
  })
})
