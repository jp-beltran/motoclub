import { EVENT_STATUS, PAYMENT_STATUS, TAB_STATUS, type PaymentStatus, type TabStatus } from '../../domain/constants'
import type { Event } from '../../domain/entities'

const TAB_STATUS_LABELS: Record<TabStatus, string> = {
  [TAB_STATUS.OPEN]: 'Aberta',
  [TAB_STATUS.CLOSED]: 'Fechada',
}

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PAYMENT_STATUS.UNPAID]: 'Não pago',
  [PAYMENT_STATUS.PARTIAL]: 'Parcial',
  [PAYMENT_STATUS.PAID]: 'Pago',
}

export function formatTabStatusLabel(status: TabStatus): string {
  return TAB_STATUS_LABELS[status]
}

export function formatPaymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status]
}

/** An event tab can only be closed/reopened while its own event is active. */
export function isEventActive(event: Event | undefined): boolean {
  return event?.status === EVENT_STATUS.ACTIVE
}
