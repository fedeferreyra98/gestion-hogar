import type { Decimal } from '@/api/types'

const DECIMAL_RE = /^\d+(\.\d+)?$/

export function isPositiveDecimal(value: string): boolean {
  return DECIMAL_RE.test(value) && /[1-9]/.test(value)
}

/** Normalizes user input (accepts a decimal comma) to the API `Decimal` format. */
export function normalizeDecimal(input: string): string {
  return input.trim().replace(',', '.')
}

function scaled(value: string, scale: number): bigint {
  const [int, frac = ''] = value.split('.')
  return BigInt(int + frac.padEnd(scale, '0'))
}

/** Compares two non-negative decimal strings without floats. */
export function compareDecimal(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0)
  const x = scaled(a, scale)
  const y = scaled(b, scale)
  return x === y ? 0 : x < y ? -1 : 1
}

/** Strips trailing zeros for display: "2.500" -> "2.5", "3.000" -> "3". */
export function formatDecimal(value: Decimal): string {
  if (!value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')
}
