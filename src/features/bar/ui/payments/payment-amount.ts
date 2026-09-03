import { formatCents } from '../../../../shared/format'

const AMOUNT_PATTERN = /^\d+([.,]\d{1,2})?$/

/**
 * Parses a pt-BR money input (comma or dot decimal, up to 2 digits) into
 * integer cents without ever going through floating-point arithmetic.
 * Returns `undefined` for anything that is not a valid non-negative amount.
 */
export function parsePaymentAmountToCents(rawValue: string): number | undefined {
  const trimmed = rawValue.trim()
  if (!AMOUNT_PATTERN.test(trimmed)) return undefined

  const normalized = trimmed.replace(',', '.')
  const [reaisPart, centsPartRaw = ''] = normalized.split('.')
  const centsPart = centsPartRaw.padEnd(2, '0')
  const reais = Number(reaisPart)
  const cents = Number(centsPart)
  const amountCents = reais * 100 + cents

  return Number.isSafeInteger(amountCents) ? amountCents : undefined
}

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
  const amountCents = parsePaymentAmountToCents(rawValue)

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
