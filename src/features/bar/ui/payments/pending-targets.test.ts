import { describe, expect, it } from 'vitest'

import type { BarDatabase } from '../../application/bar-repository'
import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../../domain/constants'
import type { Consumption, MemberStatement, Payment } from '../../domain/entities'
import { listPendingTargets } from './pending-targets'

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
      { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER },
    ],
    items: [{ id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700 }],
    events: [
      { id: 'event-setembro', name: 'Encontro de setembro', startsAt: '2026-09-19T18:00:00.000Z' },
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
    ],
    consumptions: [
      consumption({ id: 'c1', tabId: 'tab-rafael', consumerId: 'visitor-rafael', quantity: 2 }),
      consumption({
        id: 'c2', tabId: 'tab-juliana', consumerId: 'visitor-juliana',
        chargeKind: CHARGE_KIND.COURTESY,
      }),
    ],
    payments: [],
    stockMovements: [],
    monthlyClosings: [],
    memberStatements: [],
  }
}

describe('listPendingTargets', () => {
  it('includes an event tab with an outstanding balance, target "tab"', () => {
    const targets = listPendingTargets(baseDatabase())
    const rafael = targets.find((target) => target.targetId === 'tab-rafael')

    expect(rafael?.target).toBe(PAYMENT_TARGET.TAB)
    expect(rafael?.totalCents).toBe(1400)
    expect(rafael?.payment.remainingCents).toBe(1400)
    expect(rafael?.payment.status).toBe(PAYMENT_STATUS.UNPAID)
    expect(rafael?.label).toContain('Rafael Oliveira')
  })

  it('excludes a tab with nothing due (courtesy-only consumption)', () => {
    const targets = listPendingTargets(baseDatabase())
    expect(targets.some((target) => target.targetId === 'tab-juliana')).toBe(false)
  })

  it('excludes a tab that is already fully paid', () => {
    const database = baseDatabase()
    database.payments = [
      { id: 'p1', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael', amountCents: 1400, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo' },
    ]
    const targets = listPendingTargets(database)
    expect(targets.some((target) => target.targetId === 'tab-rafael')).toBe(false)
  })

  it('includes a member statement with an outstanding balance, target "statement"', () => {
    const database = baseDatabase()
    const statement: MemberStatement = {
      id: 'statement-ana-2026-09', memberId: 'member-ana', month: '2026-09',
      consumptions: [
        consumption({ id: 'c-ana', tabId: 'tab-ana-2026-09', consumerId: 'member-ana', quantity: 3 }),
      ],
      createdAt: '2026-10-01T00:00:00.000Z',
    }
    database.memberStatements = [statement]

    const targets = listPendingTargets(database)
    const anaTarget = targets.find((target) => target.targetId === 'statement-ana-2026-09')

    expect(anaTarget?.target).toBe(PAYMENT_TARGET.STATEMENT)
    expect(anaTarget?.totalCents).toBe(2100)
    expect(anaTarget?.payment.remainingCents).toBe(2100)
    expect(anaTarget?.label).toContain('Ana Paula')
  })

  it('excludes a member statement that is already fully paid', () => {
    const database = baseDatabase()
    const statement: MemberStatement = {
      id: 'statement-ana-2026-09', memberId: 'member-ana', month: '2026-09',
      consumptions: [
        consumption({ id: 'c-ana', tabId: 'tab-ana-2026-09', consumerId: 'member-ana', quantity: 3 }),
      ],
      createdAt: '2026-10-01T00:00:00.000Z',
    }
    const payment: Payment = {
      id: 'p-ana', target: PAYMENT_TARGET.STATEMENT, targetId: 'statement-ana-2026-09',
      amountCents: 2100, paidAt: '2026-10-01T10:00:00.000Z', actorId: 'admin-demo',
    }
    database.memberStatements = [statement]
    database.payments = [payment]

    const targets = listPendingTargets(database)
    expect(targets.some((target) => target.targetId === 'statement-ana-2026-09')).toBe(false)
  })

  it('carries the sorted payment history of each target', () => {
    const database = baseDatabase()
    database.payments = [
      { id: 'p1', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael', amountCents: 200, paidAt: '2026-09-19T20:00:00.000Z', actorId: 'admin-demo' },
      { id: 'p2', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael', amountCents: 300, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo' },
    ]
    const targets = listPendingTargets(database)
    const rafael = targets.find((target) => target.targetId === 'tab-rafael')

    expect(rafael?.payments.map((payment) => payment.id)).toEqual(['p2', 'p1'])
  })
})
