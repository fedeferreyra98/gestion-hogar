import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import {
  shoppingSuggestionsQueryKey,
  useAddShoppingListItem,
  useShoppingSuggestions,
} from '@/api/hooks/useShoppingLists'
import type { Suggestion } from '@/api/types'
import { Button } from '@/components/ui/button'
import { problemMessage } from '@/shopping/status'
import { reasonText } from '@/shopping/suggestionReason'

/** A 375 px hasta 50 sugerencias empujarían la lista real: se muestran 5 y el resto se expande. */
const COLLAPSED_COUNT = 5

interface SuggestionsPanelProps {
  listId: string
  /**
   * Los errores de alta se informan a la página: si el alta revela que la lista ya no está
   * abierta, este panel se desmonta antes de poder mostrarlos.
   */
  onMessage: (message: string | null) => void
}

/**
 * Panel "Te puede faltar": productos sin stock o con lotes vencidos/por vencer que no están en la
 * lista. Solo se monta en listas OPEN. Agregar usa cantidad 1 y la unidad por defecto del producto.
 */
export function SuggestionsPanel({ listId, onMessage }: SuggestionsPanelProps) {
  const queryClient = useQueryClient()
  const { data, isError, refetch, isFetching, fetchStatus } = useShoppingSuggestions(listId)
  const addItem = useAddShoppingListItem(listId)
  const titleId = useId()
  const listDomId = useId()
  // El ref bloquea el doble clic de forma síncrona; el state solo pinta el botón deshabilitado.
  const inFlight = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [added, setAdded] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const restoreFocus = useRef(false)

  // El botón pulsado desaparece con la sugerencia: el foco pasa al título solo si no quedó en
  // otro control (si el usuario ya se movió, no se lo roba).
  useEffect(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    const active = document.activeElement
    if (!active || active === document.body) headingRef.current?.focus()
  }, [data])

  function setBusy(productId: string, busy: boolean) {
    if (busy) inFlight.current.add(productId)
    else inFlight.current.delete(productId)
    setPending(new Set(inFlight.current))
  }

  async function handleAdd(s: Suggestion) {
    const productId = s.product.id
    if (inFlight.current.has(productId)) return
    setBusy(productId, true)
    onMessage(null)
    setAdded(null)
    try {
      await addItem.mutateAsync({ productId, quantity: '1', unit: s.defaultUnit })
      const key = shoppingSuggestionsQueryKey(listId)
      // Un refetch en vuelo (p. ej. por foco de ventana) podría traer la sugerencia de nuevo.
      await queryClient.cancelQueries({ queryKey: key })
      restoreFocus.current = true
      queryClient.setQueryData<Suggestion[]>(key, (old) =>
        old?.filter((x) => x.product.id !== productId),
      )
      setAdded(s.product.name)
    } catch (err) {
      // `mutateAsync` espera el refetch: si la lista dejó de estar abierta este panel ya no existe.
      onMessage(problemMessage(err, `No pudimos agregar ${s.product.name}.`))
    } finally {
      setBusy(productId, false)
    }
  }

  let body
  if (!data && isError) {
    // Error sin datos previos: nunca se muestra como "sin sugerencias".
    body = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-red-600">
          No pudimos cargar las sugerencias.
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
    )
  } else if (!data) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        {fetchStatus === 'paused'
          ? 'Sin conexión: cargaremos las sugerencias cuando vuelva.'
          : 'Cargando sugerencias…'}
      </p>
    )
  } else {
    const visible = expanded ? data : data.slice(0, COLLAPSED_COUNT)
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
          <>
            <ul id={listDomId} aria-label="Sugerencias" className="flex flex-col gap-1">
              {visible.map((s) => (
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
            {data.length > COLLAPSED_COUNT && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="self-start"
                aria-expanded={expanded}
                aria-controls={listDomId}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Ver menos' : `Ver las ${data.length} sugerencias`}
              </Button>
            )}
          </>
        )}
      </>
    )
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-base font-semibold">
        Te puede faltar
      </h2>
      {body}
      <p aria-live="polite" className="sr-only">
        {added ? `Agregamos ${added} a la lista.` : ''}
      </p>
    </section>
  )
}
