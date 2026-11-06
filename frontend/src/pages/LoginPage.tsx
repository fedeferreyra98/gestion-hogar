import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { isProblemError } from '@/api/errors'
import { AuthCard, Field } from '@/auth/AuthForm'
import { useSession } from '@/auth/useSession'
import { login } from '@/auth/session'
import { Button } from '@/components/ui/button'

interface LocationState {
  from?: string
  expired?: boolean
}

export function LoginPage() {
  const { status } = useSession()
  const state = (useLocation().state ?? {}) as LocationState
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (status === 'authenticated') return <Navigate to={state.from ?? '/'} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(
        isProblemError(err) && err.status === 401
          ? 'Email o contraseña incorrectos.'
          : 'No pudimos iniciar sesión. Intentá de nuevo.',
      )
      setPending(false)
    }
  }

  return (
    <AuthCard title="Iniciar sesión">
      {state.expired && (
        <p role="status" className="rounded-md bg-muted p-3 text-sm">
          Tu sesión expiró. Volvé a iniciar sesión.
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        <Field
          id="password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          Ingresar
        </Button>
      </form>
      <p className="text-sm">
        ¿Primera vez?{' '}
        <Link to="/registro" className="underline">
          Registrá tu hogar
        </Link>
      </p>
    </AuthCard>
  )
}
