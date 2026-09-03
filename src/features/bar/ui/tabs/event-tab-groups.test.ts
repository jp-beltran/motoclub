import { describe, expect, it } from 'vitest'

import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  EVENT_STATUS,
  PAYMENT_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../../domain/constants'
import type { BarDatabase } from '../../application/bar-repository'
import type { Consumption, Payment } from '../../domain/entities'
import { groupEventTabs } from './event-tab-groups'

function consumption(overrides: Partial<Consumption> & { readonly id: string }): Consumption {
  return {
    tabId: 'tab-rafael',
    consumerId: 'visitor-rafael',
    itemId: 'item-cerveja',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 700,
    unitCostCents: 350,
    createdAt: '2026-09-19T19:00:00.000Z',
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function baseDatabase(): BarDatabase {
  return {
    consumers: [
      { id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR },
      { id: 'visitor-juliana', name: 'Juliana Costa', kind: CONSUMER_KIND.VISITOR },
      { id: 'visitor-carlos', name: 'Carlos Souza', kind: CONSUMER_KIND.VISITOR },
      { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER },
    ],
    items: [{ id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700 }],
    events: [
      {
        id: 'event-setembro', name: 'Encontro de setembro',
        startsAt: '2026-09-19T18:00:00.000Z', status: EVENT_STATUS.ACTIVE,
      },
      {
        id: 'event-aniversario', name: 'Aniversário do motoclube',
        startsAt: '2026-09-05T18:00:00.000Z', status: EVENT_STATUS.CLOSED,
      },
      {
        id: 'event-sem-comanda', name: 'Evento sem visitante',
        startsAt: '2026-09-01T18:00:00.000Z', status: EVENT_STATUS.CLOSED,
      },
    ],
    tabs: [
      {
        id: 'tab-rafael', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
        eventId: 'event-setembro', visitorId: 'visitor-rafael',
        openedAt: '2026-09-19T18:20:00.000Z',
      },
      {
        id: 'tab-juliana', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
        eventId: 'event-setembro', visitorId: 'visitor-juliana',
        openedAt: '2026-09-19T18:10:00.000Z',
      },
      {
        id: 'tab-ana-2026-09', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
        memberId: 'member-ana', month: '2026-09', openedAt: '2026-09-01T12:00:00.000Z',
      },
      {
        id: 'tab-carlos', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
        eventId: 'event-aniversario', visitorId: 'visitor-carlos',
        openedAt: '2026-09-05T18:10:00.000Z', closedAt: '2026-09-06T01:00:00.000Z',
      },
    ],
    consumptions: [],
    payments: [],
    stockMovements: [],
    monthlyClosings: [],
    memberStatements: [],
  }
}

describe('groupEventTabs', () => {
  it('reports the total and payment status of each event tab', () => {
    const database = baseDatabase()
    database.consumptions = [consumption({ id: 'c1', quantity: 2 })]
    const payments: Payment[] = [
      { id: 'p1', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael', amountCents: 700, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo' },
    ]
    database.payments = payments

    const groups = groupEventTabs(database)
    const setembroGroup = groups.find((group) => group.event.id === 'event-setembro')
    const rafaelSummary = setembroGroup?.tabs.find((summary) => summary.tab.id === 'tab-rafael')

    expect(rafaelSummary?.totalCents).toBe(1400)
    expect(rafaelSummary?.payment.paidCents).toBe(700)
    expect(rafaelSummary?.payment.remainingCents).toBe(700)
    expect(rafaelSummary?.payment.status).toBe(PAYMENT_STATUS.PARTIAL)
  })

  it('excludes monthly tabs from every group', () => {
    const groups = groupEventTabs(baseDatabase())
    const allTabIds = groups.flatMap((group) => group.tabs.map((summary) => summary.tab.id))
    expect(allTabIds).not.toContain('tab-ana-2026-09')
  })

  it('excludes events with no event tab at all', () => {
    const groups = groupEventTabs(baseDatabase())
    expect(groups.some((group) => group.event.id === 'event-sem-comanda')).toBe(false)
  })

  it('orders events by most recent start first', () => {
    const groups = groupEventTabs(baseDatabase())
    expect(groups.map((group) => group.event.id)).toEqual(['event-setembro', 'event-aniversario'])
  })

  it('orders tabs within an event by opening time', () => {
    const groups = groupEventTabs(baseDatabase())
    const setembroGroup = groups.find((group) => group.event.id === 'event-setembro')
    expect(setembroGroup?.tabs.map((summary) => summary.tab.id)).toEqual(['tab-juliana', 'tab-rafael'])
  })
})
