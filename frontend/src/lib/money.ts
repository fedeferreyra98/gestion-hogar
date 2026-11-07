/**
 * Dinero siempre como entero en unidades menores + moneda (ADR-004). Nada de float:
 * el parseo y el formato operan sobre strings/enteros.
 */

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'CLP', 'PYG', 'KRW', 'VND'])

/** Cantidad de decimales de la unidad menor (2 para ARS/USD/EUR…, 0 para JPY/CLP…). */
export function minorUnitExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2
}

// Formato es-AR, sin ambigüedad: el punto SOLO agrupa miles (grupos de 3) y la coma es el
// único separador decimal. Un punto como decimal ("12.50") se rechaza en vez de adivinar,
// porque "12.500" (= 12500) y "12.50" (= 12,50) difieren ×1000 con un solo dígito.
const AMOUNT_PATTERN = /^([1-9]\d{0,2}(?:\.\d{3})+|\d+)(?:,(\d+))?$/

/**
 * Parsea un monto escrito por una persona (formato es-AR: "1.500,50") a unidades menores.
 * Devuelve `null` si es inválido, negativo, usa punto decimal, tiene más decimales de los
 * permitidos para la moneda o no es un entero seguro.
 */
export function parseMoneyToMinor(input: string, currency = 'ARS'): number | null {
  const exponent = minorUnitExponent(currency)
  const match = AMOUNT_PATTERN.exec(input.trim().replace(/\s+/g, ''))
  if (!match) return null
  const whole = (match[1] ?? '').replaceAll('.', '')
  const frac = match[2] ?? ''
  if (frac.length > exponent) return null
  const value = Number(whole + frac.padEnd(exponent, '0'))
  return Number.isSafeInteger(value) ? value : null
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Formatea unidades menores como "1.500,50" (sin moneda). Lanza si no es un entero seguro. */
export function formatMinor(amountMinor: number, currency = 'ARS'): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`)
  }
  const exponent = minorUnitExponent(currency)
  const sign = amountMinor < 0 ? '-' : ''
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, '0')
  const whole = digits.slice(0, digits.length - exponent)
  const frac = exponent > 0 ? ',' + digits.slice(digits.length - exponent) : ''
  return `${sign}${groupThousands(whole)}${frac}`
}

/** Formatea con código de moneda: "ARS 1.500,50". */
export function formatMoney(money: { amountMinor: number; currency: string }): string {
  return `${money.currency} ${formatMinor(money.amountMinor, money.currency)}`
}

/** Valor para precargar un input de monto editable ("1500,50", sin separador de miles). */
export function minorToInputValue(amountMinor: number, currency = 'ARS'): string {
  return formatMinor(amountMinor, currency).replaceAll('.', '')
}

/**
 * Total de una línea: `round(quantity × unitPrice)` en unidades menores, half-up (mismo criterio
 * que el backend). `quantity` es un `Decimal` de la API (hasta 3 decimales). Usa BigInt: sin float.
 * Devuelve `null` si la cantidad es inválida o el resultado no es un entero seguro.
 */
export function lineTotalMinor(quantity: string, unitPriceMinor: number): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(quantity)
  if (!match || !Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) return null
  const scaled = BigInt((match[1] ?? '0') + (match[2] ?? '').padEnd(3, '0'))
  const total = (scaled * BigInt(unitPriceMinor) + 500n) / 1000n
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null
}
