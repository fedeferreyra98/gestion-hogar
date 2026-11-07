import type { ProblemError } from '@/api/errors'
import { useDeleteShoppingListItem, useToggleShoppingListItem } from '@/api/hooks/useShoppingLists'
import type { ShoppingListItem } from '@/api/types'
import { UNIT_SHORT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { formatDecimal } from '@/lib/decimal'
import { problemMessage } from '@/shopping/status'

interface ShoppingItemRowProps {
  listId: string
  item: ShoppingListItem
  readOnly: boolean
  onMessage: (message: string | null) => void
}

export function ShoppingItemRow({ listId, item, readOnly, onMessage }: ShoppingItemRowProps) {
  const toggle = useToggleShoppingListItem(listId, item.id, (err: ProblemError) =>
    onMessage(problemMessage(err, `No pudimos actualizar ${item.product.name}.`)),
  )
  const remove = useDeleteShoppingListItem(listId, item.id, (err: ProblemError) =>
    onMessage(problemMessage(err, `No pudimos quitar ${item.product.name}.`)),
  )

  return (
    <li className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      <input
        id={`item-${item.id}`}
        type="checkbox"
        checked={item.checked}
        disabled={readOnly}
        onChange={(e) => {
          onMessage(null)
          toggle.mutate(e.target.checked)
        }}
        className="size-6 shrink-0"
      />
      <label
        htmlFor={`item-${item.id}`}
        className={`min-w-0 flex-1 break-words text-sm ${item.checked ? 'text-muted-foreground line-through' : ''}`}
      >
        <span className="font-medium">{item.product.name}</span>{' '}
        <span>
          {formatDecimal(item.quantity)} {UNIT_SHORT_LABELS[item.unit]}
        </span>
        {item.note && <span className="block text-xs">{item.note}</span>}
      </label>
      {!readOnly && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Quitar ${item.product.name}`}
          disabled={remove.isPending}
          onClick={() => {
            onMessage(null)
            remove.mutate()
          }}
        >
          Quitar
        </Button>
      )}
    </li>
  )
}
