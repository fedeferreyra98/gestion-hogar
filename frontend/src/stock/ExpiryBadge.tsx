import { AlertTriangle, CheckCircle2, CircleSlash, Clock, type LucideIcon } from 'lucide-react'
import type { ExpiryStatus } from '@/api/types'

export const EXPIRY_META: Record<
  ExpiryStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  EXPIRED: {
    label: 'Vencido',
    icon: AlertTriangle,
    className: 'border-red-700 bg-red-50 text-red-900',
  },
  EXPIRING_SOON: {
    label: 'Por vencer',
    icon: Clock,
    className: 'border-amber-700 bg-amber-50 text-amber-900',
  },
  OK: {
    label: 'Vigente',
    icon: CheckCircle2,
    className: 'border-green-700 bg-green-50 text-green-900',
  },
  NO_EXPIRY: {
    label: 'Sin vencimiento',
    icon: CircleSlash,
    className: 'border-border bg-muted text-foreground',
  },
}

/** Status is conveyed by icon + text, never by color alone. */
export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const { label, icon: Icon, className } = EXPIRY_META[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  )
}
