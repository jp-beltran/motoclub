import { PAYMENT_STATUS, TAB_STATUS, type PaymentStatus, type TabStatus } from '../../domain/constants'
import { formatPaymentStatusLabel, formatTabStatusLabel } from './tab-status'

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
}

const PAYMENT_STATUS_TONE: Record<PaymentStatus, string> = {
  [PAYMENT_STATUS.UNPAID]: 'text-accent',
  [PAYMENT_STATUS.PARTIAL]: 'text-warning',
  [PAYMENT_STATUS.PAID]: 'text-positive',
}

/** Always paired with its pt-BR text — color alone never carries the state. */
export function PaymentStatusBadge({ status }: PaymentStatusBadgeProps) {
  return (
    <span className={`text-sm font-semibold ${PAYMENT_STATUS_TONE[status]}`}>
      {formatPaymentStatusLabel(status)}
    </span>
  )
}
