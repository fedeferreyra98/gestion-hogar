import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { formatTick } from './format'

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }
// En jsdom (y antes del primer layout) el contenedor mide 0: dimensión inicial para no romper.
const INITIAL = { width: 320, height: 240 }

/** Ancho del eje de montos según el monto más largo (≈7 px por carácter a 12 px), entre 48 y 112. */
function valueAxisWidth(maxAmountMinor: number, currency: string): number {
  const chars = formatTick(Math.abs(maxAmountMinor), currency).length
  return Math.min(112, Math.max(48, chars * 7 + 16))
}

const shorten = (text: string) => (text.length > 14 ? `${text.slice(0, 13)}…` : text)

/**
 * El gráfico es un complemento visual: `role="img"` + descripción, y los mismos datos van en una
 * tabla al lado (el color nunca es el único canal: etiquetas de eje, marcadores y tabla).
 */
function ChartFrame({ description, children }: { description: string; children: ReactNode }) {
  return (
    <ErrorBoundary subject="el gráfico" hint="Los datos están en la tabla.">
      <div role="img" aria-label={description} className="w-full min-w-0">
        {children}
      </div>
    </ErrorBoundary>
  )
}

export interface BarDatum {
  label: string
  amountMinor: number
}

export function SpendBarChart({
  data,
  currency,
  description,
  horizontal = false,
}: {
  data: BarDatum[]
  currency: string
  description: string
  /** Barras horizontales (etiquetas largas: categorías y comercios). */
  horizontal?: boolean
}) {
  const height = horizontal ? Math.max(160, data.length * 36 + 40) : 240
  const fmt = (v: unknown) => `${currency} ${formatTick(v, currency)}`.trimEnd()
  const axisWidth = valueAxisWidth(Math.max(0, ...data.map((d) => d.amountMinor)), currency)
  return (
    <ChartFrame description={description}>
      <ResponsiveContainer width="100%" height={height} initialDimension={INITIAL}>
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          accessibilityLayer={false}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tick={AXIS_TICK}
                allowDecimals={false}
                tickFormatter={(v) => formatTick(v, currency)}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={96}
                tick={AXIS_TICK}
                tickFormatter={shorten}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" />
              <YAxis
                width={axisWidth}
                tick={AXIS_TICK}
                allowDecimals={false}
                tickFormatter={(v) => formatTick(v, currency)}
              />
            </>
          )}
          <Tooltip formatter={(v) => fmt(v)} />
          <Bar dataKey="amountMinor" name="Gasto" fill="var(--primary)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export interface LineDatum {
  /** Índice del punto: permite varias compras el mismo día sin colapsar el eje. */
  index: number
  date: string
  amountMinor: number
}

export function PriceLineChart({
  data,
  currency,
  description,
}: {
  data: LineDatum[]
  currency: string
  description: string
}) {
  return (
    <ChartFrame description={description}>
      <ResponsiveContainer width="100%" height={240} initialDimension={INITIAL}>
        <LineChart
          data={data}
          accessibilityLayer={false}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="index"
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            tickFormatter={(i) =>
              data[Number(i)]?.date.slice(5).split('-').reverse().join('/') ?? ''
            }
          />
          <YAxis
            width={valueAxisWidth(Math.max(0, ...data.map((d) => d.amountMinor)), currency)}
            tick={AXIS_TICK}
            allowDecimals={false}
            tickFormatter={(v) => formatTick(v, currency)}
          />
          <Tooltip
            labelFormatter={(i) => data[Number(i)]?.date ?? ''}
            formatter={(v) => `${currency} ${formatTick(v, currency)}`.trimEnd()}
          />
          <Line
            type="monotone"
            dataKey="amountMinor"
            name="Precio unitario"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 4, fill: 'var(--background)', stroke: 'var(--primary)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
