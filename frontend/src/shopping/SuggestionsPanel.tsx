import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import {
  shoppingSuggestionsQueryKey,
  useAddShoppingListItem,
  useShoppingSuggestions,
} from '@/api/hooks/useShoppingLists'
import { fetchProducts } from '@/api/hooks/useCatalog'
import type { Suggestion } from '@/api/types'
import { Button } from '@/components/ui/button'
import { problemMessage } from '@/shopping/status'

const REASON_LABELS: Record<Suggestion['reason'], string> = {
  OUT_OF_STOCK: 'Sin stock',
  EXPIRING: 'Por vencer',
  EXPIRED: 'Vencido',
}

/** `YYYY-MM-DD` → `DD/MM/YYYY` (sin pasar por Date: evita corrimientos por zona horaria). */
function formatIsoDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

export function reasonText(s: Suggestion): string {
  const date = s.detail ? formatIsoDate(s.detail) : null
  if (s.reason === 'OUT_OF_STOCK') return REASON_LABELS.OUT_OF_STOCK
  if (!date) return REASON_LABELS[s.reason]
  return s.reason === 'EXPIRED' ? `Vencido el ${date}` : `Vence el ${date}`
}

/**
 * Panel "Te puede faltar": productos sin stock o con lotes vencidos/por vencer que no están en la
 * lista. Solo se monta en listas OPEN. Agregar usa cantidad 1 y la unidad por defecto del producto.
 */
export function SuggestionsPanel({ listId }: { listId: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch, isFetching } = useShoppingSuggestions(listId)
  const addItem = useAddShoppingListItem(listId)
  // El ref bloquea el doble clic de forma síncrona; el state solo pinta el botón deshabilitado.
  const inFlight = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  function setBusy(productId: string, busy: boolean) {
    if (busy) inFlight.current.add(productId)
    else inFlight.current.delete(productId)
    setPending(new Set(inFlight.current))
  }

  async function handleAdd(s: Suggestion) {
    const productId = s.product.id
    if (inFlight.current.has(productId)) return
    setBusy(productId, true)
    setError(null)
    setAdded(null)
    try {
      // La sugerencia solo trae {id, name}: la unidad por defecto sale del catálogo.
      const page = await fetchProducts({ q: s.product.name, size: 100 })
      const product = page.content.find((p) => p.id === productId)
      if (!product) {
        setError(`No pudimos obtener los datos de ${s.product.name}.`)
        return
      }
      await addItem.mutateAsync({ productId, quantity: '1', unit: product.defaultUnit })
      queryClient.setQueryData<Suggestion[]>(shoppingSuggestionsQueryKey(listId), (old) =>
        old?.filter((x) => x.product.id !== productId),
      )
      setAdded(s.product.name)
      // El botón desaparece: el foco pasa al título del panel para no perderlo.
      headingRef.current?.focus()
    } catch (err) {
      setError(problemMessage(err, `No pudimos agregar ${s.product.name}.`))
    } finally {
      setBusy(productId, false)
    }
  }

  let body
  if (isLoading) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        Cargando sugerencias…
      </p>
    )
  } else if (!data) {
    // Error sin datos previos: nunca se muestra como "sin sugerencias".
    body = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-red-600">
          {isError ? 'No pudimos cargar las sugerencias.' : 'No hay datos de sugerencias.'}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </div>
    )
  } else {
    body = (
      <>
        {isError && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-red-600">
              No pudimos actualizar las sugerencias.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              Reintentar
            </Button>
          </div>
        )}
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Por ahora no hay sugerencias: nada te falta según tu stock.
          </p>
        ) : (
          <ul aria-label="Sugerencias" className="flex flex-col gap-1">
            {data.map((s) => (
              <li
                key={s.product.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{s.product.name}</p>
                  <p className="text-xs text-muted-foreground">{reasonText(s)}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Agregar ${s.product.name}`}
                  disabled={pending.has(s.product.id)}
                  onClick={() => void handleAdd(s)}
                >
                  Agregar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <section
      aria-labelledby="suggestions-title"
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <h2 id="suggestions-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold">
        Te puede faltar
      </h2>
      {body}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {added ? `Agregamos ${added} a la lista.` : ''}
      </p>
    </section>
  )
}
