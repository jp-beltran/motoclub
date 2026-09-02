import { describe, expect, it } from 'vitest'

import { PAYMENT_STATUS, PAYMENT_TARGET } from './constants'
import type { Payment } from './entities'
import { summarizePayments } from './payments'

const payment = (id: string, amountCents: number): Payment => ({
  id,
  target: PAYMENT_TARGET.TAB,
  targetId: 'tab-1',
  amountCents,
  paidAt: '2026-09-02T12:00:00.000Z',
  actorId: 'actor-1',
})

describe('payment rules', () => {
  it('derives unpaid, partial, and paid status with remaining balance', () => {
    expect(summarizePayments(1_000, [])).toEqual({
      paidCents: 0,
      remainingCents: 1_000,
      status: PAYMENT_STATUS.UNPAID,
    })
    expect(summarizePayments(1_000, [payment('payment-1', 300), payment('payment-2', 200)])).toEqual({
      paidCents: 500,
      remainingCents: 500,
      status: PAYMENT_STATUS.PARTIAL,
    })
    expect(summarizePayments(1_000, [payment('payment-1', 1_000)])).toEqual({
      paidCents: 1_000,
      remainingCents: 0,
      status: PAYMENT_STATUS.PAID,
    })
  })

  it('rejects fractional cent amounts', () => {
    expect(() => summarizePayments(1_000.5, [])).toThrow(
      'Money amounts must use non-negative safe integer cents',
    )
    expect(() => summarizePayments(1_000, [payment('payment-1', 100.5)])).toThrow(
      'Money amounts must use positive safe integer cents',
    )
  })

  it.each([-1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid amount due of %s cents',
    (amountDueCents) => {
      expect(() => summarizePayments(amountDueCents, [])).toThrow(
        'Money amounts must use non-negative safe integer cents',
      )
    },
  )

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid payment of %s cents',
    (amountCents) => {
      expect(() =>
        summarizePayments(1_000, [payment('payment-1', amountCents)]),
      ).toThrow('Money amounts must use positive safe integer cents')
    },
  )

  it('rejects payment totals that overflow safe integer cents', () => {
    expect(() =>
      summarizePayments(Number.MAX_SAFE_INTEGER, [
        payment('payment-1', Number.MAX_SAFE_INTEGER),
        payment('payment-2', 1),
      ]),
    ).toThrow('Money total exceeds safe integer cents')
  })
})
