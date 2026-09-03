import { describe, expect, it } from 'vitest'

import { formatMonth, getCurrentMonth } from './date'

describe('getCurrentMonth', () => {
  it('formats the given date as YYYY-MM', () => {
    expect(getCurrentMonth(new Date('2026-09-12T20:00:00.000Z'))).toBe('2026-09')
  })

  it('pads single-digit months', () => {
    expect(getCurrentMonth(new Date('2026-01-12T20:00:00.000Z'))).toBe('2026-01')
  })

  it('defaults to the current date when no argument is given', () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')

    expect(getCurrentMonth()).toBe(`${year}-${month}`)
  })
})

describe('formatMonth', () => {
  it('formats September 2026 in pt-BR', () => {
    expect(formatMonth('2026-09')).toBe('setembro de 2026')
  })

  it('formats January in pt-BR', () => {
    expect(formatMonth('2026-01')).toBe('janeiro de 2026')
  })

  it('formats December in pt-BR', () => {
    expect(formatMonth('2026-12')).toBe('dezembro de 2026')
  })
})
