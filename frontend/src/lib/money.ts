/**
 * Dinero siempre como entero en unidades menores + moneda (ADR-004). Nada de float:
 * el parseo y el formato operan sobre strings/enteros.
 */

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'CLP', 'PYG', 'KRW', 'VND'])

/** Cantidad de decimales de la unidad menor (2 para ARS/USD/EUR…, 0 para JPY/CLP…). */
export function minorUnitExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2
}

/**
 * Parsea un monto escrito por una persona (formato es-AR: "1.500,50") a unidades menores.
 * - La coma es el separador decimal; el punto agrupa miles ("1.500" = 1500).
 * - Un punto con 1–2 decimales y sin coma ("1500.5") se acepta como decimal.
 * Devuelve `null` si es inválido, negativo, tiene más decimales de los permitidos o no es seguro.
 */
export function parseMoneyToMinor(input: string, currency = 'ARS'): number | null {
  const exponent = minorUnitExponent(currency)
  let text = input.trim().replace(/\s+/g, '')
  if (text === '') return null

  let whole: string
  let frac = ''
  if (text.includes(',')) {
    const [w = '', f = '', ...rest] = text.split(',')
    if (rest.length > 0) return null
    if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(w)) return null
    whole = w.replaceAll('.', '')
    frac = f
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    whole = text.replaceAll('.', '')
  } else if (/^\d+\.\d+$/.test(text)) {
    const [w = '', f = ''] = text.split('.')
    whole = w
    frac = f
  } else {
    text = text.replace(/^\+/, '')
    if (!/^\d+$/.test(text)) return null
    whole = text
  }

  if (!/^\d*$/.test(frac) || frac.length > exponent) return null
  if (whole === '') return null
  const minorText = whole + frac.padEnd(exponent, '0')
  const value = Number(minorText)
  return Number.isSafeInteger(value) ? value : null
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Formatea unidades menores como "1.500,50" (sin moneda). */
export function formatMinor(amountMinor: number, currency = 'ARS'): string {
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
