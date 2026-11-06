import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { isProblemError } from '@/api/errors'
import { AuthCard, Field } from '@/auth/AuthForm'
import { useSession } from '@/auth/useSession'
import { registerOwner } from '@/auth/session'
import { Button } from '@/components/ui/button'

export function RegisterPage() {
  const { status } = useSession()
  const [householdName, setHouseholdName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (status === 'authenticated') return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    setPending(true)
    try {
      await registerOwner({ householdName, displayName, email, password })
    } catch (err) {
      if (isProblemError(err) && err.status === 409) {
        setError('Ya existe un hogar registrado. Iniciá sesión.')
      } else if (isProblemError(err) && err.status === 400) {
        setError('Revisá los datos ingresados.')
      } else {
        setError('No pudimos crear el hogar. Intentá de nuevo.')
      }
      setPending(false)
    }
  }

  return (
    <AuthCard title="Registrá tu hogar">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          id="householdName"
          label="Nombre del hogar"
          value={householdName}
          onChange={setHouseholdName}
        />
        <Field
          id="displayName"
          label="Tu nombre"
          autoComplete="name"
          value={displayName}
          onChange={setDisplayName}
        />
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          Crear hogar
        </Button>
      </form>
      <p className="text-sm">
        ¿Ya tenés cuenta?{' '}
        <Link to="/login" className="underline">
          Iniciá sesión
        </Link>
      </p>
    </AuthCard>
  )
}
