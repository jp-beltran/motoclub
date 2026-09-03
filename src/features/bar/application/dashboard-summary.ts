import { PAYMENT_TARGET, TAB_KIND, TAB_STATUS } from '../domain/constants'
import type { Consumption, EventTab, Item, MonthlyTab, Tab } from '../domain/entities'
import { calculateFinancials } from '../domain/financials'
import { addCents } from '../domain/money'
import { summarizePayments } from '../domain/payments'
import type { BarDatabase } from './bar-repository'
import { LOW_STOCK_THRESHOLD } from './constants'

export interface DashboardSummary {
  readonly revenueCents: number
  readonly costCents: number
  readonly profitCents: number
  readonly margin: number
  readonly receivedCents: number
  readonly pendingCents: number
  readonly openTabsCount: number
  readonly lowStockItems: readonly Item[]
}

/**
 * Pure selector for the dashboard route (`/`). Built entirely on
 * `calculateFinancials` and `summarizePayments` from the domain layer — the
 * only extra arithmetic is `addCents`, used to accumulate totals across
 * several tabs/statements.
 *
 * Month scoping:
 * - Monthly (member) tabs are scoped by their own `month` field, which the
 *   domain already tracks explicitly (`MonthlyTab.month`) — no date string
 *   parsing needed.
 * - Event (visitor) tabs carry no month field in the domain: an event is
 *   not a calendar-month concept there, and closing a tab does not require
 *   settling it in full. Their consumption is therefore always included,
 *   regardless of `month`, so outstanding visitor debt is never silently
 *   dropped from the totals. This is a known limitation if the prototype
 *   ever needs to show a *past* month's dashboard while an event is
 *   currently open — see the task report for details.
 *
 * Payment targets: a member's monthly tab can never carry a direct
 * payment — members settle only through the `MemberStatement` produced by
 * monthly closing (`target: 'statement'`). A visitor's event tab settles
 * directly (`target: 'tab'`). Both are handled explicitly below.
 */
export function summarizeDashboard(snapshot: BarDatabase, month: string): DashboardSummary {
  const monthlyTabs = snapshot.tabs.filter(isMonthlyTab).filter((tab) => tab.month === month)
  const eventTabs = snapshot.tabs.filter(isEventTab)

  const scopedTabIds = new Set<string>([...monthlyTabs, ...eventTabs].map((tab) => tab.id))
  const scopedConsumptions = snapshot.consumptions.filter((consumption) =>
    scopedTabIds.has(consumption.tabId),
  )
  const { revenueCents, costCents, profitCents, margin } = calculateFinancials(scopedConsumptions)

  const statementsThisMonth = snapshot.memberStatements.filter(
    (statement) => statement.month === month,
  )
  const billedMemberIds = new Set(statementsThisMonth.map((statement) => statement.memberId))

  let receivedCents = 0
  let pendingCents = 0

  for (const statement of statementsThisMonth) {
    const dueCents = calculateFinancials(statement.consumptions).revenueCents
    const payments = snapshot.payments.filter(
      (payment) =>
        payment.target === PAYMENT_TARGET.STATEMENT && payment.targetId === statement.id,
    )
    const { paidCents, remainingCents } = summarizePayments(dueCents, payments)
    receivedCents = addCents(receivedCents, paidCents)
    pendingCents = addCents(pendingCents, remainingCents)
  }

  const unbilledMonthlyTabs = monthlyTabs.filter((tab) => !billedMemberIds.has(tab.memberId))
  for (const tab of unbilledMonthlyTabs) {
    const dueCents = tabDueCents(snapshot.consumptions, tab.id)
    // A monthly tab cannot carry a direct payment: everything accrued here
    // is pending until monthly closing produces a statement.
    const { paidCents, remainingCents } = summarizePayments(dueCents, [])
    receivedCents = addCents(receivedCents, paidCents)
    pendingCents = addCents(pendingCents, remainingCents)
  }

  for (const tab of eventTabs) {
    const dueCents = tabDueCents(snapshot.consumptions, tab.id)
    const payments = snapshot.payments.filter(
      (payment) => payment.target === PAYMENT_TARGET.TAB && payment.targetId === tab.id,
    )
    const { paidCents, remainingCents } = summarizePayments(dueCents, payments)
    receivedCents = addCents(receivedCents, paidCents)
    pendingCents = addCents(pendingCents, remainingCents)
  }

  const openTabsCount = snapshot.tabs.filter((tab) => tab.status === TAB_STATUS.OPEN).length
  const lowStockItems = snapshot.items.filter(
    (item) => item.stockQuantity !== undefined && item.stockQuantity <= LOW_STOCK_THRESHOLD,
  )

  return {
    revenueCents,
    costCents,
    profitCents,
    margin,
    receivedCents,
    pendingCents,
    openTabsCount,
    lowStockItems,
  }
}

function tabDueCents(consumptions: readonly Consumption[], tabId: string): number {
  const tabConsumptions = consumptions.filter((consumption) => consumption.tabId === tabId)
  return calculateFinancials(tabConsumptions).revenueCents
}

function isMonthlyTab(tab: Tab): tab is MonthlyTab {
  return tab.kind === TAB_KIND.MONTHLY
}

function isEventTab(tab: Tab): tab is EventTab {
  return tab.kind === TAB_KIND.EVENT
}
