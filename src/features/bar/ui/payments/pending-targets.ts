import { formatMonth } from '../../../../shared/date'
import type { BarDatabase } from '../../application/bar-repository'
import { summarizeTab } from '../../application/tab-summary'
import { PAYMENT_TARGET, TAB_KIND, type PaymentTarget } from '../../domain/constants'
import type { EventTab, Payment } from '../../domain/entities'
import { summarizeTabConsumptions } from '../../domain/financials'
import { summarizePayments, type PaymentSummary } from '../../domain/payments'

export interface PendingTarget {
  readonly target: PaymentTarget
  readonly targetId: string
  readonly label: string
  readonly totalCents: number
  readonly payment: PaymentSummary
  /** This target's own payment history, most recent first. */
  readonly payments: readonly Payment[]
}

/**
 * Every payable target with money still owed: open or closed event tabs
 * (comandas, paid with `target: 'tab'`) and member statements (extratos,
 * paid with `target: 'statement'`). A monthly tab never appears here — it
 * cannot carry a direct payment until the monthly closing turns it into a
 * statement (see local-bar-repository.ts, MONTHLY_TAB_PAYMENT_MESSAGE).
 */
export function listPendingTargets(snapshot: BarDatabase): readonly PendingTarget[] {
  const tabTargets = snapshot.tabs
    .filter((tab): tab is EventTab => tab.kind === TAB_KIND.EVENT)
    .map((tab) => describeTabTarget(snapshot, tab))
    .filter((target): target is PendingTarget => target !== undefined)

  const statementTargets = snapshot.memberStatements.map((statement) =>
    describeStatementTarget(snapshot, statement),
  )

  return [...tabTargets, ...statementTargets].filter(
    (target) => target.payment.remainingCents > 0,
  )
}

function describeTabTarget(snapshot: BarDatabase, tab: EventTab): PendingTarget | undefined {
  const summary = summarizeTab(snapshot, tab.id)
  if (!summary) return undefined

  const event = snapshot.events.find(({ id }) => id === tab.eventId)
  const label = event ? `${summary.consumer.name} — ${event.name}` : summary.consumer.name
  const payments = findTargetPayments(snapshot, PAYMENT_TARGET.TAB, tab.id)

  return {
    target: PAYMENT_TARGET.TAB,
    targetId: tab.id,
    label,
    totalCents: summary.totalCents,
    payment: summary.payment,
    payments,
  }
}

function describeStatementTarget(
  snapshot: BarDatabase,
  statement: BarDatabase['memberStatements'][number],
): PendingTarget {
  const member = snapshot.consumers.find(({ id }) => id === statement.memberId)
  const totalCents = summarizeTabConsumptions(statement.consumptions).totalCents
  const payments = findTargetPayments(snapshot, PAYMENT_TARGET.STATEMENT, statement.id)
  const monthLabel = formatMonth(statement.month)
  const label = member ? `${member.name} — ${monthLabel}` : monthLabel

  return {
    target: PAYMENT_TARGET.STATEMENT,
    targetId: statement.id,
    label,
    totalCents,
    payment: summarizePayments(totalCents, payments),
    payments,
  }
}

/** A stable identity for a pending target, combining its kind and id. */
export function pendingTargetKey(target: Pick<PendingTarget, 'target' | 'targetId'>): string {
  return `${target.target}:${target.targetId}`
}

function findTargetPayments(
  snapshot: BarDatabase,
  target: PaymentTarget,
  targetId: string,
): readonly Payment[] {
  return snapshot.payments
    .filter((payment) => payment.target === target && payment.targetId === targetId)
    .slice()
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
}
