import type { ProblemError } from '@/api/errors'

/** Mensaje en español para un error de los endpoints de reportes (nunca el texto del servidor). */
export function mapReportProblem(error: ProblemError, subject: string): string {
  if (error.status === 400) return 'El período elegido no es válido. Revisá las fechas.'
  if (error.status === 404) return 'Ese producto ya no existe.'
  if (error.code === 'NETWORK_ERROR' || error.status === 0) {
    return `No pudimos cargar ${subject}: parece que no hay conexión.`
  }
  return `No pudimos cargar ${subject}.`
}
