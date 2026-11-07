function localIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Fecha de hoy como YYYY-MM-DD en la zona horaria del hogar (IANA). Sin zona, o si es
 * inválida, usa la del navegador.
 */
export function todayIso(timeZone?: string, now = new Date()): string {
  if (timeZone) {
    try {
      // 'en-CA' formatea como YYYY-MM-DD.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)
    } catch {
      /* zona inválida: cae al navegador */
    }
  }
  return localIso(now)
}

/** YYYY-MM-DD → DD/MM/YYYY (manipulación de string: sin zonas horarias). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

/** `true` si es una fecha de calendario real en formato YYYY-MM-DD. */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}
