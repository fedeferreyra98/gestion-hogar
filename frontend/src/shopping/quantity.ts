const QUANTITY_RE = /^\d{1,9}(\.\d{1,3})?$/

/**
 * Parses a user-typed quantity ("1,5" or "1.5") into the API decimal string.
 * Returns null unless it is > 0 with at most 3 decimals (NUMERIC(12,3)).
 * Local helper: to be replaced by the shared `lib/decimal.ts` once PR #74 lands.
 */
export function parseQuantity(raw: string): string | null {
  const normalized = raw.trim().replace(',', '.')
  if (!QUANTITY_RE.test(normalized) || /^0+(\.0*)?$/.test(normalized)) return null
  return normalized
}

/** "1.500" -> "1,5", "2.000" -> "2" (es-AR decimal comma, no float conversion). */
export function formatQuantity(quantity: string): string {
  const [int = '0', frac = ''] = quantity.split('.')
  const trimmed = frac.replace(/0+$/, '')
  return trimmed ? `${int},${trimmed}` : int
}
