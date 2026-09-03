import { describe, expect, it } from 'vitest'

import { formatMargin } from './format-margin'

describe('formatMargin', () => {
  it('formats a zero margin', () => {
    expect(formatMargin(0)).toBe('0,0%')
  })

  it('formats a positive margin as a percentage with one decimal', () => {
    expect(formatMargin(0.271)).toBe('27,1%')
  })

  it('formats a negative margin with a leading sign', () => {
    expect(formatMargin(-0.5)).toBe('-50,0%')
  })
})
