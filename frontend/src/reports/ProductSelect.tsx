import { useId, useState } from 'react'
import { useProducts } from '@/api/hooks/useCatalog'
import type { Product } from '@/api/types'
import { UNIT_SHORT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

interface Props {
  value: Product | null
  onSelect: (product: Product | null) => void
}

/**
 * Selector de producto de SOLO lectura para reportes: no crea productos y deja elegir los
 * archivados (el histórico de precios los incluye), marcados como tales.
 */
export function ProductSelect({ value, onSelect }: Props) {
  const inputId = useId()
  const [text, setText] = useState('')
  const query = text.trim()
  const debounced = useDebouncedValue(query, 300)
  const { data, isError, isFetching, refetch } = useProducts(
    { q: debounced, includeArchived: true, size: 10 },
    { enabled: debounced.length > 0 },
  )

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          Producto: <strong>{value.name}</strong>
          {value.archived ? ' (archivado)' : ''}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setText('')
            onSelect(null)
          }}
        >
          Cambiar producto
        </Button>
      </div>
    )
  }

  const settled = debounced === query && data !== undefined && !isFetching
  const products = data?.content ?? []
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Buscar producto
      </label>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        className="h-10 rounded-md border border-border bg-background px-3 text-sm sm:w-80"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {query.length === 0 ? null : isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
          <span>No pudimos buscar productos.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      ) : !settled ? (
        <p role="status" className="text-sm text-muted-foreground">
          Buscando productos…
        </p>
      ) : products.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Sin coincidencias para “{query}”.
        </p>
      ) : (
        <ul aria-label="Resultados de productos" className="flex flex-col gap-1">
          {products.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p)}
                className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring sm:w-80"
              >
                <span>
                  {p.name}
                  {p.archived ? ' (archivado)' : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  {UNIT_SHORT_LABELS[p.defaultUnit] ?? p.defaultUnit}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
