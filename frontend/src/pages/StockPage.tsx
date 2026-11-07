import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
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
import { compareDecimal, formatDecimal, normalizeDecimal } from '@/lib/decimal'
import { EXPIRY_META } from '@/stock/expiry'
import { ExpiryBadge } from '@/stock/ExpiryBadge'
import { validateExpiryDate, validateQuantity } from '@/stock/validation'

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
    if (err.status === 404) return 'No encontramos ese lote. Actualizamos la lista.'
  }
  return 'No pudimos completar la acción. Intentá de nuevo.'
}

interface ActionError {
  itemId: string
  message: string
}

export function StockPage() {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch } = useStock({ page, size: PAGE_SIZE })
  const { data: alerts } = useStockAlerts()
  const consume = useConsumeStockItem()
  const discard = useDiscardStockItem()

  const [actionError, setActionError] = useState<ActionError | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const titleRef = useRef<HTMLHeadingElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const discardRefs = useRef(new Map<string, HTMLButtonElement>())
  // Item whose "Descartar" button must get the focus back after cancelling.
  const refocusDiscardId = useRef<string | null>(null)

  const items = data?.content ?? []
  const totalPages = data?.totalPages ?? 0
  const busy = consume.isPending || discard.isPending

  // Clamp to the last existing page (e.g. after emptying the last page), adjusting state
  // during render.
  if (data && totalPages > 0 && page > totalPages - 1) setPage(totalPages - 1)

  // Keyboard/screen reader focus management for the inline discard confirmation.
  useEffect(() => {
    if (confirmingId) {
      confirmRef.current?.focus()
    } else if (refocusDiscardId.current) {
      discardRefs.current.get(refocusDiscardId.current)?.focus()
      refocusDiscardId.current = null
    }
  }, [confirmingId])

  async function run(itemId: string, action: () => Promise<unknown>) {
    setActionError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setActionError({ itemId, message: describeError(err) })
    }
  }

  function consumeOne(item: StockItem) {
    // -1 never exceeds what is left: consumes min(1, quantity).
    const quantity = compareDecimal(item.quantity, '1') < 0 ? item.quantity : '1'
    void run(item.id, () => consume.mutateAsync({ id: item.id, quantity }))
  }

  function consumeAll(item: StockItem) {
    void run(item.id, () => consume.mutateAsync({ id: item.id, quantity: item.quantity }))
  }

  function cancelDiscard(item: StockItem) {
    refocusDiscardId.current = item.id
    setConfirmingId(null)
  }

  function confirmDiscard(item: StockItem) {
    setConfirmingId(null)
    // The item (and its buttons) disappear: move focus to a stable target.
    titleRef.current?.focus()
    void run(item.id, () => discard.mutateAsync({ id: item.id }))
  }

  const expiredCount = alerts?.expired.length ?? 0
  const soonCount = alerts?.expiringSoon.length ?? 0
  const itemIds = new Set(items.map((i) => i.id))
  const orphanError = actionError && !itemIds.has(actionError.itemId) ? actionError : null
  const hasStock = (data?.totalElements ?? 0) > 0

  return (
    <section className="flex flex-col gap-4" aria-labelledby="stock-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="stock-title" ref={titleRef} tabIndex={-1} className="text-2xl font-semibold">
          Stock
        </h1>
        <Button
          ref={toggleRef}
          type="button"
          onClick={() => {
            setNotice(null)
            setShowForm((v) => !v)
          }}
          aria-expanded={showForm}
          aria-controls="stock-add-form"
        >
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

      {showForm && (
        <AddStockForm
          id="stock-add-form"
          onCreated={(name) => {
            setShowForm(false)
            setNotice(`Agregamos ${name} al stock.`)
            toggleRef.current?.focus()
          }}
        />
      )}

      <p role="status" className="text-sm text-green-800 empty:hidden">
        {notice}
      </p>

      {orphanError && (
        <p
          role="alert"
          className="rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        >
          {orphanError.message}
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

      {data && !isError && !hasStock && (
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
                const inlineError = actionError?.itemId === item.id ? actionError.message : null
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
                    {inlineError && (
                      <p role="alert" className="text-sm text-red-700">
                        {inlineError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {confirming ? (
                        <>
                          <Button
                            ref={confirmRef}
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
                            onClick={() => cancelDiscard(item)}
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
                            ref={(el) => {
                              if (el) discardRefs.current.set(item.id, el)
                              else discardRefs.current.delete(item.id)
                            }}
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Descartar ${name}`}
                            onClick={() => {
                              setActionError(null)
                              setConfirmingId(item.id)
                            }}
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

      {data && totalPages > 1 && (
        <nav aria-label="Paginación del stock" className="flex flex-wrap items-center gap-2">
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
          <span className="text-xs text-muted-foreground">
            Los grupos y contadores corresponden a esta página.
          </span>
        </nav>
      )}
    </section>
  )
}

type FormField = 'product' | 'quantity' | 'unit' | 'expiryDate' | 'location'
type FieldErrors = Partial<Record<FormField, string>>

// Backend field -> form field, with Spanish messages (the API's `message` is English).
const BACKEND_FIELDS: Record<string, { field: FormField; message: string }> = {
  productId: { field: 'product', message: 'Elegí un producto válido.' },
  quantity: { field: 'quantity', message: 'La cantidad no es válida (máximo 3 decimales).' },
  unit: { field: 'unit', message: 'La unidad no es válida.' },
  expiryDate: { field: 'expiryDate', message: 'La fecha de vencimiento no es válida.' },
  location: { field: 'location', message: 'La ubicación no es válida.' },
}

function AddStockForm({ id, onCreated }: { id: string; onCreated: (productName: string) => void }) {
  const uid = useId()
  const create = useCreateStockItem()
  const [product, setProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<Unit>('UNIT')
  const [expiryDate, setExpiryDate] = useState('')
  const [location, setLocation] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  function clear(field: FormField) {
    setErrors((e) => ({ ...e, [field]: undefined }))
    setFormError(null)
  }

  function handleSelect(p: Product) {
    setProduct(p)
    setUnit(p.defaultUnit)
    clear('product')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const qty = normalizeDecimal(quantity)
    const next: FieldErrors = {}
    if (!product) next.product = 'Elegí un producto.'
    const qtyError = validateQuantity(qty)
    if (qtyError) next.quantity = qtyError
    const dateError = validateExpiryDate(expiryDate)
    if (dateError) next.expiryDate = dateError
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0 || !product) return

    try {
      await create.mutateAsync({
        productId: product.id,
        quantity: qty,
        unit,
        ...(expiryDate ? { expiryDate } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
      })
      onCreated(product.name)
    } catch (err) {
      if (isProblemError(err) && err.status === 400) {
        const mapped: FieldErrors = {}
        for (const fe of err.errors) {
          const known = BACKEND_FIELDS[fe.field]
          if (known) mapped[known.field] = known.message
        }
        if (Object.keys(mapped).length > 0) return setErrors(mapped)
        return setFormError('Revisá los datos ingresados.')
      }
      if (isProblemError(err) && err.status === 404) {
        return setErrors({ product: 'Ese producto ya no existe. Elegí otro.' })
      }
      setFormError('No pudimos agregar el stock. Intentá de nuevo.')
    }
  }

  const field = 'h-10 rounded-md border border-border bg-background px-3 text-sm'
  const fieldProps = (name: FormField) => ({
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `${uid}-${name}-error` : undefined,
  })
  const fieldError = (name: FormField) =>
    errors[name] ? (
      <p id={`${uid}-${name}-error`} role="alert" className="text-sm text-red-700">
        {errors[name]}
      </p>
    ) : null

  return (
    <form
      id={id}
      noValidate
      onSubmit={(e) => void handleSubmit(e)}
      aria-label="Agregar stock"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <div>
        <ProductPicker value={product} onSelect={handleSelect} label="Producto" />
        {fieldError('product')}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-qty`} className="text-sm font-medium">
            Cantidad
          </label>
          <input
            id={`${uid}-qty`}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value)
              clear('quantity')
            }}
            className={field}
            {...fieldProps('quantity')}
          />
          {fieldError('quantity')}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-unit`} className="text-sm font-medium">
            Unidad
          </label>
          <select
            id={`${uid}-unit`}
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className={field}
            {...fieldProps('unit')}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
          {fieldError('unit')}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-exp`} className="text-sm font-medium">
            Vencimiento (opcional)
          </label>
          <input
            id={`${uid}-exp`}
            type="date"
            min="1900-01-01"
            max="2999-12-31"
            value={expiryDate}
            onChange={(e) => {
              setExpiryDate(e.target.value)
              clear('expiryDate')
            }}
            className={field}
            {...fieldProps('expiryDate')}
          />
          {fieldError('expiryDate')}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-loc`} className="text-sm font-medium">
            Ubicación (opcional)
          </label>
          <input
            id={`${uid}-loc`}
            value={location}
            onChange={(e) => {
              setLocation(e.target.value)
              clear('location')
            }}
            className={field}
            {...fieldProps('location')}
          />
          {fieldError('location')}
        </div>
      </div>
      {formError && (
        <p role="alert" className="text-sm text-red-700">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={create.isPending}>
        Guardar
      </Button>
    </form>
  )
}
