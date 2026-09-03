import { describe, expect, it } from 'vitest'

import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import type { Consumption, Item, MemberStatement, Payment, Tab } from '../domain/entities'
import type { BarDatabase } from './bar-repository'
import { summarizeDashboard } from './dashboard-summary'
import { calculateOutstandingCents, getConsumerOutstandingCents } from './outstanding'

const CERVEJA: Item = {
  id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700,
}

const ANA = { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER } as const
const RAFAEL = { id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR } as const

function consumption(overrides: Partial<Consumption> & { readonly id: string }): Consumption {
  return {
    tabId: 'tab-ana-mensal',
    consumerId: ANA.id,
    itemId: CERVEJA.id,
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: CERVEJA.unitPriceCents,
    unitCostCents: CERVEJA.unitCostCents,
    createdAt: '2026-09-12T20:00:00.000Z',
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function database(overrides: Partial<BarDatabase> = {}): BarDatabase {
  return {
    consumers: [ANA, RAFAEL],
    items: [CERVEJA],
    events: [],
    tabs: [],
    consumptions: [],
    payments: [],
    stockMovements: [],
    monthlyClosings: [],
    memberStatements: [],
    ...overrides,
  }
}

describe('getConsumerOutstandingCents', () => {
  it("sums a member's open monthly tab total", () => {
    const tab: Tab = {
      id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: ANA.id, month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z',
    }
    const snapshot = database({
      tabs: [tab],
      consumptions: [consumption({ id: 'c1', quantity: 3 })],
    })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(2100)
  })

  it('returns zero for a member with no monthly tab and no statement at all', () => {
    const snapshot = database({ tabs: [] })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(0)
  })

  it("still counts a member's monthly tab from an earlier month nobody closed", () => {
    // Ruling 27: debt does not expire when the calendar rolls over. This tab
    // was never turned into a statement, so nothing has billed it yet and the
    // member owes every cent of it — exactly what the dashboard already says.
    const tab: Tab = {
      id: 'tab-ana-2026-08', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: ANA.id, month: '2026-08', openedAt: '2026-08-01T12:00:00.000Z',
    }
    const snapshot = database({
      tabs: [tab],
      consumptions: [consumption({ id: 'c1', tabId: tab.id, createdAt: '2026-08-12T20:00:00.000Z' })],
    })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(700)
  })

  it("counts an earlier month's statement that is still unpaid", () => {
    const statement: MemberStatement = {
      id: 'statement-ana-2026-08', memberId: ANA.id, month: '2026-08',
      consumptions: [consumption({ id: 'c1', quantity: 2, createdAt: '2026-08-12T20:00:00.000Z' })],
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const snapshot = database({ memberStatements: [statement] })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(1400)
  })

  it("adds up a member's debt across several months at once", () => {
    const openTab: Tab = {
      id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: ANA.id, month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z',
    }
    const statement: MemberStatement = {
      id: 'statement-ana-2026-08', memberId: ANA.id, month: '2026-08',
      consumptions: [consumption({ id: 'c-old', quantity: 2, createdAt: '2026-08-12T20:00:00.000Z' })],
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const snapshot = database({
      tabs: [openTab],
      consumptions: [consumption({ id: 'c-new', quantity: 3 })],
      memberStatements: [statement],
    })

    // R$ 14,00 frozen in August plus R$ 21,00 still accruing in September.
    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(3500)
  })

  it('never counts a monthly tab a statement already billed twice', () => {
    const closedTab: Tab = {
      id: 'tab-ana-2026-08', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.CLOSED,
      memberId: ANA.id, month: '2026-08', openedAt: '2026-08-01T12:00:00.000Z',
      closedAt: '2026-09-01T00:00:00.000Z',
    }
    const billed = consumption({
      id: 'c1', tabId: closedTab.id, quantity: 2, createdAt: '2026-08-12T20:00:00.000Z',
    })
    const snapshot = database({
      tabs: [closedTab],
      consumptions: [billed],
      memberStatements: [{
        id: 'statement-ana-2026-08', memberId: ANA.id, month: '2026-08',
        consumptions: [billed], createdAt: '2026-09-01T00:00:00.000Z',
      }],
    })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(1400)
  })

  it('excludes cancelled and courtesy consumption from the monthly total', () => {
    const tab: Tab = {
      id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: ANA.id, month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z',
    }
    const snapshot = database({
      tabs: [tab],
      consumptions: [
        consumption({ id: 'c1', quantity: 1 }),
        consumption({
          id: 'c2', quantity: 5, status: CONSUMPTION_STATUS.CANCELLED,
          cancelledAt: '2026-09-13T00:00:00.000Z', cancelledByActorId: 'admin-demo',
        }),
        consumption({ id: 'c3', quantity: 2, chargeKind: CHARGE_KIND.COURTESY }),
      ],
    })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(700)
  })

  it(
    "derives a member's outstanding amount from their monthly statement, not the closed " +
      'monthly tab, once the month has been closed',
    () => {
      const closedTab: Tab = {
        id: 'tab-ana-mensal', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.CLOSED,
        memberId: ANA.id, month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z',
        closedAt: '2026-10-01T00:00:00.000Z',
      }
      const statement: MemberStatement = {
        id: 'statement-ana-2026-09', memberId: ANA.id, month: '2026-09',
        consumptions: [consumption({ id: 'c1', tabId: closedTab.id, quantity: 3 })],
        createdAt: '2026-10-01T00:00:00.000Z',
      }
      const payment: Payment = {
        id: 'payment-1', target: PAYMENT_TARGET.STATEMENT, targetId: statement.id,
        amountCents: 800, paidAt: '2026-10-02T00:00:00.000Z', actorId: 'admin-demo',
      }
      const snapshot = database({
        tabs: [closedTab],
        // A monthly tab never carries a direct payment, so if the total were
        // (wrongly) read from the tab's own `payment` field this would still
        // show the full 2100 as outstanding even though 800 was paid.
        memberStatements: [statement],
        payments: [payment],
      })

      expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(1300)
    },
  )

  it("reports a member's statement as fully settled once its payments cover it", () => {
    const statement: MemberStatement = {
      id: 'statement-ana-2026-09', memberId: ANA.id, month: '2026-09',
      consumptions: [consumption({ id: 'c1', quantity: 2 })],
      createdAt: '2026-10-01T00:00:00.000Z',
    }
    const payment: Payment = {
      id: 'payment-1', target: PAYMENT_TARGET.STATEMENT, targetId: statement.id,
      amountCents: 1400, paidAt: '2026-10-02T00:00:00.000Z', actorId: 'admin-demo',
    }
    const snapshot = database({ memberStatements: [statement], payments: [payment] })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(0)
  })

  it("sums a visitor's open event tabs", () => {
    const tabOne: Tab = {
      id: 'tab-rafael-1', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
      eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
    }
    const tabTwo: Tab = {
      id: 'tab-rafael-2', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
      eventId: 'event-2', visitorId: RAFAEL.id, openedAt: '2026-09-20T18:00:00.000Z',
    }
    const snapshot = database({
      tabs: [tabOne, tabTwo],
      consumptions: [
        consumption({ id: 'c1', tabId: tabOne.id, consumerId: RAFAEL.id, quantity: 1 }),
        consumption({ id: 'c2', tabId: tabTwo.id, consumerId: RAFAEL.id, quantity: 2 }),
      ],
    })

    expect(getConsumerOutstandingCents(snapshot, RAFAEL)).toBe(2100)
  })

  it(
    'sums an open and a closed event tab together — closing a tab does not settle it, ' +
      'so a closed tab still contributes what it owes',
    () => {
      const openTab: Tab = {
        id: 'tab-rafael-open', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
        eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
      }
      const closedTab: Tab = {
        id: 'tab-rafael-closed', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
        eventId: 'event-2', visitorId: RAFAEL.id, openedAt: '2026-09-05T18:00:00.000Z',
        closedAt: '2026-09-06T02:00:00.000Z',
      }
      const snapshot = database({
        tabs: [openTab, closedTab],
        consumptions: [
          consumption({ id: 'c1', tabId: openTab.id, consumerId: RAFAEL.id, quantity: 1 }),
          consumption({ id: 'c2', tabId: closedTab.id, consumerId: RAFAEL.id, quantity: 9 }),
        ],
      })

      expect(getConsumerOutstandingCents(snapshot, RAFAEL)).toBe(7000)
    },
  )

  it('excludes a closed event tab that was paid in full', () => {
    const closedTab: Tab = {
      id: 'tab-rafael-closed', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
      eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
      closedAt: '2026-09-19T22:00:00.000Z',
    }
    const payment: Payment = {
      id: 'payment-1', target: PAYMENT_TARGET.TAB, targetId: closedTab.id,
      amountCents: 1400, paidAt: '2026-09-19T22:05:00.000Z', actorId: 'admin-demo',
    }
    const snapshot = database({
      tabs: [closedTab],
      consumptions: [
        consumption({ id: 'c1', tabId: closedTab.id, consumerId: RAFAEL.id, quantity: 2 }),
      ],
      payments: [payment],
    })

    expect(getConsumerOutstandingCents(snapshot, RAFAEL)).toBe(0)
  })

  it('contributes only the remainder for a closed event tab that was partially paid', () => {
    const closedTab: Tab = {
      id: 'tab-rafael-closed', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
      eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
      closedAt: '2026-09-19T22:00:00.000Z',
    }
    const payment: Payment = {
      id: 'payment-1', target: PAYMENT_TARGET.TAB, targetId: closedTab.id,
      amountCents: 500, paidAt: '2026-09-19T22:05:00.000Z', actorId: 'admin-demo',
    }
    const snapshot = database({
      tabs: [closedTab],
      consumptions: [
        consumption({ id: 'c1', tabId: closedTab.id, consumerId: RAFAEL.id, quantity: 2 }),
      ],
      payments: [payment],
    })

    expect(getConsumerOutstandingCents(snapshot, RAFAEL)).toBe(900)
  })

  it('contributes its whole total for a closed event tab that was never paid', () => {
    const closedTab: Tab = {
      id: 'tab-rafael-closed', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
      eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
      closedAt: '2026-09-19T22:00:00.000Z',
    }
    const snapshot = database({
      tabs: [closedTab],
      consumptions: [
        consumption({ id: 'c1', tabId: closedTab.id, consumerId: RAFAEL.id, quantity: 2 }),
      ],
    })

    expect(getConsumerOutstandingCents(snapshot, RAFAEL)).toBe(1400)
  })

  it("subtracts payments already made against a visitor's event tab", () => {
    const tab: Tab = {
      id: 'tab-rafael-1', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
      eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
    }
    const payment: Payment = {
      id: 'payment-1', target: PAYMENT_TARGET.TAB, targetId: tab.id,
      amountCents: 500, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo',
    }
    const snapshot = database({
      tabs: [tab],
      consumptions: [consumption({ id: 'c1', tabId: tab.id, consumerId: RAFAEL.id, quantity: 2 })],
      payments: [payment],
    })

    expect(getConsumerOutstandingCents(snapshot, RAFAEL)).toBe(900)
  })
})

describe('calculateOutstandingCents', () => {
  it("is exactly the sum of every consumer's own outstanding total", () => {
    const monthlyTab: Tab = {
      id: 'tab-ana-2026-08', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: ANA.id, month: '2026-08', openedAt: '2026-08-01T12:00:00.000Z',
    }
    const eventTab: Tab = {
      id: 'tab-rafael-1', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
      eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
    }
    const snapshot = database({
      tabs: [monthlyTab, eventTab],
      consumptions: [
        consumption({ id: 'c1', tabId: monthlyTab.id, quantity: 3, createdAt: '2026-08-12T20:00:00.000Z' }),
        consumption({ id: 'c2', tabId: eventTab.id, consumerId: RAFAEL.id, quantity: 2 }),
      ],
    })

    expect(calculateOutstandingCents(snapshot)).toBe(
      getConsumerOutstandingCents(snapshot, ANA) + getConsumerOutstandingCents(snapshot, RAFAEL),
    )
    expect(calculateOutstandingCents(snapshot)).toBe(3500)
  })

  it('is the same number the dashboard reports as pending', () => {
    // The defect this replaces: a member's August tab nobody closed showed as
    // R$ 0,00 on /consumidores while the dashboard counted it in "Pendente".
    const staleTab: Tab = {
      id: 'tab-ana-2026-08', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: ANA.id, month: '2026-08', openedAt: '2026-08-01T12:00:00.000Z',
    }
    const snapshot = database({
      tabs: [staleTab],
      consumptions: [
        consumption({ id: 'c1', tabId: staleTab.id, quantity: 3, createdAt: '2026-08-12T20:00:00.000Z' }),
      ],
    })

    expect(getConsumerOutstandingCents(snapshot, ANA)).toBe(2100)
    expect(summarizeDashboard(snapshot, '2026-09').pendingCents).toBe(2100)
  })
})
