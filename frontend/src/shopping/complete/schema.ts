import { z } from 'zod'
import type { CompleteListRequest, Unit } from '@/api/types'
import { isValidIsoDate } from '@/expenses/dates'
import { normalizeDecimal } from '@/lib/decimal'
import { lineTotalMinor, parseMoneyToMinor } from '@/lib/money'
import { validateExpiryDate, validateQuantity } from '@/stock/validation'

/** Valores del formulario: todo string, tal como se escribe (es-AR: coma decimal). */
export interface ItemValues {
  listItemId: string
  productId: string
  name: string
  unit: Unit
  quantity: string
  unitPrice: string
  expiryDate: string
}

export interface WizardValues {
  items: ItemValues[]
  purchaseDate: string
  store: string
  paidBy: string
  /** Texto del total, solo cuando la persona lo editó; si es `null` rige la suma de las líneas. */
  totalOverride: string | null
  leftoverAction: 'NEW_LIST' | 'DISCARD'
}

export const MIN_DATE = '1900-01-01'
export const MAX_DATE = '2100-12-31'

const itemSchema = (currency: string) =>
  z
    .object({
      listItemId: z.string().min(1),
      productId: z.string().min(1),
      unit: z.enum(['UNIT', 'KG', 'G', 'L', 'ML', 'PACK']),
      quantity: z
        .string()
        .transform(normalizeDecimal)
        .superRefine((value, ctx) => {
          const message = validateQuantity(value)
          if (message) ctx.addIssue({ code: 'custom', message })
        }),
      unitPrice: z.string().transform((value, ctx) => {
        const minor = parseMoneyToMinor(value, currency)
        if (minor === null) {
          ctx.addIssue({
            code: 'custom',
            message: 'Ingresá un precio con coma decimal (ej. 1.500,50).',
          })
          return z.NEVER
        }
        return minor
      }),
      expiryDate: z.string().superRefine((value, ctx) => {
        const message = validateExpiryDate(value)
        if (message) ctx.addIssue({ code: 'custom', message })
      }),
    })
    .superRefine((item, ctx) => {
      if (
        validateQuantity(item.quantity) === null &&
        lineTotalMinor(item.quantity, item.unitPrice) === null
      )
        ctx.addIssue({
          code: 'custom',
          path: ['unitPrice'],
          message: 'El importe es demasiado grande.',
        })
    })

export const itemsStepSchema = (currency: string) =>
  z.object({
    items: z.array(itemSchema(currency)).min(1, 'Tildá al menos un ítem para registrar la compra.'),
  })

export const detailsStepSchema = (currency: string) =>
  z.object({
    purchaseDate: z
      .string()
      .refine((v) => isValidIsoDate(v), 'Elegí una fecha válida.')
      .refine((v) => v >= MIN_DATE && v <= MAX_DATE, 'El año debe estar entre 1900 y 2100.'),
    store: z.string().trim().max(255, 'Máximo 255 caracteres.'),
    paidBy: z.string().min(1, 'Elegí quién pagó.'),
    total: z.string().transform((value, ctx) => {
      const minor = parseMoneyToMinor(value, currency)
      if (minor === null || minor <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Ingresá un total mayor a cero con coma decimal (ej. 1.500,50).',
        })
        return z.NEVER
      }
      return minor
    }),
  })

export const leftoverStepSchema = z.object({
  leftoverAction: z.enum(['NEW_LIST', 'DISCARD'], {
    message: 'Elegí qué hacer con los pendientes.',
  }),
})

export type StepNumber = 1 | 2 | 3

/** Suma de `round(cantidad × precio)` por línea, en enteros; `null` si alguna línea es inválida. */
export function sumLinesMinor(items: ItemValues[], currency: string): number | null {
  let sum = 0
  for (const item of items) {
    const price = parseMoneyToMinor(item.unitPrice, currency)
    const line = price === null ? null : lineTotalMinor(normalizeDecimal(item.quantity), price)
    if (line === null || validateQuantity(normalizeDecimal(item.quantity)) !== null) return null
    sum += line
    if (!Number.isSafeInteger(sum)) return null
  }
  return sum
}

/** `items.0.quantity` — mismo formato que usa el mapeo de errores del servidor. */
export function issuePath(path: PropertyKey[]): string {
  return path.map(String).join('.')
}

export type FieldErrors = Record<string, string>

function collect(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issuePath(issue.path) || 'form'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

/** Valida un paso; devuelve los errores por campo (vacío si es válido). */
export function validateStep(
  step: StepNumber,
  values: WizardValues,
  currency: string,
  totalText: string,
): FieldErrors {
  const result =
    step === 1
      ? itemsStepSchema(currency).safeParse({ items: values.items })
      : step === 2
        ? detailsStepSchema(currency).safeParse({
            purchaseDate: values.purchaseDate,
            store: values.store,
            paidBy: values.paidBy,
            total: totalText,
          })
        : leftoverStepSchema.safeParse({ leftoverAction: values.leftoverAction })
  return result.success ? {} : collect(result.error)
}

/** Arma el body de `POST /shopping-lists/{id}/complete`; `null` si algún paso es inválido. */
export function buildRequest(
  values: WizardValues,
  currency: string,
  totalText: string,
): CompleteListRequest | null {
  const items = itemsStepSchema(currency).safeParse({ items: values.items })
  const details = detailsStepSchema(currency).safeParse({
    purchaseDate: values.purchaseDate,
    store: values.store,
    paidBy: values.paidBy,
    total: totalText,
  })
  const leftover = leftoverStepSchema.safeParse({ leftoverAction: values.leftoverAction })
  if (!items.success || !details.success || !leftover.success) return null
  const store = details.data.store
  return {
    purchaseDate: details.data.purchaseDate,
    ...(store ? { store } : {}),
    paidBy: details.data.paidBy,
    total: { amountMinor: details.data.total, currency },
    items: items.data.items.map((item, index) => ({
      listItemId: item.listItemId,
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: { amountMinor: item.unitPrice, currency },
      ...(values.items[index]?.expiryDate ? { expiryDate: values.items[index].expiryDate } : {}),
    })),
    leftoverAction: leftover.data.leftoverAction,
  }
}

export function stepForField(key: string): StepNumber {
  if (key.startsWith('items')) return 1
  if (key === 'leftoverAction') return 3
  return 2
}
