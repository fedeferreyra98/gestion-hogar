import { MAX_DECIMALS, decimalPlaces, isPositiveDecimal, normalizeDecimal } from '@/lib/decimal'

const MAX_INT_DIGITS = 9

/**
 * Parses a user-typed quantity ("1,5" or "1.5") into the API decimal string.
 * Returns null unless it is > 0 with at most 3 decimals and 9 integer digits (NUMERIC(12,3)).
 */
export function parseQuantity(raw: string): string | null {
  const value = normalizeDecimal(raw)
  if (!isPositiveDecimal(value)) return null
  if (decimalPlaces(value) > MAX_DECIMALS) return null
  if ((value.split('.')[0] ?? '').length > MAX_INT_DIGITS) return null
  return value
}
