import { describe, expect, it } from 'vitest'

import { parsePaymentAmount, parsePaymentAmountToCents } from './payment-amount'

describe('parsePaymentAmountToCents', () => {
  it('parses a comma-decimal value into cents', () => {
    expect(parsePaymentAmountToCents('12,50')).toBe(1250)
  })

  it('parses a dot-decimal value into cents', () => {
    expect(parsePaymentAmountToCents('12.50')).toBe(1250)
  })

  it('parses an integer value into cents', () => {
    expect(parsePaymentAmountToCents('30')).toBe(3000)
  })

  it('pads a single decimal digit', () => {
    expect(parsePaymentAmountToCents('12,5')).toBe(1250)
  })

  it('returns undefined for an empty value', () => {
    expect(parsePaymentAmountToCents('   ')).toBeUndefined()
  })

  it('returns undefined for a non-numeric value', () => {
    expect(parsePaymentAmountToCents('abc')).toBeUndefined()
  })

  it('returns undefined for more than two decimal digits', () => {
    expect(parsePaymentAmountToCents('12,555')).toBeUndefined()
  })

  it('returns undefined for a negative value', () => {
    expect(parsePaymentAmountToCents('-5')).toBeUndefined()
  })
})

describe('parsePaymentAmount', () => {
  it('accepts a positive amount within the remaining balance', () => {
    expect(parsePaymentAmount('5,00', 1000)).toEqual({ ok: true, amountCents: 500 })
  })

  it('accepts an amount equal to the remaining balance', () => {
    expect(parsePaymentAmount('10,00', 1000)).toEqual({ ok: true, amountCents: 1000 })
  })

  it('rejects a zero amount before it would reach the repository', () => {
    const result = parsePaymentAmount('0', 1000)
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid amount before it would reach the repository', () => {
    const result = parsePaymentAmount('abc', 1000)
    expect(result.ok).toBe(false)
  })

  it('rejects an amount greater than the remaining balance, naming the balance', () => {
    const result = parsePaymentAmount('15,00', 1000)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('R$ 10,00')
  })
})
