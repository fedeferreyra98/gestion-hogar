import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useCategories } from '@/api/hooks/useCatalog'
import { useExpenses, useMembers } from '@/api/hooks/useExpenses'
import { useMe } from '@/api/hooks/useMe'
import { Button } from '@/components/ui/button'
import { formatMinor, formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { formatDate } from './dates'
import { canonicalSearch, FILTER_KEYS, parseFilters } from './filters'

const PAGE_SIZE = 20
const inputClass = 'h-10 rounded-md border border-border bg-background px-3 text-sm'

export function ExpenseListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const searchKey = searchParams.toString()
  // Parámetros inválidos de la URL (link viejo o editado a mano) se descartan.
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchKey)), [searchKey])
  const { from, to, categoryId, paidBy, source, q: qParam, page } = filters

  // Normaliza la URL si traía basura (reemplaza la entrada del historial).
  useEffect(() => {
    const canonical = canonicalSearch(new URLSearchParams(searchKey), filters)
    if (canonical !== searchKey) setSearchParams(new URLSearchParams(canonical), { replace: true })
  }, [searchKey, filters, setSearchParams])

  function updateParams(
    changes: Record<string, string>,
    options: { resetPage?: boolean; push?: boolean } = {},
  ) {
    const { resetPage = true, push = false } = options
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        if (resetPage) next.delete('page')
        return next
      },
      { replace: !push },
    )
  }

  // La búsqueda de texto se escribe en la URL con debounce.
  const [qInput, setQInput] = useState(qParam)
  const debouncedQ = useDebouncedValue(qInput.trim(), 300)
  useEffect(() => {
    if (debouncedQ !== qParam) updateParams({ q: debouncedQ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ])
  // Si la URL cambia desde afuera (menú, atrás/adelante), la caja se resincroniza.
  const [seenQParam, setSeenQParam] = useState(qParam)
  if (seenQParam !== qParam) {
    setSeenQParam(qParam)
    if (qInput.trim() !== qParam) setQInput(qParam)
  }

  const invalidRange = from !== '' && to !== '' && from > to

  const me = useMe()
  const categories = useCategories()
  const members = useMembers()
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } = useExpenses(
    {
      from: from || undefined,
      to: to || undefined,
      categoryId: categoryId || undefined,
      paidBy: paidBy || undefined,
      source: source || undefined,
      q: qParam || undefined,
      page,
      size: PAGE_SIZE,
    },
    { placeholderData: keepPreviousData, enabled: !invalidRange },
  )

  // Página fuera de rango (link viejo, o se borró el último gasto de la última página):
  // se salta a la última página válida, como en el catálogo.
  const outOfRange =
    !invalidRange &&
    data !== undefined &&
    data.page === page &&
    page > 0 &&
    data.content.length === 0
  useEffect(() => {
    if (outOfRange && data) {
      updateParams(
        { page: data.totalPages > 1 ? String(data.totalPages) : '' },
        { resetPage: false },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOfRange, data?.totalPages])

  const hasFilters = FILTER_KEYS.some((k) => filters[k] !== '')
  const baseCurrency = me.data?.household.baseCurrency ?? 'ARS'
  const categoryName = (id?: string | null) =>
    categories.data?.find((c) => c.id === id)?.name ?? 'Sin categoría'
  const payerName = (id: string) => members.data?.find((m) => m.id === id)?.displayName ?? '—'

  function clearFilters() {
    setQInput('')
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  const content = data?.content ?? []
  const totalPages = data?.totalPages ?? 0

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Gastos</h1>
        <Button asChild>
          <Link to="/gastos/nuevo" state={{ listSearch: location.search }}>
            Nuevo gasto
          </Link>
        </Button>
      </div>

      <form
        role="search"
        aria-label="Filtros de gastos"
        onSubmit={(e) => e.preventDefault()}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
          <label htmlFor="f-q" className="text-sm font-medium">
            Buscar en la descripción
          </label>
          <input
            id="f-q"
            type="search"
            className={inputClass}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className="text-sm font-medium">
            Desde
          </label>
          <input
            id="f-from"
            type="date"
            className={inputClass}
            value={from}
            aria-invalid={invalidRange ? true : undefined}
            aria-describedby={invalidRange ? 'f-range-error' : undefined}
            onChange={(e) => updateParams({ from: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to" className="text-sm font-medium">
            Hasta
          </label>
          <input
            id="f-to"
            type="date"
            className={inputClass}
            value={to}
            aria-invalid={invalidRange ? true : undefined}
            aria-describedby={invalidRange ? 'f-range-error' : undefined}
            onChange={(e) => updateParams({ to: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-category" className="text-sm font-medium">
            Categoría
          </label>
          <select
            id="f-category"
            className={inputClass}
            value={categoryId}
            onChange={(e) => updateParams({ categoryId: e.target.value })}
          >
            <option value="">Todas</option>
            {categories.data && categoryId && !categories.data.some((c) => c.id === categoryId) ? (
              <option value={categoryId}>Categoría desconocida</option>
            ) : null}
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-paidBy" className="text-sm font-medium">
            Pagó
          </label>
          <select
            id="f-paidBy"
            className={inputClass}
            value={paidBy}
            onChange={(e) => updateParams({ paidBy: e.target.value })}
          >
            <option value="">Todos</option>
            {members.data && paidBy && !members.data.some((m) => m.id === paidBy) ? (
              <option value={paidBy}>Miembro desconocido</option>
            ) : null}
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
                {m.active ? '' : ' (inactivo)'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-source" className="text-sm font-medium">
            Origen
          </label>
          <select
            id="f-source"
            className={inputClass}
            value={source}
            onChange={(e) => updateParams({ source: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="MANUAL">Manual</option>
            <option value="PURCHASE">Compra</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={clearFilters} disabled={!hasFilters}>
            Limpiar filtros
          </Button>
        </div>
      </form>

      {invalidRange ? (
        <p id="f-range-error" role="alert" className="text-sm text-red-600">
          La fecha “Desde” no puede ser posterior a “Hasta”.
        </p>
      ) : null}

      {invalidRange ? null : isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-600">
          <span>No pudimos cargar los gastos.</span>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      ) : isLoading || outOfRange || (isPlaceholderData && data?.content.length === 0) ? (
        <p className="text-sm text-muted-foreground">Cargando gastos…</p>
      ) : (
        <>
          <section
            aria-label="Total filtrado"
            aria-live="polite"
            className="rounded-lg bg-muted/40 p-3"
          >
            <h2 className="text-sm font-medium">Total filtrado</h2>
            {data && data.totalFiltered.length > 0 ? (
              <ul className="text-lg font-semibold">
                {data.totalFiltered.map((m) => (
                  <li key={m.currency}>{formatMoney(m)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-lg font-semibold">
                {baseCurrency} {formatMinor(0, baseCurrency)}
              </p>
            )}
          </section>

          {content.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {hasFilters
                ? 'No hay gastos que coincidan con los filtros.'
                : 'Aún no hay gastos registrados.'}
            </p>
          ) : (
            <ul
              aria-label="Gastos"
              aria-busy={isFetching}
              className="divide-y divide-border rounded-lg border border-border"
            >
              {content.map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/gastos/${e.id}`}
                    state={{ listSearch: location.search }}
                    className="flex flex-col gap-1 p-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{e.description}</span>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(e.expenseDate)} · {categoryName(e.categoryId)} ·{' '}
                        {payerName(e.paidBy)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="rounded border border-border px-1.5 py-0.5 text-xs">
                        {e.source === 'PURCHASE' ? 'Compra' : 'Manual'}
                      </span>
                      <span className="font-semibold">{formatMoney(e.amount)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <nav aria-label="Paginación" className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                disabled={page <= 0}
                onClick={() =>
                  updateParams({ page: String(page) }, { resetPage: false, push: true })
                }
              >
                Anterior
              </Button>
              <span className="text-sm" aria-live="polite">
                Página {page + 1} de {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page + 1 >= totalPages}
                onClick={() =>
                  updateParams({ page: String(page + 2) }, { resetPage: false, push: true })
                }
              >
                Siguiente
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  )
}
