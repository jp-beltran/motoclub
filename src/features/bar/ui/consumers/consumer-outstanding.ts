import type { BarDatabase } from '../../application/bar-repository'
import { summarizeTab } from '../../application/tab-summary'
import { CONSUMER_KIND, PAYMENT_TARGET, TAB_KIND } from '../../domain/constants'
import type { Consumer } from '../../domain/entities'
import { calculateFinancials } from '../../domain/financials'
import { addCents } from '../../domain/money'
import { summarizePayments } from '../../domain/payments'

/**
 * The amount `consumer` currently owes, scoped by kind:
 *
 * - visitor: the summed remaining balance across **every** event tab, open
 *   or closed, from `summarizeTab`'s `payment.remainingCents`. Closing a
 *   tab does not settle it — `closeVisitorTab` only checks that the tab
 *   belongs to an active event, not that it was paid; the product flow is
 *   explicitly "close, then pay" ("Após o fechamento, a comanda ficará
 *   disponível para pagamento"). So a closed tab can still carry a
 *   `remainingCents` of paid/partial/unpaid, and scoping this to
 *   `TAB_STATUS.OPEN` would report a visitor who owes money — often the
 *   common case, since closing happens before payment — as owing nothing.
 *   Using `summarizeTab` here (rather than deriving from statements, as the
 *   member branch below does) is correct because visitor debt genuinely is
 *   settled with `target: 'tab'` payments against that same tab id,
 *   regardless of whether the tab is still open.
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
  // Open or closed: closing an event tab does not imply it was paid.
  const tabIds = snapshot.tabs
    .filter((tab) => tab.kind === TAB_KIND.EVENT && tab.visitorId === visitorId)
    .map((tab) => tab.id)

  return tabIds.reduce((total, tabId) => {
    const summary = summarizeTab(snapshot, tabId)
    return summary ? addCents(total, summary.payment.remainingCents) : total
  }, 0)
}
