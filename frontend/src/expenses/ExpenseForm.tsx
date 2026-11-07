import { useState, type FormEvent } from 'react'
import type { Expense, ExpenseInput } from '@/api/hooks/useExpenses'
import type { Category, Member } from '@/api/types'
import { Button } from '@/components/ui/button'
import { minorToInputValue, parseMoneyToMinor } from '@/lib/money'
import { todayIso } from './dates'

const FIELD_ORDER = ['description', 'amount', 'expenseDate', 'paidBy'] as const
const FIELD_IDS = {
  description: 'expense-description',
  amount: 'expense-amount',
  expenseDate: 'expense-date',
  paidBy: 'expense-paidBy',
}

const REQUIRED = new Set(['description', 'amount', 'expenseDate', 'paidBy'])
const inputClass = 'h-10 rounded-md border border-border bg-background px-3 text-sm'

interface Props {
  expense?: Expense
  currency: string
  timeZone?: string
  categories: Category[]
  members: Member[]
  defaultPaidBy?: string
  submitLabel: string
  submitting: boolean
  serverError?: string | null
  serverFieldErrors?: Partial<Record<string, string>>
  onSubmit: (input: ExpenseInput) => void
  onCancel: () => void
}

export function ExpenseForm({
  expense,
  currency,
  timeZone,
  categories,
  members,
  defaultPaidBy,
  submitLabel,
  submitting,
  serverError,
  serverFieldErrors = {},
  onSubmit,
  onCancel,
}: Props) {
  const effectiveCurrency = expense?.amount.currency ?? currency
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(
    expense ? minorToInputValue(expense.amount.amountMinor, effectiveCurrency) : '',
  )
  const [date, setDate] = useState(expense?.expenseDate ?? todayIso(timeZone))
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '')
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? defaultPaidBy ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const fieldErrors = { ...serverFieldErrors, ...errors }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    const trimmed = description.trim()
    if (!trimmed) next.description = 'Ingresá una descripción.'
    else if (trimmed.length > 255) next.description = 'Máximo 255 caracteres.'
    const minor = parseMoneyToMinor(amount, effectiveCurrency)
    if (minor === null || minor <= 0)
      next.amount = 'Ingresá un monto mayor a cero con coma decimal (ej. 1.500,50).'
    if (!date) next.expenseDate = 'Elegí una fecha.'
    if (!paidBy) next.paidBy = 'Elegí quién pagó.'
    setErrors(next)
    const first = FIELD_ORDER.find((f) => next[f])
    if (first) document.getElementById(FIELD_IDS[first])?.focus()
    if (Object.keys(next).length > 0 || minor === null) return
    onSubmit({
      description: trimmed,
      amount: { amountMinor: minor, currency: effectiveCurrency },
      expenseDate: date,
      categoryId: categoryId || null,
      paidBy,
    })
  }

  const err = (name: string) =>
    fieldErrors[name] ? (
      <p id={`expense-${name}-error`} role="alert" className="text-sm text-red-600">
        {fieldErrors[name]}
      </p>
    ) : null
  const aria = (name: string) => ({
    'aria-invalid': fieldErrors[name] ? true : undefined,
    'aria-required': REQUIRED.has(name) ? true : undefined,
    'aria-describedby': fieldErrors[name] ? `expense-${name}-error` : undefined,
  })

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-description" className="text-sm font-medium">
          Descripción
        </label>
        <input
          id="expense-description"
          className={inputClass}
          value={description}
          maxLength={255}
          onChange={(e) => setDescription(e.target.value)}
          {...aria('description')}
        />
        {err('description')}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="expense-amount" className="text-sm font-medium">
          Monto ({effectiveCurrency})
        </label>
        <input
          id="expense-amount"
          className={inputClass}
          inputMode="decimal"
          placeholder="1.500,50"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          {...aria('amount')}
        />
        {err('amount')}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="expense-date" className="text-sm font-medium">
          Fecha
        </label>
        <input
          id="expense-date"
          type="date"
          className={inputClass}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          {...aria('expenseDate')}
        />
        {err('expenseDate')}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="expense-category" className="text-sm font-medium">
          Categoría
        </label>
        <select
          id="expense-category"
          className={inputClass}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          {...aria('categoryId')}
        >
          <option value="">Sin categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {err('categoryId')}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="expense-paidBy" className="text-sm font-medium">
          Pagó
        </label>
        <select
          id="expense-paidBy"
          className={inputClass}
          value={paidBy}
          onChange={(e) => setPaidBy(e.target.value)}
          {...aria('paidBy')}
        >
          <option value="">Elegí un miembro</option>
          {members
            .filter((m) => m.active || m.id === paidBy)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
                {m.active ? '' : ' (inactivo)'}
              </option>
            ))}
        </select>
        {err('paidBy')}
      </div>

      {serverError ? (
        <p role="alert" className="text-sm text-red-600">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
