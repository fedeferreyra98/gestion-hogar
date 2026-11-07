import type { Decimal } from '@/api/types'

/** API `Decimal` quantities: non-negative, at most 3 decimals (same contract as the backend). */
export const MAX_DECIMALS = 3
const DECIMAL_RE = /^\d+(\.\d+)?$/

/** Normalizes user input (trims, accepts a decimal comma) to the API `Decimal` format. */
export function normalizeDecimal(input: string): string {
  return input.trim().replace(',', '.')
}

export function isPositiveDecimal(value: string): boolean {
  return DECIMAL_RE.test(value) && /[1-9]/.test(value)
}

/** Number of digits after the decimal point. */
export function decimalPlaces(value: string): number {
  return value.split('.')[1]?.length ?? 0
}

function scaled(value: string, scale: number): bigint {
  const [int, frac = ''] = value.split('.')
  return BigInt(int + frac.padEnd(scale, '0'))
}

/** Compares two non-negative decimal strings without floats. */
export function compareDecimal(a: Decimal, b: Decimal): number {
  const scale = Math.max(decimalPlaces(a), decimalPlaces(b))
  const x = scaled(a, scale)
  const y = scaled(b, scale)
  return x === y ? 0 : x < y ? -1 : 1
}

/** Strips trailing zeros for display: "2.500" -> "2,5", "3.000" -> "3". */
export function formatDecimal(value: Decimal): string {
  if (!value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')
}
