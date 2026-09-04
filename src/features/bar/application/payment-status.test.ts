import { describe, expect, it } from 'vitest'

import { PAYMENT_STATUS } from '../domain/constants'
import {
  NOTHING_TO_CHARGE_LABEL,
  describePaymentStatus,
  formatPaymentStatusLabel,
  getPaymentStatusTone,
} from './payment-status'

describe('formatPaymentStatusLabel', () => {
  it('labels unpaid in pt-BR', () => {
    expect(formatPaymentStatusLabel(PAYMENT_STATUS.UNPAID)).toBe('Não pago')
  })

  it('labels partial in pt-BR', () => {
    expect(formatPaymentStatusLabel(PAYMENT_STATUS.PARTIAL)).toBe('Parcial')
  })

  it('labels paid in pt-BR', () => {
    expect(formatPaymentStatusLabel(PAYMENT_STATUS.PAID)).toBe('Pago')
  })
})

describe('getPaymentStatusTone', () => {
  it('gives each payment status a distinct tone class', () => {
    const tones = [
      getPaymentStatusTone(PAYMENT_STATUS.UNPAID),
      getPaymentStatusTone(PAYMENT_STATUS.PARTIAL),
      getPaymentStatusTone(PAYMENT_STATUS.PAID),
    ]
    expect(new Set(tones).size).toBe(3)
  })

  it('does not tone unpaid as positive or paid as a warning', () => {
    expect(getPaymentStatusTone(PAYMENT_STATUS.UNPAID)).not.toBe('text-positive')
    expect(getPaymentStatusTone(PAYMENT_STATUS.PAID)).not.toBe('text-warning')
  })
})

describe('describePaymentStatus', () => {
  it('reads a real balance exactly as the status labels do', () => {
    ;[PAYMENT_STATUS.UNPAID, PAYMENT_STATUS.PARTIAL, PAYMENT_STATUS.PAID].forEach((status) => {
      expect(describePaymentStatus(status, 1_200)).toEqual({
        label: formatPaymentStatusLabel(status),
        toneClass: getPaymentStatusTone(status),
      })
    })
  })

  it('calls a zero total nothing to charge instead of "Não pago"', () => {
    // Ruling 29: summarizePayments is right that nothing has been paid, and
    // the payment ceiling in the repository depends on it. What is wrong is
    // telling the operator that a courtesy-only tab is an outstanding debt —
    // so it is fixed here, in the presentation.
    expect(describePaymentStatus(PAYMENT_STATUS.UNPAID, 0)).toEqual({
      label: NOTHING_TO_CHARGE_LABEL,
      toneClass: 'text-content-muted',
    })
  })

  it('never dresses a zero total in the unpaid tone', () => {
    expect(describePaymentStatus(PAYMENT_STATUS.UNPAID, 0).toneClass).not.toBe(
      getPaymentStatusTone(PAYMENT_STATUS.UNPAID),
    )
  })

  it('says it in pt-BR', () => {
    expect(NOTHING_TO_CHARGE_LABEL).toBe('Sem valor a cobrar')
  })
})
