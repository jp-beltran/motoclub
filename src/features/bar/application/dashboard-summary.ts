import { TAB_STATUS } from '../domain/constants'
import type { Item } from '../domain/entities'
import { calculateFinancials } from '../domain/financials'
import { getMonthKey } from '../domain/month'
import { addCents } from '../domain/money'
import type { BarDatabase } from './bar-repository'
import { calculateOutstandingCents } from './outstanding'
import { isLowStock } from './stock-levels'

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
 *   owed right now", and comes from `calculateOutstandingCents` — the very
 *   per-consumer rule `/consumidores` prints row by row, summed. Sharing it
 *   is what stops the headline and the rows from disagreeing about the same
 *   money (Ruling 27).
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
    (item) => item.stockQuantity !== undefined && isLowStock(item.stockQuantity),
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
