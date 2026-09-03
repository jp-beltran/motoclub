import { describe, expect, it } from 'vitest'

import type { BarDatabase } from './bar-repository'
import { LOW_STOCK_THRESHOLD } from './constants'
import { summarizeDashboard } from './dashboard-summary'
import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  EVENT_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import type { Consumption, Item, MemberStatement, Payment, Tab } from '../domain/entities'

const MONTH = '2026-09'
const OTHER_MONTH = '2026-08'

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
    openedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  } as Tab
}

interface EventTabOverrides {
  readonly id: string
  readonly eventId: string
  readonly visitorId: string
  readonly status?: Tab['status']
}

function eventTab(overrides: EventTabOverrides): Tab {
  return {
    kind: TAB_KIND.EVENT,
    status: TAB_STATUS.OPEN,
    openedAt: '2026-09-19T18:00:00.000Z',
    ...overrides,
  } as Tab
}

function consumption(overrides: Partial<Consumption> & { id: string; tabId: string }): Consumption {
  return {
    consumerId: 'member-1',
    itemId: 'item-1',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 0,
    unitCostCents: 0,
    createdAt: '2026-09-12T20:00:00.000Z',
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function payment(overrides: Partial<Payment> & { id: string; target: Payment['target']; targetId: string; amountCents: number }): Payment {
  return {
    paidAt: '2026-09-19T21:00:00.000Z',
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
  it('returns zeros and a zero margin for a month with no movement', () => {
    const db = emptyDatabase()
    db.tabs = [monthlyTab({ id: 'tab-old', memberId: 'member-1', month: OTHER_MONTH })]
    db.consumptions = [
      consumption({ id: 'cons-old', tabId: 'tab-old', quantity: 2, unitPriceCents: 700, unitCostCents: 350 }),
    ]

    const summary = summarizeDashboard(db, MONTH)

    expect(summary).toEqual({
      revenueCents: 0,
      costCents: 0,
      profitCents: 0,
      margin: 0,
      receivedCents: 0,
      pendingCents: 0,
      openTabsCount: 1,
      lowStockItems: [],
    })
  })

  it('keeps a courtesy consumption out of revenue but inside cost', () => {
    const db = emptyDatabase()
    db.tabs = [monthlyTab({ id: 'tab-1', memberId: 'member-1', month: MONTH })]
    db.consumptions = [
      consumption({
        id: 'cons-courtesy',
        tabId: 'tab-1',
        chargeKind: CHARGE_KIND.COURTESY,
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
    expect(summary.receivedCents).toBe(0)
    expect(summary.pendingCents).toBe(0)
  })

  it('keeps a cancelled consumption out of revenue, cost and payment status', () => {
    const db = emptyDatabase()
    db.tabs = [monthlyTab({ id: 'tab-1', memberId: 'member-1', month: MONTH })]
    db.consumptions = [
      {
        ...consumption({
          id: 'cons-cancelled',
          tabId: 'tab-1',
          quantity: 3,
          unitPriceCents: 700,
          unitCostCents: 350,
        }),
        status: CONSUMPTION_STATUS.CANCELLED,
        cancelledAt: '2026-09-12T21:00:00.000Z',
        cancelledByActorId: 'admin-demo',
      } as Consumption,
    ]

    const summary = summarizeDashboard(db, MONTH)

    expect(summary.revenueCents).toBe(0)
    expect(summary.costCents).toBe(0)
    expect(summary.profitCents).toBe(0)
    expect(summary.margin).toBe(0)
    expect(summary.receivedCents).toBe(0)
    expect(summary.pendingCents).toBe(0)
  })

  it('splits a partial payment on an open event tab between received and pending', () => {
    const db = emptyDatabase()
    db.tabs = [eventTab({ id: 'tab-rafael', eventId: 'event-1', visitorId: 'visitor-1' })]
    db.consumptions = [
      consumption({
        id: 'cons-rafael',
        tabId: 'tab-rafael',
        consumerId: 'visitor-1',
        quantity: 2,
        unitPriceCents: 600,
        unitCostCents: 280,
      }),
    ]
    db.payments = [payment({ id: 'payment-1', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael', amountCents: 700 })]

    const summary = summarizeDashboard(db, MONTH)

    expect(summary.revenueCents).toBe(1_200)
    expect(summary.receivedCents).toBe(700)
    expect(summary.pendingCents).toBe(500)
  })

  it('splits a partial payment on a member statement between received and pending', () => {
    const db = emptyDatabase()
    const statementConsumption = consumption({
      id: 'cons-ana',
      tabId: 'tab-ana',
      consumerId: 'member-ana',
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
        closedAt: '2026-09-30T23:59:00.000Z',
      }),
    ]
    db.consumptions = [statementConsumption]
    const statement: MemberStatement = {
      id: 'statement-ana',
      memberId: 'member-ana',
      month: MONTH,
      consumptions: [statementConsumption],
      createdAt: '2026-09-30T23:59:00.000Z',
    }
    db.memberStatements = [statement]
    db.payments = [payment({ id: 'payment-ana', target: PAYMENT_TARGET.STATEMENT, targetId: 'statement-ana', amountCents: 400 })]

    const summary = summarizeDashboard(db, MONTH)

    expect(summary.revenueCents).toBe(1_400)
    expect(summary.receivedCents).toBe(400)
    expect(summary.pendingCents).toBe(1_000)
  })

  it('treats an unbilled monthly tab as fully pending and ignores a payment mistakenly targeting the tab directly', () => {
    const db = emptyDatabase()
    db.tabs = [monthlyTab({ id: 'tab-bruno', memberId: 'member-bruno', month: MONTH })]
    db.consumptions = [
      consumption({ id: 'cons-bruno', tabId: 'tab-bruno', consumerId: 'member-bruno', quantity: 2, unitPriceCents: 1_200, unitCostCents: 500 }),
    ]
    // A monthly tab can never carry a direct payment: members only settle
    // through a statement. This payment should be ignored entirely.
    db.payments = [payment({ id: 'stray-payment', target: PAYMENT_TARGET.TAB, targetId: 'tab-bruno', amountCents: 1_000 })]

    const summary = summarizeDashboard(db, MONTH)

    expect(summary.revenueCents).toBe(2_400)
    expect(summary.receivedCents).toBe(0)
    expect(summary.pendingCents).toBe(2_400)
  })

  it('includes open event tab consumption regardless of month, since events have no month attribution in the domain', () => {
    const db = emptyDatabase()
    db.events = [{ id: 'event-1', name: 'Encontro', startsAt: '2026-01-05T18:00:00.000Z', status: EVENT_STATUS.ACTIVE }]
    db.tabs = [eventTab({ id: 'tab-visitor', eventId: 'event-1', visitorId: 'visitor-1' })]
    db.consumptions = [
      consumption({ id: 'cons-visitor', tabId: 'tab-visitor', consumerId: 'visitor-1', quantity: 1, unitPriceCents: 500, unitCostCents: 200 }),
    ]

    const summary = summarizeDashboard(db, MONTH)

    expect(summary.revenueCents).toBe(500)
    expect(summary.pendingCents).toBe(500)
  })

  it('counts every open tab regardless of kind and flags items at or below the low-stock threshold, excluding untracked items', () => {
    const db = emptyDatabase()
    db.tabs = [
      monthlyTab({ id: 'tab-open-monthly', memberId: 'member-1', month: MONTH }),
      monthlyTab({
        id: 'tab-closed-monthly',
        memberId: 'member-2',
        month: MONTH,
        status: TAB_STATUS.CLOSED,
        closedAt: '2026-09-30T23:59:00.000Z',
      }),
      eventTab({ id: 'tab-open-event', eventId: 'event-1', visitorId: 'visitor-1' }),
    ]
    db.items = [
      item({ id: 'item-at-threshold', name: 'No limiar', stockQuantity: LOW_STOCK_THRESHOLD } as Item),
      item({ id: 'item-above-threshold', name: 'Acima', stockQuantity: LOW_STOCK_THRESHOLD + 1 } as Item),
      item({ id: 'item-untracked', name: 'Sem controle' } as Item),
    ]

    const summary = summarizeDashboard(db, MONTH)

    expect(summary.openTabsCount).toBe(2)
    expect(summary.lowStockItems).toEqual([db.items[0]])
  })
})
