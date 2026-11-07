import { useId, useState, type FormEvent } from 'react'
import { isProblemError } from '@/api/errors'
import {
  useConsumeStockItem,
  useCreateStockItem,
  useDiscardStockItem,
  useStock,
  useStockAlerts,
} from '@/api/hooks/useStock'
import type { ExpiryStatus, Product, StockItem, Unit } from '@/api/types'
import { ProductPicker } from '@/catalog'
import { UNITS, UNIT_LABELS, UNIT_SHORT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { compareDecimal, formatDecimal, isPositiveDecimal, normalizeDecimal } from '@/stock/decimal'
import { EXPIRY_META, ExpiryBadge } from '@/stock/ExpiryBadge'

const GROUPS: { status: ExpiryStatus; title: string }[] = [
  { status: 'EXPIRED', title: 'Vencidos' },
  { status: 'EXPIRING_SOON', title: 'Por vencer' },
  { status: 'OK', title: 'Vigentes' },
  { status: 'NO_EXPIRY', title: 'Sin vencimiento' },
]

const PAGE_SIZE = 100

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function describeError(err: unknown): string {
  if (isProblemError(err)) {
    if (err.status === 409) return 'Ese lote ya no está activo. Actualizamos la lista.'
    if (err.status === 422) return 'No hay stock suficiente para consumir esa cantidad.'
    if (err.status === 404) return 'No encontramos ese lote.'
  }
  return 'No pudimos completar la acción. Intentá de nuevo.'
}

export function StockPage() {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch } = useStock({ page, size: PAGE_SIZE })
  const { data: alerts } = useStockAlerts()
  const consume = useConsumeStockItem()
  const discard = useDiscardStockItem()

  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const items = data?.content ?? []
  const busy = consume.isPending || discard.isPending

  async function run(action: () => Promise<unknown>) {
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(describeError(err))
    }
  }

  function consumeOne(item: StockItem) {
    // -1 never exceeds what is left: consumes min(1, quantity).
    const quantity = compareDecimal(item.quantity, '1') < 0 ? item.quantity : '1'
    void run(() => consume.mutateAsync({ id: item.id, quantity }))
  }

  function consumeAll(item: StockItem) {
    void run(() => consume.mutateAsync({ id: item.id, quantity: item.quantity }))
  }

  function confirmDiscard(item: StockItem) {
    setConfirmingId(null)
    void run(() => discard.mutateAsync({ id: item.id }))
  }

  const expiredCount = alerts?.expired.length ?? 0
  const soonCount = alerts?.expiringSoon.length ?? 0

  return (
    <section className="flex flex-col gap-4" aria-labelledby="stock-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="stock-title" className="text-2xl font-semibold">
          Stock
        </h1>
        <Button type="button" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
          {showForm ? 'Cerrar' : 'Agregar stock'}
        </Button>
      </div>

      {(expiredCount > 0 || soonCount > 0) && (
        <div
          role="status"
          aria-label="Alertas de vencimiento"
          className="flex flex-col gap-1 rounded-md border border-amber-700 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {expiredCount > 0 && (
            <p>
              <strong>
                {expiredCount === 1 ? '1 lote vencido' : `${expiredCount} lotes vencidos`}
              </strong>
              : {alerts?.expired.map((i) => i.product.name).join(', ')}
            </p>
          )}
          {soonCount > 0 && (
            <p>
              <strong>
                {soonCount === 1 ? '1 lote por vencer' : `${soonCount} lotes por vencer`}
              </strong>
              : {alerts?.expiringSoon.map((i) => i.product.name).join(', ')}
            </p>
          )}
        </div>
      )}

      {showForm && <AddStockForm onCreated={() => setShowForm(false)} />}

      {actionError && (
        <p
          role="alert"
          className="rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        >
          {actionError}
        </p>
      )}

      {isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando stock…
        </p>
      )}

      {isError && (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-700">
          <span>No pudimos cargar el stock.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay stock. Agregá tu primer producto con “Agregar stock”.
        </p>
      )}

      {GROUPS.map(({ status, title }) => {
        const groupItems = items.filter((i) => i.expiryStatus === status)
        if (groupItems.length === 0) return null
        const headingId = `stock-group-${status}`
        const { icon: Icon } = EXPIRY_META[status]
        return (
          <section key={status} aria-labelledby={headingId} className="flex flex-col gap-2">
            <h2 id={headingId} className="flex items-center gap-2 text-lg font-medium">
              <Icon aria-hidden="true" className="size-4" />
              {title} ({groupItems.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {groupItems.map((item) => {
                const unit = UNIT_SHORT_LABELS[item.unit]
                const name = item.product.name
                const confirming = confirmingId === item.id
                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{name}</span>
                      <ExpiryBadge status={item.expiryStatus} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDecimal(item.quantity)} {unit}
                      {item.expiryDate ? ` · Vence ${formatDate(item.expiryDate)}` : ''}
                      {item.location ? ` · ${item.location}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {confirming ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            onClick={() => confirmDiscard(item)}
                          >
                            {`Confirmar descarte de ${name}`}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmingId(null)}
                          >
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Consumir 1 ${unit} de ${name}`}
                            onClick={() => consumeOne(item)}
                          >
                            −1
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Consumir todo ${name}`}
                            onClick={() => consumeAll(item)}
                          >
                            Todo
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Descartar ${name}`}
                            onClick={() => setConfirmingId(item.id)}
                          >
                            Descartar
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {data && data.totalPages > 1 && (
        <nav aria-label="Paginación del stock" className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm">
            Página {page + 1} de {data.totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page + 1 >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </nav>
      )}
    </section>
  )
}

function AddStockForm({ onCreated }: { onCreated: () => void }) {
  const id = useId()
  const create = useCreateStockItem()
  const [product, setProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<Unit>('UNIT')
  const [expiryDate, setExpiryDate] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSelect(p: Product) {
    setProduct(p)
    setUnit(p.defaultUnit)
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const qty = normalizeDecimal(quantity)
    if (!product) return setError('Elegí un producto.')
    if (!isPositiveDecimal(qty)) return setError('Ingresá una cantidad mayor a cero.')
    setError(null)
    try {
      await create.mutateAsync({
        productId: product.id,
        quantity: qty,
        unit,
        ...(expiryDate ? { expiryDate } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
      })
      onCreated()
    } catch {
      setError('No pudimos agregar el stock. Intentá de nuevo.')
    }
  }

  const field = 'h-10 rounded-md border border-border bg-background px-3 text-sm'
  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      aria-label="Agregar stock"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <ProductPicker value={product} onSelect={handleSelect} label="Producto" />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-qty`} className="text-sm font-medium">
            Cantidad
          </label>
          <input
            id={`${id}-qty`}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={field}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-unit`} className="text-sm font-medium">
            Unidad
          </label>
          <select
            id={`${id}-unit`}
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className={field}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-exp`} className="text-sm font-medium">
            Vencimiento (opcional)
          </label>
          <input
            id={`${id}-exp`}
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className={field}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-loc`} className="text-sm font-medium">
            Ubicación (opcional)
          </label>
          <input
            id={`${id}-loc`}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={field}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" disabled={create.isPending}>
        Guardar
      </Button>
    </form>
  )
}
