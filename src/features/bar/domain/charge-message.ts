import { formatMonth } from '../../../shared/date'
import { formatCents, formatQuantity } from '../../../shared/format'

export interface ChargeMessageLine {
  readonly itemName: string
  readonly quantity: number
  readonly subtotalCents: number
}

export interface BuildChargeMessageInput {
  readonly consumerName: string
  readonly month: string
  /** Charged lines only — courtesy consumption never reaches this function. */
  readonly lines: readonly ChargeMessageLine[]
  readonly totalCents: number
  readonly paidCents: number
  readonly remainingCents: number
}

/**
 * Formats a copyable pt-BR charge message for one member's month.
 *
 * Trusts the given `totalCents`/`paidCents`/`remainingCents` instead of
 * recomputing them from `lines` — the caller is expected to derive them from
 * the domain (e.g. `summarizeTabConsumptions`/`summarizePayments`), which
 * already excludes courtesy and cancelled consumption. That keeps courtesy
 * out of the printed total even if a courtesy line were ever present.
 */
export function buildChargeMessage(input: BuildChargeMessageInput): string {
  const header = `Cobrança de ${formatMonth(input.month)} — ${input.consumerName}`
  const itemLines = input.lines.map(
    (line) =>
      `${formatQuantity(line.quantity)}× ${line.itemName} — ${formatCents(line.subtotalCents)}`,
  )
  const totalLine = `Total: ${formatCents(input.totalCents)}`
  const paymentLines =
    input.paidCents > 0
      ? [
          `Pago: ${formatCents(input.paidCents)}`,
          `Restante: ${formatCents(input.remainingCents)}`,
        ]
      : []

  return [header, '', ...itemLines, '', totalLine, ...paymentLines].join('\n')
}
