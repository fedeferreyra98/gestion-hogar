import { useEffect, useState, type ComponentType } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  load: () => Promise<{ default: ComponentType }>
  /** Nombre de la pantalla para los mensajes (ej. "los reportes"). */
  subject: string
}

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; screen: ComponentType }

/**
 * Pantalla cargada bajo demanda. Si el chunk falla (sin conexión, o nuevo deploy con otro hash),
 * muestra un error con reintento que vuelve a pedir el módulo (React.lazy cachea el rechazo, por
 * eso la carga se maneja acá).
 */
export function LazyRoute({ load, subject }: Props) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    load().then(
      (module) => {
        if (!cancelled) setState({ status: 'ready', screen: module.default })
      },
      () => {
        if (!cancelled) setState({ status: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [load, attempt])

  if (state.status === 'ready') {
    const Screen = state.screen
    return <Screen />
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
        <span>No pudimos cargar {subject}. Revisá tu conexión e intentá de nuevo.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setState({ status: 'loading' })
            setAttempt((n) => n + 1)
          }}
        >
          Reintentar
        </Button>
      </div>
    )
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Cargando {subject}…
    </p>
  )
}
