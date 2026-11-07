import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { isProblemError } from '@/api/errors'
import {
  useCreateExpense,
  useDeleteExpense,
  useExpense,
  useMembers,
  useUpdateExpense,
  type ExpenseInput,
} from '@/api/hooks/useExpenses'
import { useCategories } from '@/api/hooks/useCatalog'
import { useMe } from '@/api/hooks/useMe'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { formatDate } from './dates'
import { ExpenseForm } from './ExpenseForm'
import { useListPath } from './listPath'
import { mapExpenseProblem } from './problems'

function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className="text-sm text-primary underline">
      ← Volver a gastos
    </Link>
  )
}

export function NewExpensePage() {
  const navigate = useNavigate()
  const listPath = useListPath()
  const me = useMe()
  const categories = useCategories()
  const members = useMembers()
  const create = useCreateExpense()

  if (me.isError || categories.isError || members.isError)
    return (
      <p role="alert" className="text-sm text-red-600">
        No pudimos cargar los datos del formulario.
      </p>
    )
  if (!me.data || !categories.data || !members.data)
    return <p className="text-sm text-muted-foreground">Cargando…</p>

  const problem = create.error
    ? mapExpenseProblem(create.error, 'No pudimos guardar el gasto. Intentá de nuevo.')
    : null

  function submit(input: ExpenseInput) {
    create.mutate(input, { onSuccess: () => navigate(listPath) })
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <BackLink to={listPath} />
      <h1 className="text-2xl font-semibold">Nuevo gasto</h1>
      <ExpenseForm
        currency={me.data.household.baseCurrency}
        timeZone={me.data.household.timezone}
        categories={categories.data}
        members={members.data}
        defaultPaidBy={me.data.member.id}
        submitLabel="Guardar gasto"
        submitting={create.isPending}
        serverError={problem?.message}
        serverFieldErrors={problem?.fields}
        onSubmit={submit}
        onCancel={() => navigate(listPath)}
      />
    </div>
  )
}

export function ExpenseDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const listPath = useListPath()
  const expense = useExpense(id)
  const me = useMe()
  const categories = useCategories()
  const members = useMembers()
  const update = useUpdateExpense()
  const remove = useDeleteExpense()
  const [confirming, setConfirming] = useState(false)
  const wasConfirming = useRef(false)

  // Foco: al abrir la confirmación va a la opción segura (autoFocus); al cerrarla vuelve a "Eliminar".
  useEffect(() => {
    if (!confirming && wasConfirming.current) document.getElementById('delete-expense')?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  if (expense.isError) {
    const notFound = isProblemError(expense.error) && expense.error.status === 404
    return (
      <div className="flex flex-col gap-3">
        <BackLink to={listPath} />
        <p role="alert" className="text-sm text-red-600">
          {notFound ? 'El gasto no existe o fue eliminado.' : 'No pudimos cargar el gasto.'}
        </p>
      </div>
    )
  }
  if (!expense.data || !me.data || !categories.data || !members.data) {
    if (me.isError || categories.isError || members.isError)
      return (
        <p role="alert" className="text-sm text-red-600">
          No pudimos cargar los datos del gasto.
        </p>
      )
    return <p className="text-sm text-muted-foreground">Cargando…</p>
  }

  const e = expense.data
  const categoryName = categories.data.find((c) => c.id === e.categoryId)?.name ?? 'Sin categoría'
  const payer = members.data.find((m) => m.id === e.paidBy)?.displayName ?? '—'

  if (e.source === 'PURCHASE') {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <BackLink to={listPath} />
        <h1 className="text-2xl font-semibold">Detalle de compra</h1>
        <p className="rounded-md bg-muted/40 p-3 text-sm">
          Este gasto proviene de una compra: es de solo lectura y no se puede editar ni eliminar.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="font-medium">Descripción</dt>
          <dd>{e.description}</dd>
          <dt className="font-medium">Monto</dt>
          <dd>{formatMoney(e.amount)}</dd>
          <dt className="font-medium">Fecha</dt>
          <dd>{formatDate(e.expenseDate)}</dd>
          <dt className="font-medium">Categoría</dt>
          <dd>{categoryName}</dd>
          <dt className="font-medium">Pagó</dt>
          <dd>{payer}</dd>
          <dt className="font-medium">Origen</dt>
          <dd>Compra</dd>
        </dl>
      </div>
    )
  }

  const updateProblem = update.error
    ? mapExpenseProblem(update.error, 'No pudimos guardar los cambios. Intentá de nuevo.')
    : null
  const removeProblem = remove.error
    ? mapExpenseProblem(remove.error, 'No pudimos eliminar el gasto. Intentá de nuevo.')
    : null

  function submit(input: ExpenseInput) {
    update.mutate({ id, input }, { onSuccess: () => navigate(listPath) })
  }

  function handleConfirmKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') setConfirming(false)
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <BackLink to={listPath} />
      <h1 className="text-2xl font-semibold">Editar gasto</h1>
      <ExpenseForm
        expense={e}
        currency={me.data.household.baseCurrency}
        timeZone={me.data.household.timezone}
        categories={categories.data}
        members={members.data}
        submitLabel="Guardar cambios"
        submitting={update.isPending}
        serverError={updateProblem?.message}
        serverFieldErrors={updateProblem?.fields}
        onSubmit={submit}
        onCancel={() => navigate(listPath)}
      />

      <section aria-labelledby="delete-heading" className="flex flex-col gap-2 border-t pt-4">
        <h2 id="delete-heading" className="text-base font-semibold">
          Eliminar gasto
        </h2>
        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="delete-confirm"
            onKeyDown={handleConfirmKeyDown}
            className="flex flex-col gap-2"
          >
            <p id="delete-confirm" className="text-sm">
              ¿Eliminar este gasto? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => remove.mutate(id, { onSuccess: () => navigate(listPath) })}
              >
                Confirmar eliminación
              </Button>
              <Button autoFocus variant="ghost" onClick={() => setConfirming(false)}>
                No eliminar
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button id="delete-expense" variant="outline" onClick={() => setConfirming(true)}>
              Eliminar
            </Button>
          </div>
        )}
        {removeProblem ? (
          <p role="alert" className="text-sm text-red-600">
            {removeProblem.message}
          </p>
        ) : null}
      </section>
    </div>
  )
}
