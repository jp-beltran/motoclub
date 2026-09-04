import { CONSUMPTION_STATUS, PAYMENT_TARGET, TAB_STATUS } from './constants'
import type { Consumption, MemberStatement, Payment, Tab } from './entities'
import type { BarErrorCode } from './errors'
import { summarizeTabConsumptions } from './financials'
import { addCents } from './money'

export const CANCELLATION_BLOCK = {
  /** Already frozen into a `MemberStatement` by a monthly closing. */
  CONSOLIDATED: 'consolidated',
  /** Its tab is closed, so the tab's total is settled history. */
  CLOSED_TAB: 'closed-tab',
  /** Removing it would leave more money settled than the tab owes. */
  SETTLED_PAYMENT: 'settled-payment',
} as const

export type CancellationBlock =
  (typeof CANCELLATION_BLOCK)[keyof typeof CANCELLATION_BLOCK]

/**
 * The invariant each block raises, in English, for the developer — the
 * repository throws these and `application/error-messages.ts` maps every one
 * of them to the pt-BR sentence the operator reads.
 */
export const CANCELLATION_BLOCK_REASONS: Readonly<Record<CancellationBlock, string>> = {
  [CANCELLATION_BLOCK.CONSOLIDATED]:
    'Consumption is frozen in a member statement',
  [CANCELLATION_BLOCK.CLOSED_TAB]: 'Consumption belongs to a closed tab',
  [CANCELLATION_BLOCK.SETTLED_PAYMENT]:
    'Consumption is covered by a settled payment',
}

/**
 * The code each block raises. `Record<CancellationBlock, BarErrorCode>` with
 * no cast, so a new block cannot ship without a code — and the code cannot
 * ship without pt-BR copy, because `application/error-messages.ts` is
 * exhaustive over `BarErrorCode`. That is what keeps the disabled control and
 * the refused mutation from ever drifting into two explanations of one rule.
 */
export const CANCELLATION_BLOCK_CODES: Readonly<
  Record<CancellationBlock, BarErrorCode>
> = {
  [CANCELLATION_BLOCK.CONSOLIDATED]: 'consumption-frozen-in-statement',
  [CANCELLATION_BLOCK.CLOSED_TAB]: 'consumption-tab-closed',
  [CANCELLATION_BLOCK.SETTLED_PAYMENT]: 'consumption-covered-by-payment',
}

/**
 * Everything needed to weigh a cancellation. `BarDatabase` satisfies it
 * structurally, so the repository and the launch screen's selector pass the
 * snapshot they already hold and can never disagree about the rule.
 */
export interface CancellationContext {
  readonly tabs: readonly Tab[]
  readonly consumptions: readonly Consumption[]
  readonly payments: readonly Payment[]
  readonly memberStatements: readonly MemberStatement[]
}

/**
 * Why `consumptionId` must not be cancelled, or `undefined` when it may be.
 *
 * Cancelling rewrites what a tab owes. That is harmless while the tab is
 * still live and unsettled, and corrupting once the money has been read
 * somewhere else:
 *
 * - a monthly closing copies the month's consumption into a `MemberStatement`
 *   and never reads it back, so cancelling the original leaves the statement
 *   — and every screen billing from it — charging for a line the launch
 *   screen prints as "Cancelado";
 * - a closed tab's total is history the operator already acted on;
 * - a payment already settled against the tab would end up larger than the
 *   tab owes, and `summarizePayments` saturates that overpayment to
 *   `remaining: 0, status: paid`, so the club silently owes money back with
 *   nothing on screen saying so.
 *
 * A partial payment that still leaves money owed after the cancellation is
 * not a block: nothing is stranded, and correcting a mistyped line on a tab
 * with a deposit against it is exactly what the panel is for.
 *
 * An already cancelled consumption returns `undefined` here — `cancelConsumption`
 * refuses it with a message that fits it better.
 */
export function findCancellationBlock(
  context: CancellationContext,
  consumptionId: string,
): CancellationBlock | undefined {
  const consumption = context.consumptions.find(({ id }) => id === consumptionId)
  if (!consumption || consumption.status !== CONSUMPTION_STATUS.ACTIVE) return undefined

  const isConsolidated = context.memberStatements.some((statement) =>
    statement.consumptions.some(({ id }) => id === consumption.id),
  )
  if (isConsolidated) return CANCELLATION_BLOCK.CONSOLIDATED

  const tab = context.tabs.find(({ id }) => id === consumption.tabId)
  if (tab?.status === TAB_STATUS.CLOSED) return CANCELLATION_BLOCK.CLOSED_TAB

  const dueAfterCents = summarizeTabConsumptions(
    context.consumptions.filter(
      ({ id, tabId }) => tabId === consumption.tabId && id !== consumption.id,
    ),
  ).totalCents
  const settledCents = context.payments
    .filter(
      ({ target, targetId }) =>
        target === PAYMENT_TARGET.TAB && targetId === consumption.tabId,
    )
    .reduce((total, { amountCents }) => addCents(total, amountCents), 0)

  return settledCents > dueAfterCents ? CANCELLATION_BLOCK.SETTLED_PAYMENT : undefined
}
