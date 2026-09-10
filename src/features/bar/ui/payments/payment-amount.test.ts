import { describe, expect, it } from 'vitest'

import { parsePaymentAmount } from './payment-amount'

// The parse itself is `shared/format.ts#parseCentsInput`, tested in
// `src/shared/format.test.ts` — one implementation for every money field the
// operator types, here and in /itens. What stays this module's own job, and
// is what the cases below cover, is the payment rule on top of it: positive,
// and never above what is still owed.
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
