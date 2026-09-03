import { describe, expect, it } from 'vitest'

import type { BarDatabase } from './bar-repository'
import { LOW_STOCK_THRESHOLD } from './constants'
import { summarizeDashboard } from './dashboard-summary'
import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import type { Consumption, Item, MemberStatement, Payment, Tab } from '../domain/entities'

const MONTH = '2026-09'

/**
 * `getMonthKey` is local-time based, so every date fixture in this file is
 * built from a local `Date` constructor (never a hardcoded `...Z` string) —
 * that keeps these tests correct in any timezone the suite happens to run
 * in.
 */
function localIso(year: number, monthIndex: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, monthIndex, day, hour, minute).toISOString()
}

const SEPTEMBER_INSTANT = localIso(2026, 8, 12, 20, 0)
const AUGUST_INSTANT = localIso(2026, 7, 20, 20, 0)
const OCTOBER_INSTANT = localIso(2026, 9, 3, 20, 0)

function emptyDatabase(): BarDatabase {
  return {
    consumers: [],
    items: [],
    events: [],
    tabs: [],
    consumptions: [],
    payments: [],
    stockMovements: [],
    monthlyClosings: [],
    memberStatements: [],
  }
}

interface MonthlyTabOverrides {
  readonly id: string
  readonly memberId: string
  readonly month: string
  readonly status?: Tab['status']
  readonly closedAt?: string
}

function monthlyTab(overrides: MonthlyTabOverrides): Tab {
  return {
    kind: TAB_KIND.MONTHLY,
    status: TAB_STATUS.OPEN,
    openedAt: SEPTEMBER_INSTANT,
    ...overrides,
  } as Tab
}

interface EventTabOverrides {
  readonly id: string
  readonly eventId: string
  readonly visitorId: string
  readonly status?: Tab['status']
  readonly closedAt?: string
}

function eventTab(overrides: EventTabOverrides): Tab {
  return {
    kind: TAB_KIND.EVENT,
    status: TAB_STATUS.OPEN,
    openedAt: SEPTEMBER_INSTANT,
    ...overrides,
  } as Tab
}

