import { describe, expect, it } from 'vitest'

import { BarError, isBarError, type BarErrorCode } from './errors'

describe('BarError', () => {
  it('carries the code as the contract and the English sentence as detail', () => {
    const error = new BarError('tab-closed', 'Cannot add consumption to a closed tab')

    expect(error.code).toBe('tab-closed')
    expect(error.message).toBe('Cannot add consumption to a closed tab')
    expect(error.name).toBe('BarError')
  })

  it('is a real Error, so existing catch/reject plumbing keeps working', () => {
    const error = new BarError('quantity-invalid', 'Quantity must be a positive integer')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(BarError)
    expect(error.stack).toBeDefined()
  })

  it('exposes the code as an own enumerable property, so it survives structured reads', () => {
    const error = new BarError('item-not-found', 'Item not found')

    expect(Object.keys(error)).toContain('code')
    expect({ ...error }).toMatchObject({ code: 'item-not-found' })
  })
})

describe('isBarError', () => {
  it('recognises a coded failure', () => {
    expect(isBarError(new BarError('event-not-active', 'Event must be active'))).toBe(true)
  })

  it('rejects a plain Error and a non-error value alike', () => {
    expect(isBarError(new Error('Event must be active'))).toBe(false)
    expect(isBarError('boom')).toBe(false)
    expect(isBarError(undefined)).toBe(false)
    expect(isBarError({ code: 'event-not-active' })).toBe(false)
  })

  it('narrows to the coded union for the caller', () => {
    const error: unknown = new BarError('payment-exceeds-balance', 'Payment cannot exceed the amount due')

    if (!isBarError(error)) throw new Error('expected a BarError')

    const code: BarErrorCode = error.code
    expect(code).toBe('payment-exceeds-balance')
  })
})
