import type { FieldError, Problem, ProblemCode } from './types.ts'

const DEFAULT_TYPE = 'about:blank'

function defaultCodeForStatus(status: number): ProblemCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR'
    case 401:
      return 'UNAUTHORIZED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    case 422:
      return 'BUSINESS_RULE'
    default:
      return 'BUSINESS_RULE'
  }
}

/**
 * Representa un error HTTP con formato RFC 7807 (Problem Details).
 */
export class ProblemError extends Error {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly code: ProblemCode | string
  readonly detail?: string
  readonly errors: FieldError[]
  readonly response?: Response
  readonly raw?: unknown

  constructor(problem: Problem, response?: Response, raw?: unknown) {
    const message = problem.detail || problem.title || `Error ${problem.code} (${problem.status})`
    super(message)
    this.name = 'ProblemError'
    this.type = problem.type || DEFAULT_TYPE
    this.title = problem.title
    this.status = problem.status
    this.code = problem.code
    this.detail = problem.detail
    this.errors = problem.errors ?? []
    this.response = response
    this.raw = raw

    // Mantener prototipo en TypeScript transpiled
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Retorna los errores de campos mapeados por nombre de campo para fácil uso en formularios.
   */
  getFieldErrors(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const err of this.errors) {
      if (err.field && err.message) {
        map[err.field] = err.message
      }
    }
    return map
  }
}

/**
 * Type guard para verificar si un valor tiene la estructura de un Problem RFC 7807.
 */
export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    typeof obj.title === 'string' && typeof obj.status === 'number' && typeof obj.code === 'string'
  )
}

/**
 * Type guard para ProblemError.
 */
export function isProblemError(error: unknown): error is ProblemError {
  return error instanceof ProblemError
}

/**
 * Convierte un error (o respuesta de openapi-fetch) en un ProblemError normalizado.
 */
export function toProblemError(error: unknown, response?: Response): ProblemError {
  if (isProblemError(error)) {
    return error
  }

  if (isProblem(error)) {
    return new ProblemError(error, response, error)
  }

  const status = response?.status ?? 500
  const title = response?.statusText || (status >= 500 ? 'Server error' : 'Request error')
  const detail =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined

  const fallback: Problem = {
    type: DEFAULT_TYPE,
    title,
    status,
    code: defaultCodeForStatus(status),
    detail,
  }

  return new ProblemError(fallback, response, error)
}
