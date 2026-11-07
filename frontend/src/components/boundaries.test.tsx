import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import { LazyRoute } from './LazyRoute'

beforeEach(() => {
  // React y el boundary loguean el error esperado: se silencia para no ensuciar la salida.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('muestra un mensaje en español con reintento en vez de dejar la pantalla en blanco', async () => {
    let broken = true
    function Child() {
      if (broken) throw new RangeError('not int 2.25')
      return <p>Todo bien</p>
    }
    render(
      <ErrorBoundary subject="el gráfico" hint="Los datos están en la tabla.">
        <Child />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos mostrar el gráfico. Los datos están en la tabla.',
    )
    broken = false
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Todo bien')).toBeInTheDocument()
  })
})

describe('LazyRoute', () => {
  it('si falla la carga del chunk muestra error con reintento que vuelve a pedirlo', async () => {
    const load = vi
      .fn<() => Promise<{ default: () => React.ReactElement }>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ default: () => <h1>Reportes cargados</h1> })
    render(<LazyRoute load={load} subject="los reportes" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cargar los reportes.')
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Reportes cargados' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('muestra un estado de carga accesible mientras llega el chunk', async () => {
    let resolve!: (m: { default: () => React.ReactElement }) => void
    const load = () => new Promise<{ default: () => React.ReactElement }>((r) => (resolve = r))
    render(<LazyRoute load={load} subject="los reportes" />)
    expect(screen.getByRole('status')).toHaveTextContent('Cargando los reportes…')
    resolve({ default: () => <p>Listo</p> })
    expect(await screen.findByText('Listo')).toBeInTheDocument()
  })
})
