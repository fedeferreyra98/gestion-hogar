import { Link, useParams } from 'react-router-dom'
import { isProblemError } from '@/api/errors'
import { useMembers } from '@/api/hooks/useExpenses'
import { useMe } from '@/api/hooks/useMe'
import { useShoppingList } from '@/api/hooks/useShoppingLists'
import { Button } from '@/components/ui/button'
import { CompleteListWizard } from '@/shopping/complete/CompleteListWizard'

export function CompleteListPage() {
  const { id = '' } = useParams()
  // key: reinicia el wizard si se navega a otra lista.
  return <CompleteList key={id} id={id} />
}

function CompleteList({ id }: { id: string }) {
  const list = useShoppingList(id)
  const me = useMe()
  const members = useMembers()

  if (list.isLoading || me.isLoading || members.isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Cargando…
      </p>
    )

  const notFound = isProblemError(list.error) && list.error.status === 404
  if (list.isError || me.isError || members.isError || !list.data || !me.data || !members.data)
    return (
      <section className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-red-600">
          {notFound ? 'No encontramos esa lista.' : 'No pudimos cargar los datos de la compra.'}
        </p>
        <div className="flex gap-3">
          {!notFound && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void list.refetch()
                void me.refetch()
                void members.refetch()
              }}
            >
              Reintentar
            </Button>
          )}
          <Link to="/listas" className="text-sm underline">
            Volver a las listas
          </Link>
        </div>
      </section>
    )

  if (list.data.status !== 'OPEN')
    return (
      <section className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-red-600">
          Esta lista ya fue completada o archivada: no se puede registrar la compra.
        </p>
        <div className="flex gap-3 text-sm">
          <Link to={`/listas/${id}`} className="underline">
            Volver a la lista
          </Link>
          <Link to="/gastos" className="underline">
            Ver gastos
          </Link>
        </div>
      </section>
    )

  return (
    <CompleteListWizard
      list={list.data}
      currency={me.data.household.baseCurrency}
      timeZone={me.data.household.timezone}
      members={members.data}
      defaultPaidBy={me.data.member.id}
    />
  )
}
