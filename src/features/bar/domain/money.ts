export const INVALID_CENTS_MESSAGE = 'Money amounts must use integer cents'

export function assertIntegerCents(amountCents: number): void {
  if (!Number.isInteger(amountCents)) {
    throw new Error(INVALID_CENTS_MESSAGE)
  }
}
