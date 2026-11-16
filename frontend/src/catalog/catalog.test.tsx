import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { resetApiClient } from '@/api/client'
import type { Category, Product, ProductInput, ProductPage } from '@/api/types'
import { AuthProvider } from '@/auth/AuthProvider'
import { applyTokens, resetSession } from '@/auth/session'
import { ProductPicker } from '@/catalog/ProductPicker'
import { advanceUntil, useFakeClock } from '@/test/fakeTimers'
import { server } from '@/test/server'

const API = 'http://localhost/api/v1'

const conflictProblem = (detail = 'Conflict') => ({
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  code: 'CONFLICT',
  detail,
})

const LECHE: Product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Leche entera',
  categoryId: null,
  defaultUnit: 'L',
  defaultShelfLifeDays: 7,
  archived: false,
}

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
  vi.useRealTimers()
  resetSession()
})

describe('ProductPicker', () => {
  it('busca productos con debounce (timers falsos) y permite seleccionar uno existente', async () => {
    useFakeClock()
    const queriesSeen: string[] = []
    server.use(
      http.get(`${API}/products`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        if (q) queriesSeen.push(q)
        const matches = q && 'leche entera'.includes(q.toLowerCase()) ? [LECHE] : []
        return HttpResponse.json(makePage(matches))
      }),
    )

    const onSelect = vi.fn()
    renderWithQuery(<ProductPicker onSelect={onSelect} />)

    const input = screen.getByRole('combobox', { name: 'Producto' })
    // user-event/RTL helpers wait on real timers, so drive the input with fireEvent here.
    fireEvent.focus(input)
    for (const text of ['l', 'le', 'lec', 'lech', 'leche']) {
      fireEvent.change(input, { target: { value: text } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
    }

    // 299 ms since the last key (debounce is 300): nothing queried yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249)
    })
    expect(queriesSeen).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    // Let the request and React Query flush (still with fake timers), however long it takes.
    await advanceUntil(() => {
      expect(screen.getByRole('option', { name: /Leche entera/i })).toBeInTheDocument()
    })
    expect(queriesSeen).toEqual(['leche'])

    fireEvent.click(screen.getByRole('option', { name: /Leche entera/i }))
    expect(onSelect).toHaveBeenCalledWith(LECHE)
  })

  it('no ofrece Crear mientras corre el debounce o la búsqueda del texto actual', async () => {
    // Las respuestas quedan retenidas hasta que el test las libera: así "la búsqueda del texto
    // actual sigue en curso" no depende de cuánto tarde userEvent.type con la CPU saturada
    // (si no, una consulta con texto parcial podría asentarse y ofrecer Crear legítimamente).
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(`${API}/products`, async () => {
        await gate
        return HttpResponse.json(makePage([LECHE]))
      }),
    )
    renderWithQuery(<ProductPicker onSelect={vi.fn()} debounceMs={50} />)

    const input = screen.getByRole('combobox', { name: 'Producto' })
    await userEvent.type(input, 'Leche entera')
    expect(screen.queryByRole('option', { name: /Crear/ })).not.toBeInTheDocument()

    release()
    // Al liberar llegan también las respuestas de textos parciales: se espera al estado final
    // (sin "Buscando…") y se asierta todo en el mismo instante, no sobre un nodo transitorio.
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Leche entera/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Crear/ })).not.toBeInTheDocument()
    })
  })

  it('muestra un producto archivado como no disponible, sin ofrecer Crear ni permitir elegirlo', async () => {
    const archived: Product = { ...LECHE, archived: true }
    let includeArchivedSent: string | null = null
    server.use(
      http.get(`${API}/products`, ({ request }) => {
        includeArchivedSent = new URL(request.url).searchParams.get('includeArchived')
        return HttpResponse.json(makePage([archived]))
      }),
    )
    const onSelect = vi.fn()
    renderWithQuery(<ProductPicker onSelect={onSelect} debounceMs={10} />)

    const input = screen.getByRole('combobox', { name: 'Producto' })
    await userEvent.type(input, 'Leche entera')

    const option = await screen.findByRole('option', { name: /Leche entera/ })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option).toHaveTextContent('No disponible (archivado)')
    expect(includeArchivedSent).toBe('true')
    expect(screen.queryByRole('option', { name: /Crear/ })).not.toBeInTheDocument()

    await userEvent.click(option)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('se puede usar con teclado: flechas, Enter y aria-activedescendant; el listbox solo tiene options', async () => {
    const arroz: Product = { ...LECHE, id: 'a1111111-1111-4111-8111-111111111111', name: 'Arroz' }
    server.use(http.get(`${API}/products`, () => HttpResponse.json(makePage([LECHE, arroz]))))
    const onSelect = vi.fn()
    renderWithQuery(<ProductPicker onSelect={onSelect} debounceMs={10} />)

    const input = screen.getByRole('combobox', { name: 'Producto' })
    await userEvent.click(input)
    await userEvent.type(input, 'a')
    const listbox = await screen.findByRole('listbox')
    // Wait until the results for the typed text settle (the Create option only shows then)
    await screen.findByRole('option', { name: 'Crear "a"' })
    expect(within(listbox).queryByRole('button')).not.toBeInTheDocument()
    expect(within(listbox).queryByRole('combobox')).not.toBeInTheDocument()

    await userEvent.keyboard('{ArrowDown}')
    const first = screen.getByRole('option', { name: /Leche entera/ })
    expect(input).toHaveAttribute('aria-activedescendant', first.id)

    await userEvent.keyboard('{ArrowDown}')
    const second = screen.getByRole('option', { name: /Arroz/ })
    expect(input).toHaveAttribute('aria-activedescendant', second.id)

    // With "a" nothing matches exactly, so the "Crear" option is the third entry; ArrowUp x2 wraps to it
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    const create = screen.getByRole('option', { name: 'Crear "a"' })
    expect(input).toHaveAttribute('aria-activedescendant', create.id)
    await userEvent.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', second.id)

    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(arroz)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('cierra el desplegable con Escape y con blur', async () => {
    server.use(http.get(`${API}/products`, () => HttpResponse.json(makePage([LECHE]))))
    renderWithQuery(
      <>
        <ProductPicker onSelect={vi.fn()} debounceMs={10} />
        <button type="button">Otro</button>
      </>,
    )
    const input = screen.getByRole('combobox', { name: 'Producto' })
    await userEvent.type(input, 'lec')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await userEvent.type(input, 'e')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Otro' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('sincroniza el texto cuando el padre cambia value', async () => {
    server.use(http.get(`${API}/products`, () => HttpResponse.json(makePage([]))))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (v: Product | null) => (
      <QueryClientProvider client={queryClient}>
        <ProductPicker value={v} onSelect={vi.fn()} />
      </QueryClientProvider>
    )
    const { rerender } = render(ui(LECHE))
    const input = screen.getByRole('combobox', { name: 'Producto' })
    expect(input).toHaveValue('Leche entera')
    rerender(ui(null))
    expect(input).toHaveValue('')
  })

  it('muestra un error con reintento si falla la búsqueda, sin ofrecer Crear', async () => {
    let fail = true
    const seen: (string | null)[] = []
    server.use(
      http.get(`${API}/products`, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('q'))
        return fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(makePage([LECHE]))
      }),
    )
    renderWithQuery(<ProductPicker onSelect={vi.fn()} debounceMs={10} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Producto' }), 'Leche')
    // Con la CPU saturada el debounce de 10 ms puede dispararse con textos parciales ('L', 'Le'…),
    // y el error de una consulta intermedia se reemplaza al cambiar la clave: se espera a que
    // se consulte el texto final antes de asertar el error.
    await waitFor(() => expect(seen).toContain('Leche'))

    expect(await screen.findByText('No pudimos buscar productos.')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Crear/ })).not.toBeInTheDocument()

    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('option', { name: /Leche entera/ })).toBeInTheDocument()
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

    const createBtn = screen.getByRole('option', { name: 'Crear "Yerba mate"' })
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
    await userEvent.click(await screen.findByRole('option', { name: 'Crear "Arroz"' }))

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
      'No se puede eliminar una categoría que tiene productos o gastos asociados.',
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
  it('muestra un error con reintento (no una lista vacía) si fallan las queries', async () => {
    let fail = true
    server.use(
      http.get(`${API}/categories`, () =>
        fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json([]),
      ),
      http.get(`${API}/products`, () =>
        fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(makePage([LECHE])),
      ),
    )
    renderCatalogRoute()

    expect(await screen.findByText('No pudimos cargar las categorías.')).toBeInTheDocument()
    expect(await screen.findByText('No pudimos cargar los productos.')).toBeInTheDocument()
    expect(screen.queryByText('Aún no hay categorías creadas.')).not.toBeInTheDocument()
    expect(screen.queryByText('No se encontraron productos.')).not.toBeInTheDocument()

    fail = false
    for (const btn of screen.getAllByRole('button', { name: 'Reintentar' })) {
      await userEvent.click(btn)
    }
    expect(await screen.findByText('Leche entera')).toBeInTheDocument()
    expect(await screen.findByText('Aún no hay categorías creadas.')).toBeInTheDocument()
  })

  it('busca con debounce y pagina manteniendo la lista y los controles visibles', async () => {
    const seen: string[] = []
    // La página 2 queda retenida hasta que el test la libera: "mientras carga" no depende de
    // un retardo fijo ni de cuánto tarde el click con la CPU saturada.
    let releasePage1!: () => void
    const page1Gate = new Promise<void>((resolve) => {
      releasePage1 = resolve
    })
    server.use(
      http.get(`${API}/categories`, () => HttpResponse.json([])),
      http.get(`${API}/products`, async ({ request }) => {
        const url = new URL(request.url)
        const page = Number(url.searchParams.get('page') ?? '0')
        const q = url.searchParams.get('q')
        seen.push(`${q ?? ''}|${page}`)
        if (page === 1) await page1Gate
        const content = [{ ...LECHE, name: q ? `Resultado ${q}` : `Producto página ${page}` }]
        return HttpResponse.json({ content, page, size: 20, totalElements: 40, totalPages: 2 })
      }),
    )
    renderCatalogRoute()

    expect(await screen.findByText('Producto página 0')).toBeInTheDocument()
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    // Mientras carga la página 2 (pedido ya en vuelo, respuesta retenida) se conserva la lista
    // anterior y la paginación
    await waitFor(() => expect(seen).toContain('|1'))
    expect(screen.getByText('Producto página 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument()
    releasePage1()
    expect(await screen.findByText('Producto página 1')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Buscar productos'), 'pan')
    expect(await screen.findByText('Resultado pan')).toBeInTheDocument()
    expect(seen.filter((s) => s.startsWith('p'))).toEqual(['pan|0'])
  })

  it('vuelve a la última página válida si la página actual queda fuera de rango', async () => {
    const pages: number[] = []
    server.use(
      http.get(`${API}/categories`, () => HttpResponse.json([])),
      http.get(`${API}/products`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '0')
        pages.push(page)
        // La página 1 ya no existe (p. ej. se archivó su único producto): el total baja a 1.
        if (page >= 1) {
          return HttpResponse.json({
            content: [],
            page,
            size: 20,
            totalElements: 20,
            totalPages: 1,
          })
        }
        return HttpResponse.json({
          content: [{ ...LECHE, name: 'Producto página 0' }],
          page,
          size: 20,
          totalElements: 40,
          totalPages: 2,
        })
      }),
    )
    renderCatalogRoute()
    expect(await screen.findByText('Producto página 0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

    await waitFor(() => expect(pages.slice(-1)).toEqual([0]))
    expect(pages).toContain(1)
    expect(await screen.findByText('Producto página 0')).toBeInTheDocument()
    expect(screen.queryByText('No se encontraron productos.')).not.toBeInTheDocument()
  })
})
