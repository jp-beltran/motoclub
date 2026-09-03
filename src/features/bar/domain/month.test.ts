import { describe, expect, it } from 'vitest'

import { getMonthKey } from './month'

describe('month keys', () => {
  it('uses the local month of the instant instead of the UTC month', () => {
    const lastLocalMinuteOfSeptember = new Date(2026, 8, 30, 23, 59)
    const firstLocalMinuteOfOctober = new Date(2026, 9, 1, 0, 0)

    expect(getMonthKey(lastLocalMinuteOfSeptember.toISOString())).toBe('2026-09')
    expect(getMonthKey(firstLocalMinuteOfOctober.toISOString())).toBe('2026-10')
  })

  it('keeps the first local instant of a month out of the previous one', () => {
    const lastLocalMinuteOfAugust = new Date(2026, 7, 31, 23, 59)
    const firstLocalMinuteOfSeptember = new Date(2026, 8, 1, 0, 0)

    expect(getMonthKey(lastLocalMinuteOfAugust.toISOString())).toBe('2026-08')
    expect(getMonthKey(firstLocalMinuteOfSeptember.toISOString())).toBe('2026-09')
  })

  it('pads single digit months to YYYY-MM', () => {
    expect(getMonthKey(new Date(2026, 0, 5, 12, 0).toISOString())).toBe('2026-01')
  })

  it('rejects a timestamp it cannot parse', () => {
    expect(() => getMonthKey('not-a-timestamp')).toThrow(
      'Timestamp must be a parseable date',
    )
  })
})
