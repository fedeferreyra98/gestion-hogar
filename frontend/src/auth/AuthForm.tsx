import type { ReactNode } from 'react'

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-4">
      <p className="text-lg font-semibold">Gestión del Hogar</p>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  )
}

export function Field(props: {
  id: string
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  minLength?: number
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type ?? 'text'}
        required
        value={props.value}
        minLength={props.minLength}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-10 rounded-md border border-border bg-background px-3 text-sm"
      />
    </div>
  )
}