function consumption(
  overrides: Partial<Consumption> & { id: string; tabId: string },
): Consumption {
  return {
    consumerId: 'member-1',
    itemId: 'item-1',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 0,
    unitCostCents: 0,
    createdAt: SEPTEMBER_INSTANT,
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function payment(
  overrides: Partial<Payment> & {
    id: string
    target: Payment['target']
    targetId: string
    amountCents: number
  },
): Payment {
  return {
    paidAt: SEPTEMBER_INSTANT,
    actorId: 'admin-demo',
    ...overrides,
  } as Payment
}

function item(overrides: Partial<Item> & { id: string; name: string }): Item {
  return {
    unitCostCents: 100,
    unitPriceCents: 200,
    ...overrides,
  } as Item
}

describe('summarizeDashboard', () => {
  describe('revenue, cost, profit and margin — scoped per consumption, both tab kinds alike', () => {
    it('returns zeros and a zero margin when nothing was consumed in the queried month', () => {
      const db = emptyDatabase()
      db.tabs = [monthlyTab({ id: 'tab-1', memberId: 'member-1', month: MONTH })]
      db.consumptions = [
        consumption({
          id: 'cons-august',
          tabId: 'tab-1',
          createdAt: AUGUST_INSTANT,
          quantity: 2,
          unitPriceCents: 700,
          unitCostCents: 350,
        }),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.revenueCents).toBe(0)
      expect(summary.costCents).toBe(0)
      expect(summary.profitCents).toBe(0)
      expect(summary.margin).toBe(0)
    })

    it('keeps a courtesy consumption out of revenue but inside cost', () => {
      const db = emptyDatabase()
      db.tabs = [monthlyTab({ id: 'tab-1', memberId: 'member-1', month: MONTH })]
      db.consumptions = [
        consumption({
          id: 'cons-courtesy',
          tabId: 'tab-1',
          chargeKind: CHARGE_KIND.COURTESY,
          createdAt: SEPTEMBER_INSTANT,
          quantity: 2,
          unitPriceCents: 400,
          unitCostCents: 150,
        }),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.revenueCents).toBe(0)
      expect(summary.costCents).toBe(300)
      expect(summary.profitCents).toBe(-300)
      expect(summary.margin).toBe(0)
    })

    it('keeps a cancelled consumption out of revenue, cost, margin, received and pending — outside everything', () => {
      const db = emptyDatabase()
      db.tabs = [monthlyTab({ id: 'tab-1', memberId: 'member-1', month: MONTH })]
      db.consumptions = [
        {
          ...consumption({
            id: 'cons-cancelled',
            tabId: 'tab-1',
            createdAt: SEPTEMBER_INSTANT,
            quantity: 3,
            unitPriceCents: 700,
            unitCostCents: 350,
          }),
          status: CONSUMPTION_STATUS.CANCELLED,
          cancelledAt: SEPTEMBER_INSTANT,
          cancelledByActorId: 'admin-demo',
        } as Consumption,
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.revenueCents).toBe(0)
      expect(summary.costCents).toBe(0)
      expect(summary.profitCents).toBe(0)
      expect(summary.margin).toBe(0)
      // A cancelled consumption is outside everything, including payment
      // state: it never generates a due amount, so it contributes nothing to
      // either side of the money owed/received split.
      expect(summary.receivedCents).toBe(0)
      expect(summary.pendingCents).toBe(0)
    })

    it("scopes revenue by each consumption's own month regardless of its tab kind (replaces the forward-leakage bug)", () => {
      const db = emptyDatabase()
      db.tabs = [
        monthlyTab({ id: 'tab-monthly', memberId: 'member-1', month: MONTH }),
        eventTab({ id: 'tab-event', eventId: 'event-1', visitorId: 'visitor-1' }),
      ]
      db.consumptions = [
        consumption({
          id: 'cons-monthly-this-month',
          tabId: 'tab-monthly',
          createdAt: SEPTEMBER_INSTANT,
          quantity: 1,
          unitPriceCents: 500,
          unitCostCents: 200,
        }),
        consumption({
          id: 'cons-monthly-other-month',
          tabId: 'tab-monthly',
          createdAt: AUGUST_INSTANT,
          quantity: 1,
          unitPriceCents: 900,
          unitCostCents: 400,
        }),
        consumption({
          id: 'cons-event-this-month',
          tabId: 'tab-event',
          consumerId: 'visitor-1',
          createdAt: SEPTEMBER_INSTANT,
          quantity: 1,
          unitPriceCents: 600,
          unitCostCents: 280,
        }),
        // The forward-leakage case: an event tab's consumption from a
        // different month must be excluded from the queried month's revenue,
        // exactly like the monthly tab's August consumption above.
        consumption({
          id: 'cons-event-other-month',
          tabId: 'tab-event',
          consumerId: 'visitor-1',
          createdAt: OCTOBER_INSTANT,
          quantity: 1,
          unitPriceCents: 1_100,
          unitCostCents: 500,
        }),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.revenueCents).toBe(1_100) // 500 (monthly) + 600 (event), both September
      expect(summary.costCents).toBe(480) // 200 + 280
    })
  })

  describe('receivedCents — scoped by the payment date, not the tab', () => {
    it("counts a payment by its own paidAt month, not by its tab's month", () => {
      const db = emptyDatabase()
      db.tabs = [eventTab({ id: 'tab-event', eventId: 'event-1', visitorId: 'visitor-1' })]
      db.consumptions = [
        consumption({
          id: 'cons-event',
          tabId: 'tab-event',
          consumerId: 'visitor-1',
          createdAt: SEPTEMBER_INSTANT,
          quantity: 2,
          unitPriceCents: 600,
          unitCostCents: 280,
        }),
      ]
      // Consumption happened in September; the visitor only paid in October.
      db.payments = [
        payment({
          id: 'payment-1',
          target: PAYMENT_TARGET.TAB,
          targetId: 'tab-event',
          amountCents: 700,
          paidAt: OCTOBER_INSTANT,
        }),
      ]

      expect(summarizeDashboard(db, MONTH).receivedCents).toBe(0)
      expect(summarizeDashboard(db, '2026-10').receivedCents).toBe(700)
    })

    it('splits a same-month partial payment between received and pending', () => {
      const db = emptyDatabase()
      db.tabs = [eventTab({ id: 'tab-event', eventId: 'event-1', visitorId: 'visitor-1' })]
      db.consumptions = [
        consumption({
          id: 'cons-event',
          tabId: 'tab-event',
          consumerId: 'visitor-1',
          createdAt: SEPTEMBER_INSTANT,
          quantity: 2,
          unitPriceCents: 600,
          unitCostCents: 280,
        }),
      ]
      db.payments = [
        payment({
          id: 'payment-1',
          target: PAYMENT_TARGET.TAB,
          targetId: 'tab-event',
          amountCents: 700,
          paidAt: SEPTEMBER_INSTANT,
        }),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.revenueCents).toBe(1_200)
      expect(summary.receivedCents).toBe(700)
      expect(summary.pendingCents).toBe(500)
    })
  })

  describe('pendingCents — total in arrears, not month-scoped', () => {
    it('keeps an unbilled monthly tab from a past month in pendingCents no matter which month is queried', () => {
      const db = emptyDatabase()
      db.tabs = [monthlyTab({ id: 'tab-august', memberId: 'member-1', month: '2026-08' })]
      db.consumptions = [
        consumption({
          id: 'cons-august',
          tabId: 'tab-august',
          createdAt: AUGUST_INSTANT,
          quantity: 2,
          unitPriceCents: 700,
          unitCostCents: 350,
        }),
      ]

      // Queried month is September, the debt is from August.
      const summary = summarizeDashboard(db, MONTH)

      expect(summary.pendingCents).toBe(1_400)
      expect(summary.revenueCents).toBe(0) // and it still does not leak into September's revenue
    })

    it('excludes a closed, fully-paid event tab from pendingCents and openTabsCount', () => {
      const db = emptyDatabase()
      db.tabs = [
        eventTab({
          id: 'tab-settled',
          eventId: 'event-1',
          visitorId: 'visitor-1',
          status: TAB_STATUS.CLOSED,
          closedAt: SEPTEMBER_INSTANT,
        }),
      ]
      db.consumptions = [
        consumption({
          id: 'cons-settled',
          tabId: 'tab-settled',
          consumerId: 'visitor-1',
          createdAt: SEPTEMBER_INSTANT,
          quantity: 1,
          unitPriceCents: 600,
          unitCostCents: 280,
        }),
      ]
      db.payments = [
        payment({
          id: 'payment-full',
          target: PAYMENT_TARGET.TAB,
          targetId: 'tab-settled',
          amountCents: 600,
          paidAt: SEPTEMBER_INSTANT,
        }),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.pendingCents).toBe(0)
      expect(summary.openTabsCount).toBe(0)
    })

    it('splits a partial payment on a member statement between received and pending', () => {
      const db = emptyDatabase()
      const statementConsumption = consumption({
        id: 'cons-ana',
        tabId: 'tab-ana',
        consumerId: 'member-ana',
        createdAt: SEPTEMBER_INSTANT,
        quantity: 2,
        unitPriceCents: 700,
        unitCostCents: 350,
      })
      db.tabs = [
        monthlyTab({
          id: 'tab-ana',
          memberId: 'member-ana',
          month: MONTH,
          status: TAB_STATUS.CLOSED,
          closedAt: SEPTEMBER_INSTANT,
        }),
      ]
      db.consumptions = [statementConsumption]
      const statement: MemberStatement = {
        id: 'statement-ana',
        memberId: 'member-ana',
        month: MONTH,
        consumptions: [statementConsumption],
        createdAt: SEPTEMBER_INSTANT,
      }
      db.memberStatements = [statement]
      db.payments = [
        payment({
          id: 'payment-ana',
          target: PAYMENT_TARGET.STATEMENT,
          targetId: 'statement-ana',
          amountCents: 400,
          paidAt: SEPTEMBER_INSTANT,
        }),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.receivedCents).toBe(400)
      expect(summary.pendingCents).toBe(1_000)
    })

    it('never deducts a payment mistakenly targeting a monthly tab from that tab\'s pending balance', () => {
      const db = emptyDatabase()
      db.tabs = [monthlyTab({ id: 'tab-bruno', memberId: 'member-bruno', month: MONTH })]
      db.consumptions = [
        consumption({
          id: 'cons-bruno',
          tabId: 'tab-bruno',
          consumerId: 'member-bruno',
          createdAt: SEPTEMBER_INSTANT,
          quantity: 2,
          unitPriceCents: 1_200,
          unitCostCents: 500,
        }),
      ]
      // A monthly tab can never carry a direct payment: members only settle
      // through a statement, so the "unbilled monthly tab" branch of
      // pendingCents never looks this payment up — the tab stays fully
      // pending regardless. receivedCents, being purely a sum of payments by
      // their own date (ruling: "not payments belonging to this month's
      // tabs"), still counts it as cash actually received on that date; the
      // real repository never lets such a payment be recorded in the first
      // place (`target: 'tab'` requires an event tab), so this only proves
      // the two totals do not silently disagree if bad data existed.
      db.payments = [
        payment({
          id: 'stray-payment',
          target: PAYMENT_TARGET.TAB,
          targetId: 'tab-bruno',
          amountCents: 1_000,
          paidAt: SEPTEMBER_INSTANT,
        }),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.receivedCents).toBe(1_000)
      expect(summary.pendingCents).toBe(2_400)
    })
  })

  describe('openTabsCount and lowStockItems', () => {
    it('counts every currently open tab regardless of kind, and flags items at or below the low-stock threshold, excluding untracked items', () => {
      const db = emptyDatabase()
      db.tabs = [
        monthlyTab({ id: 'tab-open-monthly', memberId: 'member-1', month: MONTH }),
        monthlyTab({
          id: 'tab-closed-monthly',
          memberId: 'member-2',
          month: MONTH,
          status: TAB_STATUS.CLOSED,
          closedAt: SEPTEMBER_INSTANT,
        }),
        eventTab({ id: 'tab-open-event', eventId: 'event-1', visitorId: 'visitor-1' }),
      ]
      db.items = [
        item({ id: 'item-at-threshold', name: 'No limiar', stockQuantity: LOW_STOCK_THRESHOLD } as Item),
        item({
          id: 'item-above-threshold',
          name: 'Acima',
          stockQuantity: LOW_STOCK_THRESHOLD + 1,
        } as Item),
        item({ id: 'item-untracked', name: 'Sem controle' } as Item),
      ]

      const summary = summarizeDashboard(db, MONTH)

      expect(summary.openTabsCount).toBe(2)
      expect(summary.lowStockItems).toEqual([db.items[0]])
    })
  })
})
