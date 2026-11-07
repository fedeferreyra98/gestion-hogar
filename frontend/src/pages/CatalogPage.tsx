import { keepPreviousData } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { isProblemError } from '@/api/errors'
import {
  useArchiveProduct,
  useCategories,
  useCreateCategory,
  useCreateProduct,
  useDeleteCategory,
  useProducts,
  useUnarchiveProduct,
  useUpdateCategory,
  useUpdateProduct,
} from '@/api/hooks/useCatalog'
import type { Category, Product, Unit } from '@/api/types'
import { UNITS, UNIT_LABELS, UNIT_SHORT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

export function CatalogPage() {
  const {
    data: categories = [],
    isLoading: loadingCategories,
    isError: categoriesError,
    refetch: refetchCategories,
  } = useCategories()
  const createCategoryMutation = useCreateCategory()
  const updateCategoryMutation = useUpdateCategory()
  const deleteCategoryMutation = useDeleteCategory()

  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 300)
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [page, setPage] = useState(0)

  const {
    data: productsPage,
    isLoading: loadingProducts,
    isError: productsError,
    refetch: refetchProducts,
  } = useProducts(
    {
      q: debouncedSearch || undefined,
      categoryId: filterCategoryId || undefined,
      includeArchived,
      page,
      size: 20,
    },
    { placeholderData: keepPreviousData },
  )

  const createProductMutation = useCreateProduct()
  const updateProductMutation = useUpdateProduct()
  const archiveProductMutation = useArchiveProduct()
  const unarchiveProductMutation = useUnarchiveProduct()

  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productName, setProductName] = useState('')
  const [productCategoryId, setProductCategoryId] = useState('')
  const [productUnit, setProductUnit] = useState<Unit>('UNIT')
  const [productShelfLife, setProductShelfLife] = useState('')
  const [productError, setProductError] = useState<string | null>(null)

  const categoriesById = useMemo(() => {
    const map = new Map<string, Category>()
    for (const c of categories) map.set(c.id, c)
    return map
  }, [categories])

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault()
    const name = newCategoryName.trim()
    if (!name) return
    setCategoryError(null)
    try {
      await createCategoryMutation.mutateAsync({ name })
      setNewCategoryName('')
    } catch (err) {
      if (isProblemError(err) && err.status === 409) {
        setCategoryError('Ya existe una categoría con ese nombre.')
      } else {
        setCategoryError('No pudimos crear la categoría. Intentá de nuevo.')
      }
    }
  }

  function startEditCategory(category: Category) {
    setCategoryError(null)
    setEditingCategoryId(category.id)
    setEditingCategoryName(category.name)
  }

  function cancelEditCategory() {
    setEditingCategoryId(null)
    setEditingCategoryName('')
  }

  async function handleUpdateCategory(e: FormEvent, id: string) {
    e.preventDefault()
    const name = editingCategoryName.trim()
    if (!name) return
    setCategoryError(null)
    try {
      await updateCategoryMutation.mutateAsync({ id, input: { name } })
      cancelEditCategory()
    } catch (err) {
      if (isProblemError(err) && err.status === 409) {
        setCategoryError('Ya existe una categoría con ese nombre.')
      } else {
        setCategoryError('No pudimos actualizar la categoría. Intentá de nuevo.')
      }
    }
  }

  async function handleDeleteCategory(id: string) {
    setCategoryError(null)
    try {
      await deleteCategoryMutation.mutateAsync(id)
      if (filterCategoryId === id) setFilterCategoryId('')
      if (productCategoryId === id) setProductCategoryId('')
    } catch (err) {
      if (isProblemError(err) && err.status === 409) {
        setCategoryError(
          'No se puede eliminar una categoría que tiene productos o gastos asociados.',
        )
      } else {
        setCategoryError('No pudimos eliminar la categoría. Intentá de nuevo.')
      }
    }
  }

  function resetProductForm() {
    setEditingProduct(null)
    setProductName('')
    setProductCategoryId('')
    setProductUnit('UNIT')
    setProductShelfLife('')
    setProductError(null)
  }

  function startEditProduct(product: Product) {
    setProductError(null)
    setEditingProduct(product)
    setProductName(product.name)
    setProductCategoryId(product.categoryId ?? '')
    setProductUnit(product.defaultUnit)
    setProductShelfLife(
      product.defaultShelfLifeDays !== null && product.defaultShelfLifeDays !== undefined
        ? String(product.defaultShelfLifeDays)
        : '',
    )
  }

  async function handleSubmitProduct(e: FormEvent) {
    e.preventDefault()
    const name = productName.trim()
    if (!name) return
    setProductError(null)

    let defaultShelfLifeDays: number | null = null
    if (productShelfLife.trim() !== '') {
      const parsed = Number(productShelfLife)
      if (!Number.isInteger(parsed) || parsed < 0) {
        setProductError('La vida útil debe ser un número entero mayor o igual a 0.')
        return
      }
      defaultShelfLifeDays = parsed
    }

    const input = {
      name,
      categoryId: productCategoryId ? productCategoryId : null,
      defaultUnit: productUnit,
      defaultShelfLifeDays,
    }

    try {
      if (editingProduct) {
        await updateProductMutation.mutateAsync({ id: editingProduct.id, input })
      } else {
        await createProductMutation.mutateAsync(input)
      }
      resetProductForm()
    } catch (err) {
      if (isProblemError(err) && err.status === 409) {
        setProductError('Ya existe un producto con ese nombre.')
      } else {
        setProductError('No pudimos guardar el producto. Intentá de nuevo.')
      }
    }
  }

  async function handleToggleArchive(product: Product) {
    setProductError(null)
    try {
      if (product.archived) {
        await unarchiveProductMutation.mutateAsync(product.id)
      } else {
        await archiveProductMutation.mutateAsync(product.id)
      }
    } catch {
      setProductError('No pudimos actualizar el estado del producto.')
    }
  }

  const products = productsPage?.content ?? []
  const totalPages = productsPage?.totalPages ?? 0

  // If the current page falls out of range (e.g. the last item was archived), go back.
  if (productsPage && !productsError && totalPages > 0 && page > totalPages - 1) {
    setPage(totalPages - 1)
  }

  const togglingArchive = archiveProductMutation.isPending || unarchiveProductMutation.isPending

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Catálogo</h1>

      {/* ABM de Categorías */}
      <section
        aria-labelledby="categories-heading"
        className="flex flex-col gap-4 rounded-lg border border-border p-4"
      >
        <h2 id="categories-heading" className="text-lg font-semibold">
          Categorías
        </h2>

        <form
          onSubmit={handleCreateCategory}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="new-category-name" className="text-sm font-medium">
              Nueva categoría
            </label>
            <input
              id="new-category-name"
              type="text"
              required
              placeholder="Ej. Lácteos"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
          <Button type="submit" disabled={createCategoryMutation.isPending}>
            Agregar categoría
          </Button>
        </form>

        {categoryError && (
          <p role="alert" className="text-sm text-red-600">
            {categoryError}
          </p>
        )}

        {loadingCategories ? (
          <p className="text-sm text-muted-foreground">Cargando categorías…</p>
        ) : categoriesError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-600">
            <span>No pudimos cargar las categorías.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refetchCategories()}
            >
              Reintentar
            </Button>
          </div>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay categorías creadas.</p>
        ) : (
          <ul className="divide-y divide-border">
            {categories.map((cat) => (
              <li key={cat.id} className="flex items-center justify-between gap-2 py-2">
                {editingCategoryId === cat.id ? (
                  <form
                    onSubmit={(e) => void handleUpdateCategory(e, cat.id)}
                    className="flex flex-1 flex-wrap items-center gap-2"
                  >
                    <input
                      type="text"
                      required
                      aria-label={`Nuevo nombre para ${cat.name}`}
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      className="h-9 min-w-40 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                    />
                    <Button type="submit" size="sm" disabled={updateCategoryMutation.isPending}>
                      Guardar categoría
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={cancelEditCategory}>
                      Cancelar
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="text-sm font-medium">{cat.name}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar categoría ${cat.name}`}
                        onClick={() => startEditCategory(cat)}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Eliminar categoría ${cat.name}`}
                        disabled={deleteCategoryMutation.isPending}
                        onClick={() => void handleDeleteCategory(cat.id)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ABM de Productos */}
      <section
        aria-labelledby="products-heading"
        className="flex flex-col gap-4 rounded-lg border border-border p-4"
      >
        <h2 id="products-heading" className="text-lg font-semibold">
          Productos
        </h2>

        <form
          onSubmit={handleSubmitProduct}
          className="flex flex-col gap-3 rounded-md bg-muted/40 p-3"
        >
          <h3 className="text-sm font-semibold">
            {editingProduct ? `Editar producto: ${editingProduct.name}` : 'Nuevo producto'}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="product-name" className="text-sm font-medium">
                Nombre del producto
              </label>
              <input
                id="product-name"
                type="text"
                required
                placeholder="Ej. Leche entera"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="product-category" className="text-sm font-medium">
                Categoría del producto
              </label>
              <select
                id="product-category"
                value={productCategoryId}
                onChange={(e) => setProductCategoryId(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Sin categoría</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="product-unit" className="text-sm font-medium">
                Unidad por defecto
              </label>
              <select
                id="product-unit"
                value={productUnit}
                onChange={(e) => setProductUnit(e.target.value as Unit)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="product-shelf-life" className="text-sm font-medium">
                Vida útil (días, opcional)
              </label>
              <input
                id="product-shelf-life"
                type="number"
                min={0}
                step={1}
                placeholder="Ej. 7"
                value={productShelfLife}
                onChange={(e) => setProductShelfLife(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>

          {productError && (
            <p role="alert" className="text-sm text-red-600">
              {productError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={createProductMutation.isPending || updateProductMutation.isPending}
            >
              {editingProduct ? 'Guardar cambios' : 'Crear producto'}
            </Button>
            {editingProduct && (
              <Button type="button" variant="ghost" onClick={resetProductForm}>
                Cancelar edición
              </Button>
            )}
          </div>
        </form>

        {/* Buscador y filtros */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="product-search" className="text-sm font-medium">
              Buscar productos
            </label>
            <input
              id="product-search"
              type="search"
              placeholder="Filtrar por nombre…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(0)
              }}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="filter-category" className="text-sm font-medium">
              Filtrar por categoría
            </label>
            <select
              id="filter-category"
              value={filterCategoryId}
              onChange={(e) => {
                setFilterCategoryId(e.target.value)
                setPage(0)
              }}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Todas las categorías</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              id="filter-archived"
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => {
                setIncludeArchived(e.target.checked)
                setPage(0)
              }}
            />
            Mostrar archivados
          </label>
        </div>

        {/* Lista de productos */}
        {loadingProducts ? (
          <p className="text-sm text-muted-foreground">Cargando productos…</p>
        ) : productsError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-600">
            <span>No pudimos cargar los productos.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refetchProducts()}
            >
              Reintentar
            </Button>
          </div>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No se encontraron productos.</p>
        ) : (
          <ul className="divide-y divide-border">
            {products.map((product) => {
              const categoryName = product.categoryId
                ? categoriesById.get(product.categoryId)?.name
                : undefined
              return (
                <li
                  key={product.id}
                  className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{product.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {UNIT_SHORT_LABELS[product.defaultUnit]}
                      </span>
                      {product.archived && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                          Archivado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {categoryName ? `Categoría: ${categoryName}` : 'Sin categoría'}
                      {product.defaultShelfLifeDays !== null &&
                        product.defaultShelfLifeDays !== undefined &&
                        ` · Vida útil: ${product.defaultShelfLifeDays} días`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Editar producto ${product.name}`}
                      onClick={() => startEditProduct(product)}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={
                        product.archived
                          ? `Desarchivar producto ${product.name}`
                          : `Archivar producto ${product.name}`
                      }
                      disabled={togglingArchive}
                      onClick={() => void handleToggleArchive(product)}
                    >
                      {product.archived ? 'Desarchivar' : 'Archivar'}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-muted-foreground">
              Página {page + 1} de {totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
