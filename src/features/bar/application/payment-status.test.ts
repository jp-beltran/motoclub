import { describe, expect, it } from 'vitest'

import { PAYMENT_STATUS } from '../domain/constants'
import { formatPaymentStatusLabel, getPaymentStatusTone } from './payment-status'

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
