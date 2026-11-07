import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

interface ArchiveActionProps {
  /** Visible text of the trigger button. */
  label: string
  /** Accessible name of the trigger when the visible text is not enough. */
  triggerAriaLabel?: string
  /** Accessible name of the confirm button. */
  confirmAriaLabel: string
  disabled?: boolean
  onConfirm: () => void
}

/** Inline two-step confirmation (same pattern as the stock discard); focus is managed. */
export function ArchiveAction({
  label,
  triggerAriaLabel,
  confirmAriaLabel,
  disabled,
  onConfirm,
}: ArchiveActionProps) {
  const [confirming, setConfirming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      triggerRef.current?.focus()
    }
  }, [confirming])

  if (confirming) {
    return (
      <>
        <Button
          ref={confirmRef}
          type="button"
          size="sm"
          disabled={disabled}
          aria-label={confirmAriaLabel}
          onClick={() => {
            setConfirming(false)
            onConfirm()
          }}
        >
          Confirmar archivado
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            returnFocus.current = true
            setConfirming(false)
          }}
        >
          Cancelar
        </Button>
      </>
    )
  }
  return (
    <Button
      ref={triggerRef}
      type="button"
      size="sm"
      variant="outline"
      aria-label={triggerAriaLabel}
      disabled={disabled}
      onClick={() => setConfirming(true)}
    >
      {label}
    </Button>
  )
}
