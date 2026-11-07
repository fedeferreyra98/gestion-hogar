import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { isProblemError } from '@/api/errors'
import {
  useAddShoppingListItem,
  useArchiveShoppingList,
  useDuplicateShoppingList,
  useShoppingList,
} from '@/api/hooks/useShoppingLists'
import type { Product, Unit } from '@/api/types'
import { ProductPicker } from '@/catalog'
import { UNITS, UNIT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { formatMinor } from '@/lib/money'
import type { PurchaseCompletedState } from '@/shopping/complete/CompleteListWizard'
import { ArchiveAction } from '@/shopping/ArchiveAction'
import { parseQuantity } from '@/shopping/quantity'
import { ShoppingItemRow } from '@/shopping/ShoppingItemRow'
import { STATUS_LABELS, problemMessage } from '@/shopping/status'

export function ShoppingListDetailPage() {
  const { id = '' } = useParams()
  // key: reset the quick-add form when navigating between lists (e.g. after duplicating).
  return <ShoppingListDetail key={id} id={id} />
}

const PICKER_ID = 'item-product'

function ShoppingListDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [completed] = useState(
    () => (location.state as Partial<PurchaseCompletedState> | null)?.purchaseCompleted,
  )
  // El aviso se muestra una vez: se limpia el state del history para que no reaparezca al recargar.
  useEffect(() => {
    if (completed) void navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { data: list, isLoading, isError, error: loadError, refetch } = useShoppingList(id)

  const addItem = useAddShoppingListItem(id)
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
      document.getElementById(PICKER_ID)?.focus()
    } catch (err) {
      setMessage(problemMessage(err, 'No pudimos agregar el producto.'))
    }
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
    setMessage(null)
    try {
      await archive.mutateAsync(list!.id)
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
        {isOpen &&
          (checkedCount === 0 ? (
            <Button type="button" size="sm" disabled aria-describedby="finish-hint">
              Finalizar compra
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to={`/listas/${list.id}/finalizar`}>Finalizar compra</Link>
            </Button>
          ))}
        {isOpen && (
          <ArchiveAction
            label="Archivar lista"
            confirmAriaLabel={`Confirmar archivar ${list.name}`}
            disabled={archive.isPending}
            onConfirm={() => void handleArchive()}
          />
        )}
      </div>

      {isOpen && checkedCount === 0 && (
        <p id="finish-hint" className="text-xs text-muted-foreground">
          Tildá los ítems que compraste para poder finalizar la compra.
        </p>
      )}

      {completed && (
        <p role="status" className="rounded-md border border-border bg-accent p-3 text-sm">
          Compra registrada por {completed.currency}{' '}
          {formatMinor(completed.amountMinor, completed.currency)}.
          {completed.leftoverListCreated && ' Los ítems pendientes quedaron en una lista nueva. '}
          <Link to="/gastos" className="underline">
            Ver gastos
          </Link>
          {completed.leftoverListCreated && (
            <>
              {' · '}
              <Link to="/listas" className="underline">
                Ver listas
              </Link>
            </>
          )}
        </p>
      )}

      {isOpen ? (
        <form
          onSubmit={(e) => void handleAdd(e)}
          aria-label="Agregar producto"
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <ProductPicker
            id={PICKER_ID}
            value={product}
            onSelect={handleSelectProduct}
            onQueryChange={(q) => {
              if (product && q !== product.name) setProduct(null)
            }}
          />
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
            <Button type="submit" disabled={addItem.isPending || !product}>
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
            <ShoppingItemRow
              key={item.id}
              listId={list.id}
              item={item}
              readOnly={!isOpen}
              onMessage={setMessage}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
