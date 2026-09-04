import type { BarDatabase } from '../../application/bar-repository'
import { CHARGE_KIND, CONSUMER_KIND, CONSUMPTION_STATUS, PAYMENT_TARGET } from '../../domain/constants'
import type { Consumer, Consumption, MemberStatement } from '../../domain/entities'
import { getConsumptionLineTotalCents, summarizeTabConsumptions } from '../../domain/financials'
import { getMonthKey } from '../../domain/month'
import { addCents } from '../../domain/money'
import { summarizePayments, type PaymentSummary } from '../../domain/payments'

const UNKNOWN_ITEM_NAME = 'Item removido'

export interface ClosingLine {
  readonly itemName: string
  readonly quantity: number
  readonly subtotalCents: number
}

export interface MemberMonthPreview {
  readonly consumer: Consumer
  /** Charged lines this member has launched so far this month. */
  readonly lines: readonly ClosingLine[]
  /** Amount due if the month closed right now — courtesy excluded. */
  readonly totalCents: number
}

export interface ClosingMonthOption {
  readonly month: string
  /** A closed month is read-only: its statements are frozen, not previewable. */
  readonly isClosed: boolean
}

export interface ClosedMemberStatementView {
  readonly statement: MemberStatement
  readonly consumer: Consumer
  readonly lines: readonly ClosingLine[]
  readonly totalCents: number
  readonly payment: PaymentSummary
}

/**
 * Every month `/fechamento` can act on, newest first: the current month
 * (always, so it can stay the default even before anyone consumes), every
 * month with member consumption no closing has frozen yet, and every month
 * already closed.
 *
 * Ruling 27(b): pinning the screen to the current month left an unclosed
 * month permanently unclosable once the calendar rolled over — no statement
 * could be produced, so /pagamentos (which only lists statements) never
 * offered the debt — and it also hid the frozen statements and charge
 * messages of every month that had already been closed.
 *
 * Months where only visitors consumed are left out: `consolidateMonth` only
 * consolidates members, so closing one of those produces nothing at all.
 */
export function listClosingMonths(
  snapshot: BarDatabase,
  currentMonth: string,
): readonly ClosingMonthOption[] {
  const memberIds = new Set(
    snapshot.consumers
      .filter((consumer) => consumer.kind === CONSUMER_KIND.MEMBER && consumer.active !== false)
      .map(({ id }) => id),
  )
  const closedMonths = new Set(snapshot.monthlyClosings.map(({ month }) => month))
  const consumedMonths = snapshot.consumptions
    .filter((consumption) => memberIds.has(consumption.consumerId))
    .map((consumption) => getMonthKey(consumption.createdAt))

  return [...new Set([currentMonth, ...consumedMonths, ...closedMonths])]
    .sort()
    .reverse()
    .map((month) => ({ month, isClosed: closedMonths.has(month) }))
}

/**
 * Pure preview of what closing `month` right now would produce: one row per
 * active member who has at least one consumption record that month (any
 * status or charge kind — the same inclusion test `consolidateMonth` uses),
 * with their charged lines and amount due. Writes nothing.
 */
export function buildMonthPreview(
  snapshot: BarDatabase,
  month: string,
): readonly MemberMonthPreview[] {
  const itemNameById = new Map(snapshot.items.map(({ id, name }) => [id, name]))
  const members = snapshot.consumers.filter(
    (consumer) => consumer.kind === CONSUMER_KIND.MEMBER && consumer.active !== false,
  )

  return members.flatMap((consumer) => {
    const monthConsumptions = snapshot.consumptions.filter(
      (consumption) =>
        consumption.consumerId === consumer.id && getMonthKey(consumption.createdAt) === month,
    )
    if (monthConsumptions.length === 0) return []

    return [
      {
        consumer,
        lines: groupChargedLines(monthConsumptions, itemNameById),
        totalCents: summarizeTabConsumptions(monthConsumptions).totalCents,
      },
    ]
  })
}

/**
 * Read model for one frozen `MemberStatement`, after the month has closed:
 * its charged lines, amount due and settlement against `target: 'statement'`
 * payments. Returns `undefined` when the statement's member is not in the
 * snapshot.
 */
export function summarizeClosedStatement(
  snapshot: BarDatabase,
  statement: MemberStatement,
): ClosedMemberStatementView | undefined {
  const consumer = snapshot.consumers.find(({ id }) => id === statement.memberId)
  if (!consumer) return undefined

  const itemNameById = new Map(snapshot.items.map(({ id, name }) => [id, name]))
  const totalCents = summarizeTabConsumptions(statement.consumptions).totalCents

  return {
    statement,
    consumer,
    lines: groupChargedLines(statement.consumptions, itemNameById),
    totalCents,
    payment: summarizePayments(
      totalCents,
      snapshot.payments.filter(
        ({ target, targetId }) =>
          target === PAYMENT_TARGET.STATEMENT && targetId === statement.id,
      ),
    ),
  }
}

function groupChargedLines(
  consumptions: readonly Consumption[],
  itemNameById: ReadonlyMap<string, string>,
): readonly ClosingLine[] {
  const chargedActive = consumptions.filter(
    (consumption) =>
      consumption.status === CONSUMPTION_STATUS.ACTIVE &&
      consumption.chargeKind === CHARGE_KIND.CHARGED,
  )
  const lines = new Map<string, ClosingLine>()

  chargedActive.forEach((consumption) => {
    const current = lines.get(consumption.itemId)
    const lineTotalCents = getConsumptionLineTotalCents(consumption)
    lines.set(consumption.itemId, {
      itemName: itemNameById.get(consumption.itemId) ?? UNKNOWN_ITEM_NAME,
      quantity: (current?.quantity ?? 0) + consumption.quantity,
      subtotalCents: addCents(current?.subtotalCents ?? 0, lineTotalCents),
    })
  })

  return [...lines.values()]
}
