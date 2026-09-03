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

/** Nothing was ever chargeable here — a courtesy-only tab or statement. */
export const NOTHING_TO_CHARGE_LABEL = 'Sem valor a cobrar'

const NOTHING_TO_CHARGE_TONE = 'text-content-muted'

export interface PaymentStatusView {
  readonly label: string
  readonly toneClass: string
}

/**
 * How a payment status should read on screen, given what was actually owed.
 *
 * `summarizePayments(0, [])` returns `unpaid`, which is true for the domain —
 * nothing has been paid — and the repository's payment ceiling depends on
 * that being so. But rendering it makes a courtesy-only tab appear on
 * `/comandas` as a red R$ 0,00 debt while `/pagamentos` correctly refuses to
 * list it: one screen contradicting the other about the same tab. Ruling 29
 * fixes it here, in the presentation, rather than in the domain: with nothing
 * to charge, the screen says so instead of reporting a settlement state.
 */
export function describePaymentStatus(
  status: PaymentStatus,
  amountDueCents: number,
): PaymentStatusView {
  if (amountDueCents === 0) {
    return { label: NOTHING_TO_CHARGE_LABEL, toneClass: NOTHING_TO_CHARGE_TONE }
  }
  return { label: formatPaymentStatusLabel(status), toneClass: getPaymentStatusTone(status) }
}
