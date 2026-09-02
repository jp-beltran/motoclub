export const INVALID_NON_NEGATIVE_CENTS_MESSAGE =
  'Money amounts must use non-negative safe integer cents'
export const INVALID_POSITIVE_CENTS_MESSAGE =
  'Money amounts must use positive safe integer cents'
export const UNSAFE_CENTS_TOTAL_MESSAGE = 'Money total exceeds safe integer cents'

export function assertNonNegativeCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error(INVALID_NON_NEGATIVE_CENTS_MESSAGE)
  }
}

export function assertPositiveCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(INVALID_POSITIVE_CENTS_MESSAGE)
  }
}

export function addCents(leftCents: number, rightCents: number): number {
  const totalCents = leftCents + rightCents
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error(UNSAFE_CENTS_TOTAL_MESSAGE)
  }
  return totalCents
}
