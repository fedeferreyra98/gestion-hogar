import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { Category, Product, ProductInput, ProductPage } from '@/api/types'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { ProductPicker } from '@/catalog/ProductPicker'
import { server } from '@/test/server'

const API = 'http://localhost/api/v1'

const conflictProblem = (detail = 'Conflict') => ({
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  code: 'CONFLICT',
  detail,
})

function makePage(content: Product[]): ProductPage {
  return {
    content,
    page: 0,
    size: 20,
    totalElements: content.length,
    totalPages: content.length > 0 ? 1 : 0,
  }
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderCatalogRoute() {
  applyTokens({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresInSeconds: 900,
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/catalogo']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => resetApiClient())
afterEach(() => {
  resetSession()
})

describe('ProductPicker', () => {
  it('busca productos con debounce y permite seleccionar uno existente', async () => {
    const queriesSeen: string[] = []
    const leche: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Leche entera',
      categoryId: null,
      defaultUnit: 'L',
      defaultShelfLifeDays: 7,
      archived: false,
    }

    server.use(
      http.get(`${API}/products`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        if (q) queriesSeen.push(q)
        const matches = q && 'leche entera'.includes(q.toLowerCase()) ? [leche] : []
        return HttpResponse.json(makePage(matches))
      }),
    )

    const onSelect = vi.fn()
    renderWithQuery(<ProductPicker onSelect={onSelect} debounceMs={80} />)

    const input = screen.getByRole('combobox', { name: 'Producto' })
    await userEvent.type(input, 'leche')

    // Inmediatamente tras tipear 5 letras rápido, el debounce aún no disparó consultas por cada tecla
    expect(queriesSeen).toEqual([])

    const option = await screen.findByRole('option', { name: /Leche entera/i })
    // Solo se consultó una vez con el término completo 'leche', no por cada tecla intermedia
    expect(queriesSeen).toEqual(['leche'])

    await userEvent.click(option)
    expect(onSelect).toHaveBeenCalledWith(leche)
  })

  it('permite crear un producto al vuelo cuando no existe coincidencia exacta', async () => {
    const created: Product = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Yerba mate',
      categoryId: null,
      defaultUnit: 'KG',
      defaultShelfLifeDays: null,
      archived: false,
    }
    let postBody: unknown = null

    server.use(
      http.get(`${API}/products`, () => HttpResponse.json(makePage([]))),
      http.post(`${API}/products`, async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json(created, { status: 201 })
      }),
    )

    const onSelect = vi.fn()
    renderWithQuery(<ProductPicker onSelect={onSelect} debounceMs={10} />)

    const input = screen.getByRole('combobox', { name: 'Producto' })
    await userEvent.type(input, 'Yerba mate')

    const unitSelect = await screen.findByLabelText('Unidad del nuevo producto')
    await userEvent.selectOptions(unitSelect, 'KG')

    const createBtn = screen.getByRole('button', { name: 'Crear "Yerba mate"' })
    await userEvent.click(createBtn)

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(created))
    expect(postBody).toEqual({
      name: 'Yerba mate',
      defaultUnit: 'KG',
      categoryId: null,
    })
  })

  it('muestra alerta ante 409 al crear un producto al vuelo con nombre duplicado', async () => {
    server.use(
      http.get(`${API}/products`, () => HttpResponse.json(makePage([]))),
      http.post(`${API}/products`, () =>
        HttpResponse.json(conflictProblem('Product already exists'), { status: 409 }),
      ),
    )

    const onSelect = vi.fn()
    renderWithQuery(<ProductPicker onSelect={onSelect} debounceMs={10} />)

    const input = screen.getByRole('combobox', { name: 'Producto' })
    await userEvent.type(input, 'Arroz')
    await userEvent.click(await screen.findByRole('button', { name: 'Crear "Arroz"' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe un producto con ese nombre.',
    )
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('CatalogPage — ABM de categorías y productos', () => {
  it('permite crear, renombrar y eliminar categorías, y maneja los errores 409', async () => {
    let categories: Category[] = [
      { id: 'c1111111-1111-4111-8111-111111111111', name: 'Lácteos' },
      { id: 'c2222222-2222-4222-8222-222222222222', name: 'Limpieza' },
    ]

    server.use(
      http.get(`${API}/categories`, () => HttpResponse.json(categories)),
      http.get(`${API}/products`, () => HttpResponse.json(makePage([]))),
      http.post(`${API}/categories`, async ({ request }) => {
        const body = (await request.json()) as { name: string }
        if (categories.some((c) => c.name.toLowerCase() === body.name.toLowerCase())) {
          return HttpResponse.json(conflictProblem('Duplicate category'), { status: 409 })
        }
        const created: Category = {
          id: 'c3333333-3333-4333-8333-333333333333',
          name: body.name,
        }
        categories = [...categories, created]
        return HttpResponse.json(created, { status: 201 })
      }),
      http.put(`${API}/categories/:id`, async ({ params, request }) => {
        const id = String(params.id)
        const body = (await request.json()) as { name: string }
        if (
          categories.some((c) => c.id !== id && c.name.toLowerCase() === body.name.toLowerCase())
        ) {
          return HttpResponse.json(conflictProblem('Duplicate category'), { status: 409 })
        }
        const updated: Category = { id, name: body.name }
        categories = categories.map((c) => (c.id === id ? updated : c))
        return HttpResponse.json(updated)
      }),
      http.delete(`${API}/categories/:id`, ({ params }) => {
        const id = String(params.id)
        // Simulamos que Lácteos tiene productos (409) y las demás no (204)
        if (id === 'c1111111-1111-4111-8111-111111111111') {
          return HttpResponse.json(conflictProblem('Category has products'), { status: 409 })
        }
        categories = categories.filter((c) => c.id !== id)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderCatalogRoute()

    const categoriesSection = await screen.findByRole('region', { name: 'Categorías' })
    expect(await within(categoriesSection).findByText('Lácteos')).toBeInTheDocument()
    expect(within(categoriesSection).getByText('Limpieza')).toBeInTheDocument()

    // Intentar crear categoría duplicada -> 409
    await userEvent.type(screen.getByLabelText('Nueva categoría'), 'Lácteos')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar categoría' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe una categoría con ese nombre.',
    )

    // Crear categoría nueva válida
    const newCatInput = screen.getByLabelText('Nueva categoría')
    await userEvent.clear(newCatInput)
    await userEvent.type(newCatInput, 'Almacén')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar categoría' }))
    expect(await within(categoriesSection).findByText('Almacén')).toBeInTheDocument()

    // Intentar renombrar categoría Limpieza a nombre existente (Almacén) -> 409
    await userEvent.click(screen.getByRole('button', { name: 'Editar categoría Limpieza' }))
    const editInput = screen.getByLabelText('Nuevo nombre para Limpieza')
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Almacén')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar categoría' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe una categoría con ese nombre.',
    )

    // Renombrar categoría Limpieza -> Higiene
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Higiene')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar categoría' }))
    expect(await within(categoriesSection).findByText('Higiene')).toBeInTheDocument()

    // Intentar eliminar categoría con productos (Lácteos) -> 409
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar categoría Lácteos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se puede eliminar una categoría que tiene productos asociados.',
    )
    expect(within(categoriesSection).getByText('Lácteos')).toBeInTheDocument()

    // Eliminar categoría sin productos (Higiene) -> 204
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar categoría Higiene' }))
    await waitFor(() =>
      expect(within(categoriesSection).queryByText('Higiene')).not.toBeInTheDocument(),
    )
  })

  it('permite crear, editar, archivar/desarchivar productos y maneja 409 por nombre duplicado', async () => {
    const categories: Category[] = [{ id: 'c1111111-1111-4111-8111-111111111111', name: 'Lácteos' }]
    let products: Product[] = [
      {
        id: 'p1111111-1111-4111-8111-111111111111',
        name: 'Leche entera',
        categoryId: 'c1111111-1111-4111-8111-111111111111',
        defaultUnit: 'L',
        defaultShelfLifeDays: 7,
        archived: false,
      },
    ]

    server.use(
      http.get(`${API}/categories`, () => HttpResponse.json(categories)),
      http.get(`${API}/products`, ({ request }) => {
        const url = new URL(request.url)
        const q = (url.searchParams.get('q') ?? '').toLowerCase()
        const includeArchived = url.searchParams.get('includeArchived') === 'true'
        const filtered = products.filter(
          (p) => (includeArchived || !p.archived) && (!q || p.name.toLowerCase().includes(q)),
        )
        return HttpResponse.json(makePage(filtered))
      }),
      http.post(`${API}/products`, async ({ request }) => {
        const body = (await request.json()) as ProductInput
        if (products.some((p) => p.name.toLowerCase() === body.name.toLowerCase())) {
          return HttpResponse.json(conflictProblem('Duplicate product'), { status: 409 })
        }
        const created: Product = {
          id: 'p2222222-2222-4222-8222-222222222222',
          name: body.name,
          categoryId: body.categoryId ?? null,
          defaultUnit: body.defaultUnit,
          defaultShelfLifeDays: body.defaultShelfLifeDays ?? null,
          archived: false,
        }
        products = [...products, created]
        return HttpResponse.json(created, { status: 201 })
      }),
      http.put(`${API}/products/:id`, async ({ params, request }) => {
        const id = String(params.id)
        const body = (await request.json()) as ProductInput
        if (products.some((p) => p.id !== id && p.name.toLowerCase() === body.name.toLowerCase())) {
          return HttpResponse.json(conflictProblem('Duplicate product'), { status: 409 })
        }
        let updated!: Product
        products = products.map((p) => {
          if (p.id !== id) return p
          updated = {
            ...p,
            name: body.name,
            categoryId: body.categoryId ?? null,
            defaultUnit: body.defaultUnit,
            defaultShelfLifeDays: body.defaultShelfLifeDays ?? null,
          }
          return updated
        })
        return HttpResponse.json(updated)
      }),
      http.post(`${API}/products/:id/archive`, ({ params }) => {
        const id = String(params.id)
        let updated!: Product
        products = products.map((p) => {
          if (p.id !== id) return p
          updated = { ...p, archived: true }
          return updated
        })
        return HttpResponse.json(updated)
      }),
      http.post(`${API}/products/:id/unarchive`, ({ params }) => {
        const id = String(params.id)
        let updated!: Product
        products = products.map((p) => {
          if (p.id !== id) return p
          updated = { ...p, archived: false }
          return updated
        })
        return HttpResponse.json(updated)
      }),
    )

    renderCatalogRoute()

    expect(await screen.findByText('Leche entera')).toBeInTheDocument()

    // Intentar crear producto con nombre duplicado -> 409
    await userEvent.type(screen.getByLabelText('Nombre del producto'), 'Leche entera')
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe un producto con ese nombre.',
    )

    // Crear producto nuevo válido
    const nameInput = screen.getByLabelText('Nombre del producto')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Yogur')
    await userEvent.selectOptions(
      screen.getByLabelText('Categoría del producto'),
      'c1111111-1111-4111-8111-111111111111',
    )
    await userEvent.selectOptions(screen.getByLabelText('Unidad por defecto'), 'G')
    await userEvent.type(screen.getByLabelText('Vida útil (días, opcional)'), '14')
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }))

    expect(await screen.findByText('Yogur')).toBeInTheDocument()

    // Intentar editar producto Yogur a nombre duplicado (Leche entera) -> 409
    await userEvent.click(screen.getByRole('button', { name: 'Editar producto Yogur' }))
    const editNameInput = screen.getByLabelText('Nombre del producto')
    await userEvent.clear(editNameInput)
    await userEvent.type(editNameInput, 'Leche entera')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe un producto con ese nombre.',
    )

    // Editar producto Yogur -> Yogur natural
    await userEvent.clear(editNameInput)
    await userEvent.type(editNameInput, 'Yogur natural')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Yogur natural')).toBeInTheDocument()

    // Archivar producto Yogur natural
    await userEvent.click(screen.getByRole('button', { name: 'Archivar producto Yogur natural' }))
    await waitFor(() => expect(screen.queryByText('Yogur natural')).not.toBeInTheDocument())

    // Mostrar archivados y desarchivar
    await userEvent.click(screen.getByLabelText('Mostrar archivados'))
    expect(await screen.findByText('Yogur natural')).toBeInTheDocument()
    expect(screen.getByText('Archivado')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Desarchivar producto Yogur natural' }),
    )
    await waitFor(() => expect(screen.queryByText('Archivado')).not.toBeInTheDocument())
  })
})
