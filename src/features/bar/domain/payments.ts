import { PAYMENT_STATUS, type PaymentStatus } from './constants'
import type { Payment } from './entities'
import { addCents, assertNonNegativeCents, assertPositiveCents } from './money'

export interface PaymentSummary {
  readonly paidCents: number
  readonly remainingCents: number
  readonly status: PaymentStatus
}

export function summarizePayments(
  amountDueCents: number,
  payments: readonly Payment[],
): PaymentSummary {
  assertNonNegativeCents(amountDueCents)
  payments.forEach(({ amountCents }) => assertPositiveCents(amountCents))

  const paidCents = payments.reduce(
    (total, currentPayment) => addCents(total, currentPayment.amountCents),
    0,
  )
  const remainingCents = Math.max(amountDueCents - paidCents, 0)
  const status = getPaymentStatus(amountDueCents, paidCents)

  return { paidCents, remainingCents, status }
}

function getPaymentStatus(amountDueCents: number, paidCents: number): PaymentStatus {
  if (paidCents === 0) return PAYMENT_STATUS.UNPAID
  if (paidCents < amountDueCents) return PAYMENT_STATUS.PARTIAL
  return PAYMENT_STATUS.PAID
}
