import { describe, it } from 'vitest'

import { expectBarErrorCode } from '../../../test/bar-error-assertions'
import { assertPositiveIntegerQuantity } from './quantity'

describe('consumption quantities', () => {
  it('rejects zero, negative, and fractional quantities', () => {
    expectBarErrorCode(() => assertPositiveIntegerQuantity(0), 'quantity-invalid')
    expectBarErrorCode(() => assertPositiveIntegerQuantity(-1), 'quantity-invalid')
    expectBarErrorCode(() => assertPositiveIntegerQuantity(1.5), 'quantity-invalid')
  })
})
