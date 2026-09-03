import { PAYMENT_STATUS, type PaymentStatus } from '../domain/constants'

const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  [PAYMENT_STATUS.UNPAID]: 'Não pago',
  [PAYMENT_STATUS.PARTIAL]: 'Parcial',
  [PAYMENT_STATUS.PAID]: 'Pago',
}

const PAYMENT_STATUS_TONE_CLASSES: Readonly<Record<PaymentStatus, string>> = {
  [PAYMENT_STATUS.UNPAID]: 'text-accent',
  [PAYMENT_STATUS.PARTIAL]: 'text-warning',
  [PAYMENT_STATUS.PAID]: 'text-positive',
}

/**
 * The pt-BR label and Tailwind tone class for a `PaymentStatus`, shared by
 * every screen that renders one (`/comandas` and `/pagamentos`). Lives in
 * the application layer, like `error-messages.ts`, because more than one
 * area needs it: an area must never reach into another area's UI folder
 * for it. The two areas' independent copies had already diverged in tone
 * before this consolidation — "Não pago" rendered one color on one screen
 * and a different one on the other.
 */
export function formatPaymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status]
}

export function getPaymentStatusTone(status: PaymentStatus): string {
  return PAYMENT_STATUS_TONE_CLASSES[status]
}
