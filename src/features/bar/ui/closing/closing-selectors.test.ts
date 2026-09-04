import { describe, expect, it } from 'vitest'

import type { BarDatabase } from '../../application/bar-repository'
import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_TARGET,
} from '../../domain/constants'
import type { Consumption, MemberStatement, Tab } from '../../domain/entities'
import { TAB_KIND, TAB_STATUS } from '../../domain/constants'
import {
  buildMonthPreview,
  listClosingMonths,
  summarizeClosedStatement,
} from './closing-selectors'

const MONTH = '2026-09'

/**
 * `getMonthKey` is local-time based, so every date fixture here is built
 * from a local `Date` constructor (never a hardcoded `...Z` string) — that
 * keeps these tests correct in any timezone the suite happens to run in.
 */
function localIso(year: number, monthIndex: number, day: number, hour = 12): string {
  return new Date(year, monthIndex, day, hour, 0).toISOString()
}

const SEPTEMBER_INSTANT = localIso(2026, 8, 12)
const AUGUST_INSTANT = localIso(2026, 7, 20)

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

function consumption(overrides: Partial<Consumption> & { readonly id: string }): Consumption {
  return {
    tabId: 'tab-ana-mensal',
    consumerId: 'member-ana',
    itemId: 'item-cerveja',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 700,
    unitCostCents: 350,
    createdAt: SEPTEMBER_INSTANT,
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

describe('buildMonthPreview', () => {
  function baseDatabase(): BarDatabase {
    return {
      ...emptyDatabase(),
      consumers: [
        { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER, active: true },
        { id: 'member-bruno', name: 'Bruno Santos', kind: CONSUMER_KIND.MEMBER, active: true },
        { id: 'member-celia', name: 'Célia Martins', kind: CONSUMER_KIND.MEMBER, active: true },
        { id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR, active: true },
      ],
      items: [
        { id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700 },
        { id: 'item-agua', name: 'Água mineral', unitCostCents: 150, unitPriceCents: 400 },
      ],
    }
  }

  it('lists only members with consumption in the month, grouped into lines with a total', () => {
    const database = baseDatabase()
    database.consumptions = [
      consumption({ id: 'c1', quantity: 2 }),
      consumption({ id: 'c2', consumerId: 'member-ana', quantity: 1 }),
      consumption({
        id: 'c3', consumerId: 'visitor-rafael', tabId: 'tab-rafael-evento',
      }),
    ]

    const preview = buildMonthPreview(database, MONTH)

    expect(preview).toHaveLength(1)
    expect(preview[0].consumer.id).toBe('member-ana')
    expect(preview[0].lines).toEqual([
      { itemName: 'Cerveja lata', quantity: 3, subtotalCents: 2100 },
    ])
    expect(preview[0].totalCents).toBe(2100)
  })

  it('excludes a member with no consumption in the month at all', () => {
    const database = baseDatabase()
    database.consumptions = [consumption({ id: 'c1', consumerId: 'member-bruno' })]

    const preview = buildMonthPreview(database, MONTH)

    expect(preview.map((row) => row.consumer.id)).toEqual(['member-bruno'])
    expect(preview.some((row) => row.consumer.id === 'member-celia')).toBe(false)
  })

  it('scopes consumption by local month, not by tab', () => {
    const database = baseDatabase()
    database.consumptions = [
      consumption({ id: 'c1', createdAt: SEPTEMBER_INSTANT }),
      consumption({ id: 'c2', createdAt: AUGUST_INSTANT }),
    ]

    const preview = buildMonthPreview(database, MONTH)

    expect(preview[0].totalCents).toBe(700)
  })

  it('keeps courtesy consumption out of the lines and the total', () => {
    const database = baseDatabase()
    database.consumptions = [
      consumption({ id: 'c1', quantity: 2 }),
      consumption({
        id: 'c2', chargeKind: CHARGE_KIND.COURTESY, itemId: 'item-agua',
        unitPriceCents: 400, quantity: 3,
      }),
    ]

    const preview = buildMonthPreview(database, MONTH)

    expect(preview[0].lines).toEqual([
      { itemName: 'Cerveja lata', quantity: 2, subtotalCents: 1400 },
    ])
    expect(preview[0].totalCents).toBe(1400)
  })

  it('still includes a member whose only consumption this month is a courtesy', () => {
    const database = baseDatabase()
    database.consumptions = [
      consumption({
        id: 'c1', consumerId: 'member-bruno', chargeKind: CHARGE_KIND.COURTESY,
        itemId: 'item-agua', unitPriceCents: 400, quantity: 2,
      }),
    ]

    const preview = buildMonthPreview(database, MONTH)

    // Matches consolidateMonth's unconditional inclusion (any status/charge
    // kind counts) — the member has no charged lines and nothing due yet,
    // but still shows up so the preview never silently drops someone the
    // closing itself would still produce a (empty) statement for.
    expect(preview).toHaveLength(1)
    expect(preview[0].consumer.id).toBe('member-bruno')
    expect(preview[0].lines).toEqual([])
    expect(preview[0].totalCents).toBe(0)
  })

  it('still includes a member whose only consumption this month was cancelled', () => {
    const database = baseDatabase()
    database.consumptions = [
      consumption({
        id: 'c1', consumerId: 'member-bruno', quantity: 5,
        status: CONSUMPTION_STATUS.CANCELLED,
        cancelledAt: SEPTEMBER_INSTANT, cancelledByActorId: 'admin-demo',
      }),
    ]

    const preview = buildMonthPreview(database, MONTH)

    expect(preview).toHaveLength(1)
    expect(preview[0].consumer.id).toBe('member-bruno')
    expect(preview[0].lines).toEqual([])
    expect(preview[0].totalCents).toBe(0)
  })
})

describe('summarizeClosedStatement', () => {
  function statementDatabase(): BarDatabase {
    return {
      ...emptyDatabase(),
      consumers: [
        { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER, active: true },
      ],
      items: [
        { id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700 },
      ],
    }
  }

  const statement: MemberStatement = {
    id: 'statement-1',
    memberId: 'member-ana',
    month: MONTH,
    consumptions: [consumption({ id: 'c1', quantity: 3 })],
    createdAt: '2026-10-01T12:00:00.000Z',
  }

  it('summarizes the statement lines, total and consumer', () => {
    const summary = summarizeClosedStatement(statementDatabase(), statement)

    expect(summary?.consumer.name).toBe('Ana Paula')
    expect(summary?.lines).toEqual([
      { itemName: 'Cerveja lata', quantity: 3, subtotalCents: 2100 },
    ])
    expect(summary?.totalCents).toBe(2100)
  })

  it('reports unpaid when there is no matching statement payment', () => {
    const summary = summarizeClosedStatement(statementDatabase(), statement)

    expect(summary?.payment).toEqual({
      paidCents: 0, remainingCents: 2100, status: PAYMENT_STATUS.UNPAID,
    })
  })

  it('reports a partial payment made against this statement', () => {
    const database = statementDatabase()
    database.payments = [
      {
        id: 'payment-1', target: PAYMENT_TARGET.STATEMENT, targetId: 'statement-1',
        amountCents: 1000, paidAt: '2026-10-02T12:00:00.000Z', actorId: 'admin-demo',
      },
    ]

    const summary = summarizeClosedStatement(database, statement)

    expect(summary?.payment).toEqual({
      paidCents: 1000, remainingCents: 1100, status: PAYMENT_STATUS.PARTIAL,
    })
  })

  it('ignores a payment aimed at a tab, or at another statement', () => {
    const database = statementDatabase()
    database.payments = [
      {
        id: 'payment-1', target: PAYMENT_TARGET.TAB, targetId: 'tab-ana-mensal',
        amountCents: 500, paidAt: '2026-10-02T12:00:00.000Z', actorId: 'admin-demo',
      },
      {
        id: 'payment-2', target: PAYMENT_TARGET.STATEMENT, targetId: 'statement-outra',
        amountCents: 500, paidAt: '2026-10-02T12:00:00.000Z', actorId: 'admin-demo',
      },
    ]

    const summary = summarizeClosedStatement(database, statement)

    expect(summary?.payment.paidCents).toBe(0)
  })

  it('ignores a cancelled consumption in the statement, kept only as history', () => {
    const database = statementDatabase()
    const withCancelled: MemberStatement = {
      ...statement,
      consumptions: [
        consumption({ id: 'c1', quantity: 3 }),
        consumption({
          id: 'c2', quantity: 5, status: CONSUMPTION_STATUS.CANCELLED,
          cancelledAt: '2026-09-13T12:00:00.000Z', cancelledByActorId: 'admin-demo',
        }),
      ],
    }

    const summary = summarizeClosedStatement(database, withCancelled)

    expect(summary?.lines).toEqual([
      { itemName: 'Cerveja lata', quantity: 3, subtotalCents: 2100 },
    ])
    expect(summary?.totalCents).toBe(2100)
  })

  it('returns undefined when the statement member is not in the snapshot', () => {
    const database = statementDatabase()
    database.consumers = []

    expect(summarizeClosedStatement(database, statement)).toBeUndefined()
  })
})

describe('listClosingMonths', () => {
  const ANA = { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER, active: true }
  const RAFAEL = {
    id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR, active: true,
  }

  function monthlyTabFor(month: string): Tab {
    return {
      id: `tab-ana-${month}`, kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: ANA.id, month, openedAt: localIso(Number(month.slice(0, 4)), 0, 1),
    }
  }

  it('always offers the current month, even with nothing in it yet', () => {
    expect(listClosingMonths(emptyDatabase(), '2026-10')).toEqual([
      { month: '2026-10', isClosed: false },
    ])
  })

  it('offers an earlier month that still has member consumption nobody closed', () => {
    const snapshot = emptyDatabase()
    snapshot.consumers = [ANA]
    snapshot.tabs = [monthlyTabFor('2026-09')]
    snapshot.consumptions = [
      consumption({ id: 'c1', tabId: 'tab-ana-mensal', createdAt: SEPTEMBER_INSTANT }),
    ]

    expect(listClosingMonths(snapshot, '2026-10')).toEqual([
      { month: '2026-10', isClosed: false },
      { month: '2026-09', isClosed: false },
    ])
  })

  it('keeps a month that was already closed reachable, marked as closed', () => {
    const snapshot = emptyDatabase()
    snapshot.consumers = [ANA]
    snapshot.monthlyClosings = [{
      id: 'closing-1', month: '2026-09', statementIds: [],
      closedAt: localIso(2026, 9, 1), actorId: 'admin-demo',
    }]

    expect(listClosingMonths(snapshot, '2026-10')).toEqual([
      { month: '2026-10', isClosed: false },
      { month: '2026-09', isClosed: true },
    ])
  })

  it('ignores a month where only visitors consumed — a closing there produces nothing', () => {
    const snapshot = emptyDatabase()
    snapshot.consumers = [RAFAEL]
    snapshot.tabs = [{
      id: 'tab-visitor', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
      eventId: 'event-1', visitorId: RAFAEL.id, openedAt: SEPTEMBER_INSTANT,
    }]
    snapshot.consumptions = [
      consumption({ id: 'c1', consumerId: RAFAEL.id, tabId: 'tab-visitor', createdAt: SEPTEMBER_INSTANT }),
    ]

    expect(listClosingMonths(snapshot, '2026-10')).toEqual([
      { month: '2026-10', isClosed: false },
    ])
  })

  it('lists the newest month first and never repeats one', () => {
    const snapshot = emptyDatabase()
    snapshot.consumers = [ANA]
    snapshot.tabs = [monthlyTabFor('2026-08'), monthlyTabFor('2026-09')]
    snapshot.consumptions = [
      consumption({ id: 'c1', tabId: 'tab-ana-2026-08', createdAt: AUGUST_INSTANT }),
      consumption({ id: 'c2', tabId: 'tab-ana-mensal', createdAt: SEPTEMBER_INSTANT }),
      consumption({ id: 'c3', tabId: 'tab-ana-mensal', createdAt: localIso(2026, 8, 15) }),
    ]

    expect(listClosingMonths(snapshot, MONTH).map(({ month }) => month)).toEqual([
      '2026-09', '2026-08',
    ])
  })
})
