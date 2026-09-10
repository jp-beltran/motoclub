import { formatCents, parseCentsInput } from '../../../../shared/format'

export type ParsedPaymentAmount =
  | { readonly ok: true; readonly amountCents: number }
  | { readonly ok: false; readonly error: string }

/**
 * Validates a raw payment amount input before it is ever sent to the
 * repository: it must be a positive amount and must not exceed what is
 * still owed (`recordPayment` has no refund mechanism and rejects any
 * amount above the remaining balance).
 */
export function parsePaymentAmount(
  rawValue: string,
  remainingCents: number,
): ParsedPaymentAmount {
  const amountCents = parseCentsInput(rawValue)

  if (amountCents === undefined || amountCents <= 0) {
    return { ok: false, error: 'Informe um valor de pagamento válido, maior que zero.' }
  }

  if (amountCents > remainingCents) {
    return {
      ok: false,
      error: `O valor informado é maior do que o saldo em aberto (${formatCents(remainingCents)}).`,
    }
  }

  return { ok: true, amountCents }
}
