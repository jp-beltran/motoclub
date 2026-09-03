import { TAB_STATUS, type PaymentStatus, type TabStatus } from '../../domain/constants'
import { formatPaymentStatusLabel, getPaymentStatusTone } from '../../application/payment-status'
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
}

/**
 * Always paired with its pt-BR text — color alone never carries the state.
 * Label and tone come from application/payment-status.ts, shared with
 * /pagamentos so the same status never renders in two different colors.
 */
export function PaymentStatusBadge({ status }: PaymentStatusBadgeProps) {
  return (
    <span className={`text-sm font-semibold ${getPaymentStatusTone(status)}`}>
      {formatPaymentStatusLabel(status)}
    </span>
  )
}
