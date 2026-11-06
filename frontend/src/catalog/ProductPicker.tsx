import { useId, useState } from 'react'
import { isProblemError } from '@/api/errors'
import {
  UNITS,
  UNIT_LABELS,
  UNIT_SHORT_LABELS,
  useCreateProduct,
  useProducts,
} from '@/api/hooks/useCatalog'
import type { Product, Unit } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

export interface ProductPickerProps {
  value?: Product | null
  onSelect: (product: Product) => void
  defaultUnit?: Unit
  categoryId?: string | null
  label?: string
  placeholder?: string
  id?: string
  debounceMs?: number
  disabled?: boolean
}

export function ProductPicker({
  value,
  onSelect,
  defaultUnit = 'UNIT',
  categoryId = null,
  label = 'Producto',
  placeholder = 'Buscar producto…',
  id,
  debounceMs = 300,
  disabled = false,
}: ProductPickerProps) {
  const generatedId = useId()
  const inputId = id ?? `product-picker-${generatedId}`
  const listboxId = `${inputId}-listbox`

  const [query, setQuery] = useState(() => value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [customUnit, setCustomUnit] = useState<Unit | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unitForCreate = customUnit ?? defaultUnit

  const trimmedQuery = query.trim()
  const debouncedQuery = useDebouncedValue(trimmedQuery, debounceMs)

  const shouldQuery = open || debouncedQuery.length > 0
  const { data, isLoading } = useProducts(
    {
      q: debouncedQuery || undefined,
      includeArchived: false,
      size: 10,
    },
    { enabled: shouldQuery && !disabled },
  )

  const createMutation = useCreateProduct()
  const products = data?.content ?? []

  const hasExactMatch =
    trimmedQuery.length > 0 &&
    products.some((p) => p.name.trim().toLowerCase() === trimmedQuery.toLowerCase())

  const canCreateOnTheFly = trimmedQuery.length > 0 && !hasExactMatch

  function handleSelect(product: Product) {
    setError(null)
    setQuery(value !== undefined ? product.name : '')
    setOpen(false)
    onSelect(product)
  }

  async function handleCreateOnTheFly() {
    if (!trimmedQuery || createMutation.isPending) return
    setError(null)
    try {
      const created = await createMutation.mutateAsync({
        name: trimmedQuery,
        defaultUnit: unitForCreate,
        categoryId,
      })
      setQuery(value !== undefined ? created.name : '')
      setCustomUnit(null)
      setOpen(false)
      onSelect(created)
    } catch (err) {
      if (isProblemError(err) && err.status === 409) {
        setError('Ya existe un producto con ese nombre.')
      } else {
        setError('No pudimos crear el producto. Intentá de nuevo.')
      }
    }
  }

  const showDropdown = open && !disabled && (trimmedQuery.length > 0 || products.length > 0)

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        placeholder={placeholder}
        disabled={disabled}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setError(null)
          setQuery(e.target.value)
          setOpen(true)
        }}
        className="h-10 rounded-md border border-border bg-background px-3 text-sm"
      />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Resultados de productos"
          className="z-10 mt-1 flex flex-col gap-1 rounded-md border border-border bg-background p-2 shadow-sm"
        >
          {isLoading && products.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">Buscando productos…</p>
          )}

          {!isLoading && products.length === 0 && trimmedQuery.length > 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Sin coincidencias para &ldquo;{trimmedQuery}&rdquo;.
            </p>
          )}

          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              role="option"
              aria-selected={value?.id === product.id}
              onClick={() => handleSelect(product)}
              className="flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <span>{product.name}</span>
              <span className="text-xs text-muted-foreground">
                {UNIT_SHORT_LABELS[product.defaultUnit]}
              </span>
            </button>
          ))}

          {canCreateOnTheFly && (
            <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <select
                aria-label="Unidad del nuevo producto"
                value={unitForCreate}
                onChange={(e) => setCustomUnit(e.target.value as Unit)}
                className="h-9 rounded-md border border-border bg-background px-2 text-xs"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={createMutation.isPending}
                onClick={() => void handleCreateOnTheFly()}
              >
                {`Crear "${trimmedQuery}"`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
