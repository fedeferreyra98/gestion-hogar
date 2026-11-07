import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useExpenseSummary, usePriceHistory, type SummaryRow } from '@/api/hooks/useReports'
import type { Product, Unit } from '@/api/types'
import { UNIT_LABELS, UNIT_SHORT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/expenses/dates'
import { formatMinor } from '@/lib/money'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { PriceLineChart, SpendBarChart, type BarDatum } from './Charts'
import {
  categoryLabel,
  fillMonths,
  formatMonth,
  groupByCurrency,
  seriesForUnit,
  storeLabel,
  sumMinor,
  unitsIn,
} from './data'
import { canonicalRangeSearch, isInvalidRange, parseRange } from './filters'
import { ProductSelect } from './ProductSelect'
import { ReportSection } from './ReportSection'

const inputClass = 'h-10 rounded-md border border-border bg-background px-3 text-sm'
const th = 'px-3 py-2 text-left font-medium'
const td = 'px-3 py-2'

function money(amountMinor: number | null, currency: string) {
  return amountMinor === null ? '—' : `${currency} ${formatMinor(amountMinor, currency)}`
}

function DataTable({
  caption,
  head,
  children,
  foot,
}: {
  caption: string
  head: string[]
  children: React.ReactNode
  foot?: React.ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/40">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`${th} ${i === head.length - 1 ? 'text-right' : ''}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
        {foot}
      </table>
    </div>
  )
}

interface BreakdownProps {
  /** Texto del tipo de gráfico, para el aria-label. */
  chartName: string
  firstColumn: string
  rows: SummaryRow[]
  labelOf: (row: SummaryRow) => string
  horizontal: boolean
}

/** Un gráfico + tabla POR MONEDA (nunca se suman monedas distintas). */
function CurrencyBreakdowns({ chartName, firstColumn, rows, labelOf, horizontal }: BreakdownProps) {
  return (
    <div className="flex flex-col gap-6">
      {groupByCurrency(rows).map(({ currency, rows: list }) => {
        const data: BarDatum[] = list.map((r) => ({
          label: labelOf(r),
          amountMinor: r.total.amountMinor,
        }))
        const total = sumMinor(list)
        return (
          <div key={currency} className="flex flex-col gap-3">
            <h3 className="font-medium">Moneda: {currency}</h3>
            <SpendBarChart
              data={data}
              currency={currency}
              horizontal={horizontal}
              description={`Gráfico de barras: ${chartName} en ${currency}, ${data.length} ${
                data.length === 1 ? 'elemento' : 'elementos'
              }. Los valores están en la tabla siguiente.`}
            />
            <DataTable
              caption={`${chartName} en ${currency}`}
              head={[firstColumn, `Total (${currency})`]}
              foot={
                <tfoot className="border-t border-border bg-muted/40 font-semibold">
                  <tr>
                    <th scope="row" className={th}>
                      Total
                    </th>
                    <td className={`${td} text-right`}>{money(total, currency)}</td>
                  </tr>
                </tfoot>
              }
            >
              {data.map((d, i) => (
                <tr key={`${i}-${d.label}`}>
                  <th scope="row" className={`${td} text-left font-normal`}>
                    {d.label}
                  </th>
                  <td className={`${td} text-right`}>{money(d.amountMinor, currency)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        )
      })}
    </div>
  )
}

function MonthlyReport({ from, to }: { from: string; to: string }) {
  const query = useExpenseSummary(
    { groupBy: 'month', from: from || undefined, to: to || undefined },
    { placeholderData: keepPreviousData },
  )
  return (
    <ReportSection
      title="Gasto mensual"
      subject="el gasto mensual"
      query={query}
      isEmpty={(rows) => rows.length === 0}
      emptyMessage="No hay gastos en este período."
    >
      {(rows) => {
        return (
          <div className="flex flex-col gap-6">
            {groupByCurrency(rows).map(({ currency, rows: list }) => {
              const data: BarDatum[] = fillMonths(
                list,
                { from, to },
                rows.map((r) => r.key),
              ).map((m) => ({
                label: formatMonth(m.key),
                amountMinor: m.amountMinor,
              }))
              return (
                <div key={currency} className="flex flex-col gap-3">
                  <h3 className="font-medium">Moneda: {currency}</h3>
                  <p className="rounded-lg bg-muted/40 p-3 text-lg font-semibold">
                    Total del período: {money(sumMinor(list), currency)}
                  </p>
                  <SpendBarChart
                    data={data}
                    currency={currency}
                    description={`Gráfico de barras: gasto mensual en ${currency}, ${data.length} ${
                      data.length === 1 ? 'mes' : 'meses'
                    }. Los valores están en la tabla siguiente.`}
                  />
                  <DataTable
                    caption={`Gasto mensual en ${currency}`}
                    head={['Mes', `Gasto (${currency})`]}
                  >
                    {data.map((d) => (
                      <tr key={d.label}>
                        <th scope="row" className={`${td} text-left font-normal`}>
                          {d.label}
                        </th>
                        <td className={`${td} text-right`}>{money(d.amountMinor, currency)}</td>
                      </tr>
                    ))}
                  </DataTable>
                </div>
              )
            })}
          </div>
        )
      }}
    </ReportSection>
  )
}

function CategoryReport({ from, to }: { from: string; to: string }) {
  const query = useExpenseSummary(
    { groupBy: 'category', from: from || undefined, to: to || undefined },
    { placeholderData: keepPreviousData },
  )
  return (
    <ReportSection
      title="Gasto por categoría"
      subject="el gasto por categoría"
      query={query}
      isEmpty={(rows) => rows.length === 0}
      emptyMessage="No hay gastos en este período."
      note={
        <p className="text-sm text-muted-foreground">
          El gasto de compras no tiene categoría propia: se cuenta en “Sin categoría”.
        </p>
      }
    >
      {(rows) => (
        <CurrencyBreakdowns
          chartName="gasto por categoría"
          firstColumn="Categoría"
          rows={rows}
          labelOf={categoryLabel}
          horizontal
        />
      )}
    </ReportSection>
  )
}

function StoreReport({ from, to }: { from: string; to: string }) {
  const query = useExpenseSummary(
    { groupBy: 'store', from: from || undefined, to: to || undefined },
    { placeholderData: keepPreviousData },
  )
  return (
    <ReportSection
      title="Gasto por comercio"
      subject="el gasto por comercio"
      query={query}
      isEmpty={(rows) => rows.length === 0}
      emptyMessage="No hay compras con comercio en este período."
      note={
        <p className="text-sm text-muted-foreground">
          Solo incluye compras: los gastos manuales no tienen comercio, por eso la suma por comercio
          puede ser menor al gasto mensual.
        </p>
      }
    >
      {(rows) => (
        <CurrencyBreakdowns
          chartName="gasto por comercio"
          firstColumn="Comercio"
          rows={rows}
          labelOf={storeLabel}
          horizontal
        />
      )}
    </ReportSection>
  )
}

function PriceHistoryReport({
  from,
  to,
  invalidRange,
}: {
  from: string
  to: string
  /** Período inválido: se conservan producto y unidad, pero no se consulta. */
  invalidRange: boolean
}) {
  const [product, setProduct] = useState<Product | null>(null)
  const [pickedUnit, setPickedUnit] = useState<Unit | null>(null)
  const query = usePriceHistory(
    product?.id ?? '',
    { from: from || undefined, to: to || undefined },
    {
      enabled: product !== null && !invalidRange,
      // Solo se conservan los datos al cambiar el período del MISMO producto.
      placeholderData: (prev, prevQuery) =>
        prevQuery?.queryKey[2] === product?.id ? prev : undefined,
    },
  )

  return (
    <section aria-labelledby="price-history-title" className="flex flex-col gap-3">
      <h2 id="price-history-title" className="text-lg font-semibold">
        Evolución de precio
      </h2>
      <ProductSelect
        value={product}
        onSelect={(p) => {
          setProduct(p)
          setPickedUnit(null)
        }}
      />
      {product === null ? (
        <p className="text-sm text-muted-foreground">
          Elegí un producto para ver cómo cambió su precio.
        </p>
      ) : invalidRange ? (
        <p className="text-sm text-muted-foreground">
          Corregí el período para ver el histórico de {product.name}.
        </p>
      ) : (
        <ReportSection
          title={`Precio de ${product.name}`}
          subject="el histórico de precios"
          headingLevel="h3"
          query={query}
          isEmpty={(points) => points.length === 0}
          emptyMessage="Este producto no tiene compras en el período."
        >
          {(points) => {
            const units = unitsIn(points)
            // Una unidad por vez: nunca se mezclan unidades distintas en una misma serie.
            const unit = pickedUnit && units.includes(pickedUnit) ? pickedUnit : units[0]!
            const unitShort = UNIT_SHORT_LABELS[unit] ?? unit
            return (
              <div className="flex flex-col gap-4">
                {units.length > 1 ? (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="price-unit" className="text-sm font-medium">
                      Unidad
                    </label>
                    <select
                      id="price-unit"
                      className={`${inputClass} sm:w-60`}
                      value={unit}
                      onChange={(e) => setPickedUnit(e.target.value as Unit)}
                    >
                      {units.map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u] ?? u}
                        </option>
                      ))}
                    </select>
                    <p className="text-sm text-muted-foreground">
                      Los precios se compran en distintas unidades y no se convierten: elegí una.
                    </p>
                  </div>
                ) : null}
                {seriesForUnit(points, unit).map(({ currency, points: series }) => (
                  <div key={currency} className="flex flex-col gap-3">
                    <h4 className="font-medium">
                      Moneda: {currency} · precio por {unitShort}
                    </h4>
                    <PriceLineChart
                      currency={currency}
                      data={series.map((p, index) => ({
                        index,
                        date: p.date,
                        amountMinor: p.unitPrice.amountMinor,
                      }))}
                      description={`Gráfico de líneas: precio de ${product.name} en ${currency} por ${unitShort}, ${series.length} ${
                        series.length === 1 ? 'compra' : 'compras'
                      }. Los valores están en la tabla siguiente.`}
                    />
                    <DataTable
                      caption={`Precio de ${product.name} en ${currency} por ${unitShort}`}
                      head={['Fecha', 'Comercio', `Precio por ${unitShort}`]}
                    >
                      {series.map((p, i) => (
                        <tr key={`${i}-${p.date}`}>
                          <th scope="row" className={`${td} text-left font-normal`}>
                            {formatDate(p.date)}
                          </th>
                          <td className={td}>{p.store || 'Sin comercio'}</td>
                          <td className={`${td} text-right`}>
                            {money(p.unitPrice.amountMinor, currency)}
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                  </div>
                ))}
              </div>
            )
          }}
        </ReportSection>
      )}
    </section>
  )
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const searchKey = searchParams.toString()
  const range = useMemo(() => parseRange(new URLSearchParams(searchKey)), [searchKey])
  const { from, to } = range
  // Las consultas usan el período con debounce: tipear una fecha no dispara ráfagas de pedidos.
  const debouncedKey = useDebouncedValue(`${from}|${to}`, 300)
  const [qFrom = '', qTo = ''] = debouncedKey.split('|')

  // Normaliza la URL si traía basura (reemplaza la entrada del historial).
  useEffect(() => {
    const canonical = canonicalRangeSearch(new URLSearchParams(searchKey), range)
    if (canonical !== searchKey) setSearchParams(new URLSearchParams(canonical), { replace: true })
  }, [searchKey, range, setSearchParams])

  function updateRange(key: 'from' | 'to', value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const invalid = isInvalidRange(range)
  const historySearch = canonicalRangeSearch(new URLSearchParams(), range)
  const historyLink = historySearch ? `/gastos?${historySearch}` : '/gastos'

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Reportes</h1>
        <Button asChild variant="outline">
          <Link to={historyLink}>Ver histórico de gastos</Link>
        </Button>
      </div>

      <form
        role="search"
        aria-label="Período de los reportes"
        onSubmit={(e) => e.preventDefault()}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="r-from" className="text-sm font-medium">
            Desde
          </label>
          <input
            id="r-from"
            type="date"
            className={inputClass}
            value={from}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'r-range-error' : undefined}
            onChange={(e) => updateRange('from', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="r-to" className="text-sm font-medium">
            Hasta
          </label>
          <input
            id="r-to"
            type="date"
            className={inputClass}
            value={to}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'r-range-error' : undefined}
            onChange={(e) => updateRange('to', e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            disabled={!from && !to}
            onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
          >
            Limpiar período
          </Button>
        </div>
      </form>

      {invalid ? (
        <p id="r-range-error" role="alert" className="text-sm text-red-700">
          La fecha “Desde” no puede ser posterior a “Hasta”.
        </p>
      ) : (
        <>
          <MonthlyReport from={qFrom} to={qTo} />
          <CategoryReport from={qFrom} to={qTo} />
          <StoreReport from={qFrom} to={qTo} />
        </>
      )}
      <PriceHistoryReport from={qFrom} to={qTo} invalidRange={invalid} />
    </div>
  )
}
