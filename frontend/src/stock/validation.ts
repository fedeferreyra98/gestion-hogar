import { MAX_DECIMALS, compareDecimal, decimalPlaces, isPositiveDecimal } from '@/lib/decimal'

// Same limits as the backend (StockService): up to 3 decimals, 999999999.999, 1900..2999.
export const MAX_QUANTITY = '999999999.999'
export const MIN_EXPIRY = '1900-01-01'
export const MAX_EXPIRY = '2999-12-31'

/** `normalized` is the output of `normalizeDecimal`. Returns a Spanish message or null. */
export function validateQuantity(normalized: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 'Ingresá un número, por ejemplo 2 o 2,5.'
  if (decimalPlaces(normalized) > MAX_DECIMALS) return `Usá como máximo ${MAX_DECIMALS} decimales.`
  if (!isPositiveDecimal(normalized)) return 'La cantidad debe ser mayor a cero.'
  if (compareDecimal(normalized, MAX_QUANTITY) > 0) return 'La cantidad es demasiado grande.'
  return null
}

/** Empty is valid (optional). Expects the `YYYY-MM-DD` value of a date input. */
export function validateExpiryDate(value: string): string | null {
  if (value === '') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return 'Ingresá una fecha válida.'
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return 'Ingresá una fecha válida.'
  if (value < MIN_EXPIRY || value > MAX_EXPIRY) return 'El año debe estar entre 1900 y 2999.'
  return null
}
