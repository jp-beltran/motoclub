import { describe, expect, it } from 'vitest'

import { assertPositiveIntegerQuantity } from './quantity'

describe('consumption quantities', () => {
  it('rejects zero, negative, and fractional quantities', () => {
    expect(() => assertPositiveIntegerQuantity(0)).toThrow('Quantity must be a positive integer')
    expect(() => assertPositiveIntegerQuantity(-1)).toThrow('Quantity must be a positive integer')
    expect(() => assertPositiveIntegerQuantity(1.5)).toThrow('Quantity must be a positive integer')
  })
})
