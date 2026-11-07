import { formatMinor } from '@/lib/money'

/**
 * Formato de un tick/valor del eje. Recharts puede calcular ticks no enteros (p. ej. 2,25 con
 * máximos de 1–3 unidades menores) y `formatMinor` lanza con no enteros: nunca debe tirar abajo la
 * pantalla, así que lo que no es un entero seguro se oculta (los valores reales van en la tabla).
 */
export function formatTick(value: unknown, currency: string): string {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? formatMinor(value, currency)
    : ''
}
