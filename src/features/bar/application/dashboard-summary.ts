import { PAYMENT_TARGET, TAB_KIND, TAB_STATUS } from '../domain/constants'
import type { Consumption, EventTab, Item, MonthlyTab, Tab } from '../domain/entities'
import { calculateFinancials } from '../domain/financials'
import { getMonthKey } from '../domain/month'
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
 * several tabs/statements/payments.
 *
 * - `revenueCents`/`costCents`/`profitCents`/`margin` are scoped **per
 *   consumption** via `getMonthKey(consumption.createdAt) === month`,
 *   identically for monthly (member) and event (visitor) tabs. Scoping by
 *   tab instead of by consumption previously let an event tab's consumption
 *   from *any* month leak into every month's totals (event tabs have no
 *   `month` field of their own) — this is the fix for that.
 * - `receivedCents` is scoped **per payment**, by its own `paidAt` month —
 *   not by the month the underlying tab/consumption belongs to. It answers
 *   "how much came in during this month", which can include money for
 *   older consumption paid late.
 * - `pendingCents` is **not month-scoped at all**. It answers "how much is
 *   owed right now": the outstanding remainder across every event tab
 *   (visitor debt, `target: 'tab'`) and every member statement / still
 *   unbilled monthly tab (member debt, settled only through
 *   `target: 'statement'` once a statement exists — a monthly tab itself
 *   can never carry a direct payment). Debt does not expire when the
 *   calendar rolls over, so a past month's unbilled tab still counts.
 * - `openTabsCount` counts tabs that are open *right now*, regardless of
 *   kind or month; a closed tab (settled or not) never counts.
 */
export function summarizeDashboard(snapshot: BarDatabase, month: string): DashboardSummary {
  const scopedConsumptions = snapshot.consumptions.filter(
    (consumption) => getMonthKey(consumption.createdAt) === month,
  )
  const { revenueCents, costCents, profitCents, margin } = calculateFinancials(scopedConsumptions)

  const receivedCents = snapshot.payments
    .filter((payment) => getMonthKey(payment.paidAt) === month)
    .reduce((total, payment) => addCents(total, payment.amountCents), 0)

  const pendingCents = calculateOutstandingCents(snapshot)

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

/**
 * Total in arrears, right now, across the whole system — not scoped by any
 * particular month.
 */
function calculateOutstandingCents(snapshot: BarDatabase): number {
  let pendingCents = 0

  const billedMemberMonths = new Set(
    snapshot.memberStatements.map((statement) => `${statement.memberId}|${statement.month}`),
  )

  for (const statement of snapshot.memberStatements) {
    const dueCents = calculateFinancials(statement.consumptions).revenueCents
    const payments = snapshot.payments.filter(
      (payment) =>
        payment.target === PAYMENT_TARGET.STATEMENT && payment.targetId === statement.id,
    )
    pendingCents = addCents(pendingCents, summarizePayments(dueCents, payments).remainingCents)
  }

  const unbilledMonthlyTabs = snapshot.tabs
    .filter(isMonthlyTab)
    .filter((tab) => !billedMemberMonths.has(`${tab.memberId}|${tab.month}`))
  for (const tab of unbilledMonthlyTabs) {
    const dueCents = tabDueCents(snapshot.consumptions, tab.id)
    // A monthly tab cannot carry a direct payment: everything accrued here
    // is pending until monthly closing produces a statement.
    pendingCents = addCents(pendingCents, summarizePayments(dueCents, []).remainingCents)
  }

  for (const tab of snapshot.tabs.filter(isEventTab)) {
    const dueCents = tabDueCents(snapshot.consumptions, tab.id)
    const payments = snapshot.payments.filter(
      (payment) => payment.target === PAYMENT_TARGET.TAB && payment.targetId === tab.id,
    )
    pendingCents = addCents(pendingCents, summarizePayments(dueCents, payments).remainingCents)
  }

  return pendingCents
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
