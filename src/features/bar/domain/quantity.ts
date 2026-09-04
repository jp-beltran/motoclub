import { BarError } from './errors'

export const INVALID_QUANTITY_MESSAGE = 'Quantity must be a positive integer'

export function assertPositiveIntegerQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new BarError('quantity-invalid', INVALID_QUANTITY_MESSAGE)
  }
}
