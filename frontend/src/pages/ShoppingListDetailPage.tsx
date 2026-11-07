import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { isProblemError } from '@/api/errors'
import {
  useAddShoppingListItem,
  useArchiveShoppingList,
  useDeleteShoppingListItem,
  useDuplicateShoppingList,
  useShoppingList,
  useToggleShoppingListItem,
} from '@/api/hooks/useShoppingLists'
import type { Product, Unit } from '@/api/types'
import { ProductPicker } from '@/catalog'
import { UNITS, UNIT_LABELS, UNIT_SHORT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { STATUS_LABELS, problemMessage } from '@/shopping/status'

const QUANTITY_RE = /^\d{1,9}(\.\d{1,3})?$/

function parseQuantity(raw: string): string | null {
  const normalized = raw.trim().replace(',', '.')
  if (!QUANTITY_RE.test(normalized) || Number(normalized) <= 0) return null
  return normalized
}

export function ShoppingListDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: list, isLoading, isError, error: loadError, refetch } = useShoppingList(id)

  const toggle = useToggleShoppingListItem(id)
  const addItem = useAddShoppingListItem(id)
  const deleteItem = useDeleteShoppingListItem(id)
  const duplicate = useDuplicateShoppingList()
  const archive = useArchiveShoppingList()

  const [product, setProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<Unit>('UNIT')
  const [message, setMessage] = useState<string | null>(null)

  if (isLoading) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Cargando lista…
      </p>
    )
  }
  if (isError || !list) {
    const notFound = isProblemError(loadError) && loadError.status === 404
    return (
      <section className="flex flex-col gap-3">
        <div role="alert" className="text-sm text-red-600">
          {notFound ? 'No encontramos esa lista.' : 'No pudimos cargar la lista.'}
        </div>
        <div className="flex gap-2">
          {!notFound && (
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              Reintentar
            </Button>
          )}
          <Link to="/listas" className="text-sm underline">
            Volver a las listas
          </Link>
        </div>
      </section>
    )
  }

  const isOpen = list.status === 'OPEN'
  const checkedCount = list.items.filter((i) => i.checked).length
  // Sin tildar primero, luego tildados (orden estable; el servidor usa el mismo criterio).
  const items = [...list.items.filter((i) => !i.checked), ...list.items.filter((i) => i.checked)]

  function handleSelectProduct(p: Product) {
    setProduct(p)
    setUnit(p.defaultUnit)
    setMessage(null)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!product) {
      setMessage('Elegí un producto para agregar.')
      return
    }
    const qty = parseQuantity(quantity)
    if (!qty) {
      setMessage('La cantidad debe ser un número mayor a 0 (hasta 3 decimales).')
      return
    }
    setMessage(null)
    try {
      await addItem.mutateAsync({ productId: product.id, quantity: qty, unit })
      setProduct(null)
      setQuantity('1')
    } catch (err) {
      setMessage(problemMessage(err, 'No pudimos agregar el producto.'))
    }
  }

  function handleToggle(itemId: string, checked: boolean) {
    setMessage(null)
    toggle.mutate(
      { itemId, checked },
      { onError: (err) => setMessage(problemMessage(err, 'No pudimos actualizar el ítem.')) },
    )
  }

  function handleDelete(itemId: string) {
    setMessage(null)
    deleteItem.mutate(itemId, {
      onError: (err) => setMessage(problemMessage(err, 'No pudimos quitar el ítem.')),
    })
  }

  async function handleDuplicate() {
    setMessage(null)
    try {
      const copy = await duplicate.mutateAsync(list!.id)
      void navigate(`/listas/${copy.id}`)
    } catch {
      setMessage('No pudimos duplicar la lista.')
    }
  }

  async function handleArchive() {
    if (!window.confirm(`¿Archivar la lista "${list!.name}"? Quedará de solo lectura.`)) return
    setMessage(null)
    try {
      await archive.mutateAsync(list!.id)
      await refetch()
    } catch (err) {
      setMessage(problemMessage(err, 'No pudimos archivar la lista.'))
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link to="/listas" className="text-sm underline">
          ← Listas
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold">{list.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span>{STATUS_LABELS[list.status]}</span> ·{' '}
          <span aria-live="polite">
            {checkedCount} de {list.items.length} tildados
          </span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={duplicate.isPending}
          onClick={() => void handleDuplicate()}
        >
          Duplicar lista
        </Button>
        {isOpen && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={archive.isPending}
            onClick={() => void handleArchive()}
          >
            Archivar lista
          </Button>
        )}
      </div>

      {isOpen ? (
        <form
          onSubmit={(e) => void handleAdd(e)}
          aria-label="Agregar producto"
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <ProductPicker value={product} onSelect={handleSelectProduct} />
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="item-quantity" className="text-sm font-medium">
                Cantidad
              </label>
              <input
                id="item-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-10 w-24 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="item-unit" className="text-sm font-medium">
                Unidad
              </label>
              <select
                id="item-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
                className="h-10 rounded-md border border-border bg-background px-2 text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={addItem.isPending}>
              Agregar
            </Button>
          </div>
        </form>
      ) : (
        <p role="note" className="rounded-md border border-border bg-accent p-3 text-sm">
          Esta lista está {STATUS_LABELS[list.status].toLowerCase()} y es de solo lectura.
        </p>
      )}

      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">La lista no tiene ítems todavía.</p>
      ) : (
        <ul aria-label="Ítems de la lista" className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <input
                id={`item-${item.id}`}
                type="checkbox"
                checked={item.checked}
                disabled={!isOpen}
                onChange={(e) => handleToggle(item.id, e.target.checked)}
                className="size-6 shrink-0"
              />
              <label
                htmlFor={`item-${item.id}`}
                className={`min-w-0 flex-1 break-words text-sm ${item.checked ? 'text-muted-foreground line-through' : ''}`}
              >
                <span className="font-medium">{item.product.name}</span>{' '}
                <span>
                  {Number(item.quantity)} {UNIT_SHORT_LABELS[item.unit]}
                </span>
                {item.note && <span className="block text-xs">{item.note}</span>}
              </label>
              {isOpen && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Quitar ${item.product.name}`}
                  onClick={() => handleDelete(item.id)}
                >
                  Quitar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
