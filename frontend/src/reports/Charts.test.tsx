import { render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { vi } from 'vitest'
import { PriceLineChart, SpendBarChart } from './Charts'

// jsdom no mide: se fija un tamaño para que Recharts calcule ejes y ticks de verdad.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>
    }) => cloneElement(children, { width: 400, height: 240 }),
  }
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('gráficos con montos mínimos (ticks decimales de Recharts)', () => {
  const small = [1, 3, 2].map((amountMinor, i) => ({ label: `L${i}`, amountMinor }))

  it.each([false, true])(
    'barras (horizontal=%s) con montos de 1 a 3 unidades menores',
    (horizontal) => {
      render(
        <SpendBarChart data={small} currency="ARS" description="barras" horizontal={horizontal} />,
      )
      expect(screen.getByRole('img', { name: 'barras' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('línea con precios de 1 a 3 unidades menores', () => {
    render(
      <PriceLineChart
        currency="ARS"
        description="línea"
        data={[1, 3, 2].map((amountMinor, index) => ({
          index,
          date: `2026-01-0${index + 1}`,
          amountMinor,
        }))}
      />,
    )
    expect(screen.getByRole('img', { name: 'línea' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
