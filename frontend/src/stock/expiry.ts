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
