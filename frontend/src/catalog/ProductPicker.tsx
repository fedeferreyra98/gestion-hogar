import { useId, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { isProblemError } from '@/api/errors'
import { useCreateProduct, useProducts } from '@/api/hooks/useCatalog'
import type { Product, Unit } from '@/api/types'
import { UNITS, UNIT_LABELS, UNIT_SHORT_LABELS } from '@/catalog/units'
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

const CREATE_OPTION = 'create'

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
  const errorId = `${inputId}-error`
  const isControlled = value !== undefined

  const [query, setQuery] = useState(() => value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [customUnit, setCustomUnit] = useState<Unit | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sync the text with external changes of `value` (adjusting state during render).
  const valueId = value?.id ?? null
  const [prevValueId, setPrevValueId] = useState(valueId)
  if (prevValueId !== valueId) {
    setPrevValueId(valueId)
    if (isControlled) setQuery(value?.name ?? '')
  }

  const unitForCreate = customUnit ?? defaultUnit

  const trimmedQuery = query.trim()
  const debouncedQuery = useDebouncedValue(trimmedQuery, debounceMs)

  const { data, isFetching, isError, refetch } = useProducts(
    {
      q: debouncedQuery || undefined,
      // Archived products keep their name reserved: they must be visible (as unavailable).
      includeArchived: true,
      size: 10,
    },
    { enabled: open && !disabled },
  )

  const createMutation = useCreateProduct()
  const products = data?.content ?? []

  // Results only correspond to what the user typed once debounce and fetch settled.
  const settled =
    open && data !== undefined && !isError && !isFetching && trimmedQuery === debouncedQuery

  const hasExactMatch =
    trimmedQuery.length > 0 &&
    products.some((p) => p.name.trim().toLowerCase() === trimmedQuery.toLowerCase())
  const canCreateOnTheFly = settled && trimmedQuery.length > 0 && !hasExactMatch

  const enabledKeys = [
    ...products.filter((p) => !p.archived).map((p) => p.id),
    ...(canCreateOnTheFly ? [CREATE_OPTION] : []),
  ]
  const activeValid = activeKey !== null && enabledKeys.includes(activeKey)
  const optionId = (key: string) => `${listboxId}-opt-${key}`

  const showDropdown = open && !disabled && trimmedQuery.length + products.length > 0
  const showStatus = showDropdown || (open && isError)

  function closeDropdown() {
    setOpen(false)
    setActiveKey(null)
  }

  function handleSelect(product: Product) {
    if (product.archived) return
    setError(null)
    setQuery(isControlled ? product.name : '')
    closeDropdown()
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
      setQuery(isControlled ? created.name : '')
      setCustomUnit(null)
      closeDropdown()
      onSelect(created)
    } catch (err) {
      if (isProblemError(err) && err.status === 409) {
        setError('Ya existe un producto con ese nombre.')
      } else {
        setError('No pudimos crear el producto. Intentá de nuevo.')
      }
    }
  }

  function activate(key: string) {
    if (key === CREATE_OPTION) void handleCreateOnTheFly()
    else {
      const product = products.find((p) => p.id === key)
      if (product) handleSelect(product)
    }
  }

  function move(delta: 1 | -1) {
    if (enabledKeys.length === 0) return
    const current = activeValid ? enabledKeys.indexOf(activeKey) : -1
    const next =
      current === -1
        ? delta === 1
          ? 0
          : enabledKeys.length - 1
        : (current + delta + enabledKeys.length) % enabledKeys.length
    setActiveKey(enabledKeys[next] ?? null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) setOpen(true)
        else move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) setOpen(true)
        else move(-1)
        break
      case 'Enter':
        if (showDropdown && activeValid && activeKey) {
          e.preventDefault()
          activate(activeKey)
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          closeDropdown()
        }
        break
    }
  }

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) closeDropdown()
  }

  return (
    <div className="relative flex flex-col gap-1" onBlur={handleBlur}>
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && activeValid && activeKey ? optionId(activeKey) : undefined
        }
        aria-autocomplete="list"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled || createMutation.isPending}
        value={query}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onChange={(e) => {
          setError(null)
          setQuery(e.target.value)
          setActiveKey(null)
          setOpen(true)
        }}
        className="h-10 rounded-md border border-border bg-background px-3 text-sm"
      />

      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {showStatus && !disabled && (
        <div className="z-10 mt-1 flex flex-col gap-1 rounded-md border border-border bg-background p-2 shadow-sm">
          {isError && (
            <div role="alert" className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-xs text-red-600">No pudimos buscar productos.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </div>
          )}

          {!isError && !settled && (
            <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
              Buscando productos…
            </p>
          )}

          {settled && products.length === 0 && trimmedQuery.length > 0 && (
            <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
              Sin coincidencias para &ldquo;{trimmedQuery}&rdquo;.
            </p>
          )}

          {showDropdown && !isError && (
            <div
              id={listboxId}
              role="listbox"
              aria-label="Resultados de productos"
              className="flex flex-col gap-1"
              onMouseDown={(e) => e.preventDefault()}
            >
              {products.map((product) => (
                <div
                  key={product.id}
                  id={optionId(product.id)}
                  role="option"
                  aria-selected={value?.id === product.id}
                  aria-disabled={product.archived ? true : undefined}
                  onClick={() => handleSelect(product)}
                  className={
                    product.archived
                      ? 'flex cursor-not-allowed items-center justify-between rounded px-2 py-1.5 text-sm text-muted-foreground'
                      : `flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground ${
                          activeKey === product.id ? 'bg-accent text-accent-foreground' : ''
                        }`
                  }
                >
                  <span className={product.archived ? 'line-through' : undefined}>
                    {product.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {product.archived
                      ? 'No disponible (archivado)'
                      : UNIT_SHORT_LABELS[product.defaultUnit]}
                  </span>
                </div>
              ))}

              {canCreateOnTheFly && (
                <div
                  id={optionId(CREATE_OPTION)}
                  role="option"
                  aria-selected={false}
                  aria-disabled={createMutation.isPending ? true : undefined}
                  onClick={() => void handleCreateOnTheFly()}
                  className={`cursor-pointer rounded px-2 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground ${
                    activeKey === CREATE_OPTION ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  {`Crear "${trimmedQuery}"`}
                </div>
              )}
            </div>
          )}

          {canCreateOnTheFly && (
            <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <label htmlFor={`${inputId}-unit`} className="text-xs text-muted-foreground">
                Unidad del nuevo producto
              </label>
              <select
                id={`${inputId}-unit`}
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
