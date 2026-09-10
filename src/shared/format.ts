const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const quantityFormatter = new Intl.NumberFormat('pt-BR')

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const amount = decimalFormatter.format(Math.abs(cents) / 100)
  return `${sign}R$ ${amount}`
}

const AMOUNT_PATTERN = /^\d+([.,]\d{1,2})?$/

/**
 * Parses a pt-BR money input (comma or dot decimal, up to 2 digits) into
 * integer cents without ever going through floating-point arithmetic.
 * Returns `undefined` for anything that is not a valid non-negative amount.
 *
 * The inverse of `formatCents`, and the single parse for every money field
 * the operator types: a payment amount in `/pagamentos`, an item's price and
 * cost in `/itens`. It moved here from `ui/payments/payment-amount.ts` when
 * the item registration needed it — one implementation, not two, because two
 * would eventually disagree about "12,5" or "12,555" and only one of them
 * would be the one under test.
 */
export function parseCentsInput(rawValue: string): number | undefined {
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

export function formatQuantity(value: number): string {
  return quantityFormatter.format(value)
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}
