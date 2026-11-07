import type { ProblemError } from '@/api/errors'
import type { FieldErrors } from './schema'

export interface CompleteProblem {
  /** Mensaje general en español (nunca el texto del servidor, que viene en inglés). */
  message: string
  /** Errores por campo, con las mismas claves que el cliente (`items.0.quantity`, `total`…). */
  fields: FieldErrors
  /** La lista ya no está abierta: se completó (quizá por un reintento) o se archivó. */
  listNotOpen: boolean
  notFound: boolean
}

const CHANGED_MESSAGE =
  'La lista cambió o algún ítem ya no es válido. Volvé a la lista y reintentá.'

const ITEM_MESSAGES: Record<string, string> = {
  quantity: 'La cantidad no es válida (mayor a cero, hasta 3 decimales).',
  unitPrice: 'El precio no es válido.',
  expiryDate: 'El vencimiento no es válido (o hay que informarlo para este producto).',
}

const TOP_MESSAGES: Record<string, string> = {
  purchaseDate: 'La fecha no es válida.',
  store: 'El comercio no es válido.',
  paidBy: 'Elegí un miembro activo del hogar como pagador.',
  total: 'El total no es válido: debe ser mayor a cero.',
  leftoverAction: 'Elegí qué hacer con los pendientes.',
}

/** `items[2].unitPrice.amountMinor` | `items.2.unitPrice` → `items.2.unitPrice`; otro → raíz. */
export function normalizeServerField(field: string): string | null {
  const item = /^items(?:\[(\d+)\]|\.(\d+))\.(\w+)/.exec(field)
  // Solo los subcampos que el wizard muestra; productId/listItemId/unit → mensaje general.
  if (item)
    return (item[3] ?? '') in ITEM_MESSAGES ? `items.${item[1] ?? item[2]}.${item[3]}` : null
  const root = field.split('.')[0] ?? ''
  return root in TOP_MESSAGES ? root : null
}

function messageFor(key: string, field: string): string {
  const parts = key.split('.')
  if (parts[0] === 'items') {
    if (parts[2] === 'unitPrice' && field.endsWith('currency'))
      return 'La moneda no coincide con la del hogar.'
    return ITEM_MESSAGES[parts[2] ?? ''] ?? 'Revisá este ítem.'
  }
  if (key === 'total' && field.endsWith('currency'))
    return 'La moneda no coincide con la del hogar.'
  return TOP_MESSAGES[key] ?? 'Revisá este dato.'
}

/** Traduce un error de `POST /shopping-lists/{id}/complete` a mensajes en español por campo. */
export function mapCompleteProblem(error: ProblemError, fallback: string): CompleteProblem {
  const fields: FieldErrors = {}
  let unmapped = false
  for (const item of error.errors) {
    const key = item.field ? normalizeServerField(item.field) : null
    if (!key || !item.field) unmapped = true
    else if (!fields[key]) fields[key] = messageFor(key, item.field)
  }
  const base = { fields, listNotOpen: false, notFound: false }

  if (error.status === 422 && error.code === 'LIST_NOT_OPEN')
    return {
      ...base,
      listNotOpen: true,
      message:
        'Esta lista ya fue completada o archivada, así que no se puede registrar la compra de nuevo. Es posible que la compra ya se haya registrado: revisá los gastos.',
    }
  if (error.status === 404)
    return {
      ...base,
      notFound: true,
      message: 'No encontramos la lista o alguno de sus productos (pudo haberse eliminado).',
    }
  if (error.status === 422 && error.code === 'UNSUPPORTED_CURRENCY')
    return {
      ...base,
      fields: { ...fields, total: fields.total ?? 'La moneda no coincide con la del hogar.' },
      message: 'La moneda de los importes no coincide con la moneda del hogar.',
    }
  if (error.status === 400)
    return {
      ...base,
      message: unmapped
        ? CHANGED_MESSAGE
        : Object.keys(fields).length > 0
          ? ''
          : 'Revisá los datos de la compra.',
    }
  if (error.status === 409)
    return {
      ...base,
      message: 'La lista cambió mientras la completabas. Volvé a la lista y reintentá.',
    }
  return { ...base, message: fallback }
}
