import type { BarDatabase } from '../../application/bar-repository'
import { summarizeTab } from '../../application/tab-summary'
import { CONSUMER_KIND, PAYMENT_TARGET, TAB_KIND, TAB_STATUS } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { calculateFinancials } from '../../domain/financials'
import { addCents } from '../../domain/money'
import { summarizePayments } from '../../domain/payments'

/**
 * The amount `consumer` currently owes, scoped by kind:
 *
 * - visitor: the summed remaining balance across every open event tab, from
 *   `summarizeTab`'s `payment.remainingCents` — correct here because a
 *   visitor's debt is settled with payments recorded with `target: 'tab'`
 *   against that same tab id.
 * - member: **not** derived from the monthly tab's own `payment` field.
 *   A member's debt is never paid directly against the monthly tab (the
 *   repository rejects a `target: 'tab'` payment on it) — it is paid with
 *   `target: 'statement'` against the `MemberStatement` a monthly closing
 *   produces. So `summarizeTab(monthlyTab).payment.remainingCents` would
 *   always report the tab's whole total as outstanding, even after the
 *   member paid their statement in full. Instead: if a statement exists for
 *   this member and month, the amount due and what remains come from that
 *   statement's own consumptions and its `target: 'statement'` payments; if
 *   the month has not been closed yet, there is no statement, and the whole
 *   (unbilled) monthly tab total is genuinely still outstanding.
 *
 * Built entirely on domain functions (`calculateFinancials`,
 * `summarizePayments`, `summarizeTab`) — the only arithmetic of its own is
 * `addCents`, used to accumulate across several tabs.
 */
export function getConsumerOutstandingCents(
  snapshot: BarDatabase,
  consumer: Consumer,
  month: string,
): number {
  return consumer.kind === CONSUMER_KIND.MEMBER
    ? getMemberOutstandingCents(snapshot, consumer.id, month)
    : getVisitorOutstandingCents(snapshot, consumer.id)
}

function getMemberOutstandingCents(
  snapshot: BarDatabase,
  memberId: string,
  month: string,
): number {
  const statement = snapshot.memberStatements.find(
    (candidate) => candidate.memberId === memberId && candidate.month === month,
  )
  if (statement) {
    const dueCents = calculateFinancials(statement.consumptions).revenueCents
    const payments = snapshot.payments.filter(
      (payment) =>
        payment.target === PAYMENT_TARGET.STATEMENT && payment.targetId === statement.id,
    )
    return summarizePayments(dueCents, payments).remainingCents
  }

  const tab = snapshot.tabs.find(
    (candidate) =>
      candidate.kind === TAB_KIND.MONTHLY &&
      candidate.memberId === memberId &&
      candidate.month === month,
  )
  if (!tab) return 0

  // Unbilled: the month has not been closed, so no statement exists yet and
  // the monthly tab cannot carry a direct payment — everything charged on
  // it is still outstanding.
  const tabConsumptions = snapshot.consumptions.filter(
    (consumption) => consumption.tabId === tab.id,
  )
  const dueCents = calculateFinancials(tabConsumptions).revenueCents
  return summarizePayments(dueCents, []).remainingCents
}

function getVisitorOutstandingCents(snapshot: BarDatabase, visitorId: string): number {
  const tabIds = snapshot.tabs
    .filter(
      (tab) =>
        tab.kind === TAB_KIND.EVENT && tab.visitorId === visitorId && tab.status === TAB_STATUS.OPEN,
    )
    .map((tab) => tab.id)

  return tabIds.reduce((total, tabId) => {
    const summary = summarizeTab(snapshot, tabId)
    return summary ? addCents(total, summary.payment.remainingCents) : total
  }, 0)
}
