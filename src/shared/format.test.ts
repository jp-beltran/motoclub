import { describe, expect, it } from 'vitest'

import { formatCents, formatDateTime, formatQuantity, parseCentsInput } from './format'

describe('formatCents', () => {
  it('formats zero cents', () => {
    expect(formatCents(0)).toBe('R$ 0,00')
  })

  it('formats a single cent', () => {
    expect(formatCents(1)).toBe('R$ 0,01')
  })

  it('formats cents under one real', () => {
    expect(formatCents(999)).toBe('R$ 9,99')
  })

  it('formats cents with thousands grouping', () => {
    expect(formatCents(123456)).toBe('R$ 1.234,56')
  })

  it('formats negative cents with a leading sign', () => {
    expect(formatCents(-123456)).toBe('-R$ 1.234,56')
  })
})

/**
 * The one parse for money the operator types, so "12,50" becomes 1250 in
 * exactly one place. The cases below came from
 * `ui/payments/payment-amount.test.ts`, which is where this function used to
 * live before /itens needed the same parse for a price and a cost.
 */
describe('parseCentsInput', () => {
  it('parses a comma-decimal value into cents', () => {
    expect(parseCentsInput('12,50')).toBe(1250)
  })

  it('parses a dot-decimal value into cents', () => {
    expect(parseCentsInput('12.50')).toBe(1250)
  })

  it('parses an integer value into cents', () => {
    expect(parseCentsInput('30')).toBe(3000)
  })

  it('pads a single decimal digit', () => {
    expect(parseCentsInput('12,5')).toBe(1250)
  })

  it('parses zero', () => {
    expect(parseCentsInput('0')).toBe(0)
  })

  it('round-trips through formatCents without touching a float', () => {
    expect(parseCentsInput('1.234,56'.replace('.', ''))).toBe(123456)
    expect(formatCents(parseCentsInput('12,50')!)).toBe('R$ 12,50')
  })

  it('returns undefined for an empty value', () => {
    expect(parseCentsInput('   ')).toBeUndefined()
  })

  it('returns undefined for a non-numeric value', () => {
    expect(parseCentsInput('abc')).toBeUndefined()
  })

  it('returns undefined for more than two decimal digits', () => {
    expect(parseCentsInput('12,555')).toBeUndefined()
  })

  it('returns undefined for a negative value', () => {
    expect(parseCentsInput('-5')).toBeUndefined()
  })
})

describe('formatQuantity', () => {
  it('formats zero', () => {
    expect(formatQuantity(0)).toBe('0')
  })

  it('formats small integers', () => {
    expect(formatQuantity(5)).toBe('5')
  })

  it('formats large integers with thousands grouping', () => {
    expect(formatQuantity(1234)).toBe('1.234')
  })
})

describe('formatDateTime', () => {
  it('formats an ISO instant as dd/mm/aaaa HH:mm in local time', () => {
    const date = new Date('2026-09-12T20:05:00.000Z')
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')

    expect(formatDateTime('2026-09-12T20:05:00.000Z')).toBe(
      `${day}/${month}/${year} ${hours}:${minutes}`,
    )
  })

  it('pads single-digit day, month, hour and minute', () => {
    const date = new Date('2026-01-05T03:07:00.000Z')
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')

    expect(formatDateTime('2026-01-05T03:07:00.000Z')).toBe(
      `${day}/${month}/${year} ${hours}:${minutes}`,
    )
  })
})
