import { BarError } from './errors'

export const INVALID_NON_NEGATIVE_CENTS_MESSAGE =
  'Money amounts must use non-negative safe integer cents'
export const INVALID_POSITIVE_CENTS_MESSAGE =
  'Money amounts must use positive safe integer cents'
export const UNSAFE_CENTS_TOTAL_MESSAGE = 'Money total exceeds safe integer cents'
export const UNSAFE_CENTS_PRODUCT_MESSAGE =
  'Money product exceeds safe integer cents'

export function assertNonNegativeCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new BarError('money-amount-invalid', INVALID_NON_NEGATIVE_CENTS_MESSAGE)
  }
}

export function assertPositiveCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new BarError('money-amount-not-positive', INVALID_POSITIVE_CENTS_MESSAGE)
  }
}

export function addCents(leftCents: number, rightCents: number): number {
  const totalCents = leftCents + rightCents
  if (!Number.isSafeInteger(totalCents)) {
    throw new BarError('money-total-overflow', UNSAFE_CENTS_TOTAL_MESSAGE)
  }
  return totalCents
}

export function multiplyCents(amountCents: number, quantity: number): number {
  const productCents = amountCents * quantity
  if (!Number.isSafeInteger(productCents)) {
    throw new BarError('money-product-overflow', UNSAFE_CENTS_PRODUCT_MESSAGE)
  }
  return productCents
}
