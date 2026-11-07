import type { ExpiryStatus } from '@/api/types'
import { EXPIRY_META } from './expiry'

/** Status is conveyed by icon + text, never by color alone. */
export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const { label, icon: Icon, className } = EXPIRY_META[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </span>
  )
}
