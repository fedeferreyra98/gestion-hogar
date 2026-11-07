import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  /** Qué no se pudo mostrar, en español (ej. "los reportes"). */
  subject: string
  /** Texto extra opcional bajo el mensaje. */
  hint?: string
  /** Se llama al reintentar, antes de volver a renderizar los hijos. */
  onRetry?: () => void
  children: ReactNode
}

interface State {
  failed: boolean
}

/**
 * Evita que un error de render (o la carga fallida de un chunk) deje la app en blanco:
 * muestra un mensaje en español con reintento.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary', error, info.componentStack)
  }

  private retry = () => {
    this.props.onRetry?.()
    this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
        <span>
          No pudimos mostrar {this.props.subject}.{this.props.hint ? ` ${this.props.hint}` : ''}
        </span>
        <Button size="sm" variant="outline" onClick={this.retry}>
          Reintentar
        </Button>
      </div>
    )
  }
}
