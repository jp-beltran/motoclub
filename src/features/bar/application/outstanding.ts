import { CONSUMER_KIND, PAYMENT_TARGET, TAB_KIND } from '../domain/constants'
import type { Consumer, Consumption, EventTab, MonthlyTab, Tab } from '../domain/entities'
import { calculateFinancials } from '../domain/financials'
import { addCents } from '../domain/money'
import { summarizePayments } from '../domain/payments'
import type { BarDatabase } from './bar-repository'

/**
 * What `consumer` owes the club right now, across **every** month.
 *
 * Debt does not expire when the calendar rolls over, so nothing here is
 * month-scoped (Ruling 27). Scoping the member branch to the current month
 * used to make `/consumidores` report R$ 0,00 for a member the dashboard's
 * own "Total em aberto" was still counting — the same money, two screens,
 * two answers. This is now literally the same code path
 * `calculateOutstandingCents` runs for the dashboard, only narrowed to one
 * owner, so the two cannot drift apart again.
 *
 * The two kinds of debt are settled through different targets, so they are
 * derived differently:
 *
 * - visitor: the remaining balance of **every** event tab, open or closed.
 *   Closing a tab does not settle it — `closeVisitorTab` only checks that
 *   the tab belongs to an
 *   active event, and the product flow is explicitly "close, then pay" — so
 *   scoping to open tabs would report a visitor who owes money as owing
 *   nothing. Visitor debt genuinely is settled with `target: 'tab'` payments
 *   against that same tab id.
 * - member: **not** from the monthly tab's own `payment` field. A member's
 *   debt is never paid against the monthly tab (the repository rejects a
 *   `target: 'tab'` payment on it) — it is paid with `target: 'statement'`
 *   against the `MemberStatement` a monthly closing produces. So every
 *   statement contributes what its `target: 'statement'` payments have not
 *   covered, and every monthly tab **no statement has billed yet**
 *   contributes its whole total. The `memberId|month` guard is what keeps a
 *   closed month from being counted twice, once as a statement and once as
 *   its own tab.
 *
 * Built entirely on domain functions (`calculateFinancials`,
 * `summarizePayments`); the only arithmetic of its own is `addCents`,
 * accumulating across several tabs and statements.
 */
export function getConsumerOutstandingCents(
  snapshot: BarDatabase,
  consumer: Consumer,
): number {
  return consumer.kind === CONSUMER_KIND.MEMBER
    ? sumMemberOutstandingCents(snapshot, consumer.id)
    : sumVisitorOutstandingCents(snapshot, consumer.id)
}

/**
 * Total in arrears across the whole club, right now — every member's
 * statements and unbilled monthly tabs plus every visitor's event tabs.
 *
 * Deliberately derived from the tabs and statements themselves rather than by
 * walking `snapshot.consumers`, so a snapshot is measured by the debt it
 * records rather than by its roster.
 */
export function calculateOutstandingCents(snapshot: BarDatabase): number {
  return addCents(sumMemberOutstandingCents(snapshot), sumVisitorOutstandingCents(snapshot))
}

/** Narrowed to one member when `memberId` is given, every member otherwise. */
function sumMemberOutstandingCents(snapshot: BarDatabase, memberId?: string): number {
  const statements = snapshot.memberStatements.filter(
    (statement) => memberId === undefined || statement.memberId === memberId,
  )
  const billedMemberMonths = new Set(
    snapshot.memberStatements.map((statement) => `${statement.memberId}|${statement.month}`),
  )

  const statementCents = statements.reduce((total, statement) => {
    const dueCents = calculateFinancials(statement.consumptions).revenueCents
    const payments = snapshot.payments.filter(
      (payment) =>
        payment.target === PAYMENT_TARGET.STATEMENT && payment.targetId === statement.id,
    )
    return addCents(total, summarizePayments(dueCents, payments).remainingCents)
  }, 0)

  // Unbilled: no closing has frozen this month yet, and a monthly tab cannot
  // carry a direct payment, so everything charged on it is still outstanding.
  const unbilledTabs = snapshot.tabs
    .filter(isMonthlyTab)
    .filter((tab) => memberId === undefined || tab.memberId === memberId)
    .filter((tab) => !billedMemberMonths.has(`${tab.memberId}|${tab.month}`))

  return unbilledTabs.reduce(
    (total, tab) =>
      addCents(
        total,
        summarizePayments(tabDueCents(snapshot.consumptions, tab.id), []).remainingCents,
      ),
    statementCents,
  )
}

/** Narrowed to one visitor when `visitorId` is given, every visitor otherwise. */
function sumVisitorOutstandingCents(snapshot: BarDatabase, visitorId?: string): number {
  return snapshot.tabs
    .filter(isEventTab)
    .filter((tab) => visitorId === undefined || tab.visitorId === visitorId)
    .reduce((total, tab) => {
      const payments = snapshot.payments.filter(
        (payment) => payment.target === PAYMENT_TARGET.TAB && payment.targetId === tab.id,
      )
      const dueCents = tabDueCents(snapshot.consumptions, tab.id)
      return addCents(total, summarizePayments(dueCents, payments).remainingCents)
    }, 0)
}

function tabDueCents(consumptions: readonly Consumption[], tabId: string): number {
  return calculateFinancials(
    consumptions.filter((consumption) => consumption.tabId === tabId),
  ).revenueCents
}

function isMonthlyTab(tab: Tab): tab is MonthlyTab {
  return tab.kind === TAB_KIND.MONTHLY
}

function isEventTab(tab: Tab): tab is EventTab {
  return tab.kind === TAB_KIND.EVENT
}
