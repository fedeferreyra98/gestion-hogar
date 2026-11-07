import type { ProblemError } from '@/api/errors'

export type FormField = 'description' | 'amount' | 'expenseDate' | 'categoryId' | 'paidBy'

export interface MappedProblem {
  /** Mensaje general (en español); nunca el texto del servidor, que viene en inglés. */
  message: string
  /** Errores por campo del formulario (en español). */
  fields: Partial<Record<FormField, string>>
}

const FIELD_MESSAGES: Record<FormField, string> = {
  description: 'La descripción no es válida (obligatoria, hasta 255 caracteres).',
  amount: 'El monto no es válido: debe ser mayor a cero.',
  expenseDate: 'La fecha no es válida.',
  categoryId: 'La categoría elegida ya no existe.',
  paidBy: 'Elegí un miembro activo del hogar como pagador.',
}

/** Normaliza el `field` del servidor ("amount.amountMinor", "amount.currency"…) al campo del form. */
export function toFormField(field: string): FormField | null {
  const root = field.split('.')[0] ?? ''
  switch (root) {
    case 'description':
    case 'amount':
    case 'expenseDate':
    case 'categoryId':
    case 'paidBy':
      return root
    default:
      return null
  }
}

/** Traduce un error de la API de gastos a mensajes en español mapeados a los campos del form. */
export function mapExpenseProblem(error: ProblemError, fallback: string): MappedProblem {
  const fields: MappedProblem['fields'] = {}
  for (const item of error.errors) {
    const field = item.field ? toFormField(item.field) : null
    if (field && !fields[field]) {
      fields[field] =
        item.field === 'amount.currency'
          ? 'La moneda no coincide con la del hogar.'
          : FIELD_MESSAGES[field]
    }
  }

  if (error.status === 409)
    return {
      fields,
      message:
        'El gasto cambió o proviene de una compra, y no se puede modificar. Volvé al listado y reintentá.',
    }
  if (error.status === 404) return { fields, message: 'El gasto ya no existe o fue eliminado.' }
  if (error.status === 422 && error.code === 'UNSUPPORTED_CURRENCY')
    return { fields: { ...fields, amount: 'La moneda no coincide con la del hogar.' }, message: '' }
  if (error.status === 400)
    return {
      fields,
      message: Object.keys(fields).length > 0 ? '' : 'Revisá los datos del formulario.',
    }
  return { fields, message: fallback }
}
