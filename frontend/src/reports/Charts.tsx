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
import { formatMinor } from '@/lib/money'
import type { ReactNode } from 'react'

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }
// En jsdom (y antes del primer layout) el contenedor mide 0: dimensión inicial para no romper.
const INITIAL = { width: 320, height: 240 }

/**
 * El gráfico es un complemento visual: `role="img"` + descripción, y los mismos datos van en una
 * tabla al lado (el color nunca es el único canal: etiquetas de eje, marcadores y tabla).
 */
function ChartFrame({ description, children }: { description: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={description} className="w-full min-w-0">
      {children}
    </div>
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
  const fmt = (v: unknown) => `${currency} ${formatMinor(Number(v), currency)}`
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
                tickFormatter={(v) => formatMinor(Number(v), currency)}
              />
              <YAxis type="category" dataKey="label" width={110} tick={AXIS_TICK} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" />
              <YAxis
                width={80}
                tick={AXIS_TICK}
                tickFormatter={(v) => formatMinor(Number(v), currency)}
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
            width={80}
            tick={AXIS_TICK}
            tickFormatter={(v) => formatMinor(Number(v), currency)}
          />
          <Tooltip
            labelFormatter={(i) => data[Number(i)]?.date ?? ''}
            formatter={(v) => `${currency} ${formatMinor(Number(v), currency)}`}
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
