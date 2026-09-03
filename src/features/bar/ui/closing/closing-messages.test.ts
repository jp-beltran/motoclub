import { describe, expect, it } from 'vitest'

import { describeClosingError } from './closing-messages'

describe('describeClosingError', () => {
  it('translates the repository message for a month already closed', () => {
    expect(describeClosingError(new Error('Monthly closing already exists'))).toBe(
      'Este mês já foi fechado. Não é possível fechá-lo novamente.',
    )
  })

  it('falls back to a generic retry message for any other error', () => {
    expect(describeClosingError(new Error('boom'))).toBe(
      'Não foi possível fechar o mês. Tente novamente.',
    )
  })

  it('falls back to the generic message when the value is not an Error', () => {
    expect(describeClosingError('not an error')).toBe(
      'Não foi possível fechar o mês. Tente novamente.',
    )
  })
})
