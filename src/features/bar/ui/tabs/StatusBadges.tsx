import { TAB_STATUS, type PaymentStatus, type TabStatus } from '../../domain/constants'
import { describePaymentStatus } from '../../application/payment-status'
import { formatTabStatusLabel } from './tab-status'

export interface TabStatusBadgeProps {
  readonly status: TabStatus
}

/** Always paired with its pt-BR text — color alone never carries the state. */
export function TabStatusBadge({ status }: TabStatusBadgeProps) {
  const tone = status === TAB_STATUS.OPEN ? 'text-positive' : 'text-content-muted'
  return <span className={`text-sm font-semibold ${tone}`}>{formatTabStatusLabel(status)}</span>
}

export interface PaymentStatusBadgeProps {
  readonly status: PaymentStatus
  /** What the tab actually owed: a zero total is not a debt to report. */
  readonly amountDueCents: number
}

/**
 * Always paired with its pt-BR text — color alone never carries the state.
 * Label and tone come from application/payment-status.ts, shared with
 * /pagamentos and /fechamento so the same status never renders in two
 * different words or two different colors.
 */
export function PaymentStatusBadge({ status, amountDueCents }: PaymentStatusBadgeProps) {
  const { label, toneClass } = describePaymentStatus(status, amountDueCents)
  return <span className={`text-sm font-semibold ${toneClass}`}>{label}</span>
}
