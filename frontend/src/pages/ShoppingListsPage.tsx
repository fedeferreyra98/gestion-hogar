import { keepPreviousData } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  useArchiveShoppingList,
  useCreateShoppingList,
  useDuplicateShoppingList,
  useShoppingLists,
} from '@/api/hooks/useShoppingLists'
import type { ShoppingListStatus, ShoppingListSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { ArchiveAction } from '@/shopping/ArchiveAction'
import { STATUS_LABELS, problemMessage } from '@/shopping/status'

const PAGE_SIZE = 20
const FILTERS: ShoppingListStatus[] = ['OPEN', 'COMPLETED', 'ARCHIVED']

export function ShoppingListsPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<ShoppingListStatus>('OPEN')
  const [name, setName] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useShoppingLists(
    { status, page, size: PAGE_SIZE },
    { placeholderData: keepPreviousData },
  )
  const createList = useCreateShoppingList()
  const duplicateList = useDuplicateShoppingList()
  const archiveList = useArchiveShoppingList()
  const lists = data?.content ?? []

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Ingresá un nombre para la lista.')
      return
    }
    setError(null)
    try {
      const created = await createList.mutateAsync(trimmed)
      setName('')
      void navigate(`/listas/${created.id}`)
    } catch {
      setError('No pudimos crear la lista. Intentá de nuevo.')
    }
  }

  async function handleDuplicate(list: ShoppingListSummary) {
    setError(null)
    try {
      const copy = await duplicateList.mutateAsync(list.id)
      void navigate(`/listas/${copy.id}`)
    } catch {
      setError('No pudimos duplicar la lista.')
    }
  }

  async function handleArchive(list: ShoppingListSummary) {
    setError(null)
    try {
      await archiveList.mutateAsync(list.id)
    } catch (err) {
      setError(problemMessage(err, 'No pudimos archivar la lista.'))
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Listas</h1>

      <form onSubmit={(e) => void handleCreate(e)} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <label htmlFor="new-list-name" className="text-sm font-medium">
            Nueva lista
          </label>
          <input
            id="new-list-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Ej.: Compra semanal"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <Button type="submit" disabled={createList.isPending}>
          Crear lista
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s)
              setPage(0)
            }}
          >
            {s === 'OPEN' ? 'Abiertas' : s === 'COMPLETED' ? 'Completadas' : 'Archivadas'}
          </Button>
        ))}
      </div>

      {isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando listas…
        </p>
      )}
      {isError && (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-600">
          No pudimos cargar las listas.
          <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      )}
      {!isLoading && !isError && lists.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay listas{' '}
          {status === 'OPEN' ? 'abiertas' : status === 'COMPLETED' ? 'completadas' : 'archivadas'}.
        </p>
      )}

      <ul aria-label="Listas de compra" className="flex flex-col gap-2">
        {lists.map((list) => (
          <li
            key={list.id}
            className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <Link
                to={`/listas/${list.id}`}
                className="break-words font-medium underline-offset-2 hover:underline"
              >
                {list.name}
              </Link>
              <p className="text-sm text-muted-foreground">
                {list.checkedCount} de {list.itemCount} tildados · {STATUS_LABELS[list.status]}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Duplicar ${list.name}`}
                disabled={duplicateList.isPending}
                onClick={() => void handleDuplicate(list)}
              >
                Duplicar
              </Button>
              {list.status === 'OPEN' && (
                <ArchiveAction
                  label="Archivar"
                  triggerAriaLabel={`Archivar ${list.name}`}
                  confirmAriaLabel={`Confirmar archivar ${list.name}`}
                  disabled={archiveList.isPending}
                  onConfirm={() => void handleArchive(list)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      {data && data.totalPages > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm" aria-live="polite">
            Página {page + 1} de {data.totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page + 1 >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </nav>
      )}
    </section>
  )
}
