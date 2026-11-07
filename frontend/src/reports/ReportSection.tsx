import type { UseQueryResult } from '@tanstack/react-query'
import { useId, type ReactNode } from 'react'
import type { ProblemError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { mapReportProblem } from './problems'

interface Props<T> {
  title: string
  /** Complemento de "No pudimos cargar …" (ej. "el gasto mensual"). */
  subject: string
  query: UseQueryResult<T, ProblemError>
  isEmpty: (data: T) => boolean
  emptyMessage: string
  note?: ReactNode
  /** Nivel del título (h3 cuando la sección va anidada). */
  headingLevel?: 'h2' | 'h3'
  children: (data: T) => ReactNode
}

/**
 * Sección de un reporte con estados de carga, error con reintento y vacío. Un refetch fallido
 * con datos previos NO desmonta el contenido: se muestra un aviso y se conservan los datos.
 */
export function ReportSection<T>({
  title,
  subject,
  query,
  isEmpty,
  emptyMessage,
  note,
  headingLevel: Heading = 'h2',
  children,
}: Props<T>) {
  const headingId = useId()
  const { data, isError, error, isFetching, refetch } = query
  const retry = (
    <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
      Reintentar
    </Button>
  )

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <Heading id={headingId} className="text-lg font-semibold">
        {title}
      </Heading>
      {data === undefined ? (
        isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
            <span>{mapReportProblem(error, subject)}</span>
            {retry}
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Cargando {subject}…
          </p>
        )
      ) : (
        <>
          {isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
              <span>
                No pudimos actualizar {subject}. Mostramos los últimos datos que cargaron.
              </span>
              {retry}
            </div>
          ) : null}
          {note}
          {isEmpty(data) ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <div aria-busy={isFetching}>{children(data)}</div>
          )}
        </>
      )}
    </section>
  )
}
