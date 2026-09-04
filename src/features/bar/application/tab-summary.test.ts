import { describe, expect, it } from 'vitest'

import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../domain/constants'
import type { Consumption, Item, Payment } from '../domain/entities'
import type { BarDatabase } from './bar-repository'
import { summarizeTab } from './tab-summary'

const CERVEJA: Item = {
  id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700,
}
const AGUA: Item = {
  id: 'item-agua', name: 'Água mineral', unitCostCents: 150, unitPriceCents: 400,
}

function consumption(overrides: Partial<Consumption> & { readonly id: string }): Consumption {
  return {
    tabId: 'tab-rafael',
    consumerId: 'visitor-rafael',
    itemId: CERVEJA.id,
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: CERVEJA.unitPriceCents,
    unitCostCents: CERVEJA.unitCostCents,
    createdAt: '2026-09-19T19:00:00.000Z',
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function database(
  consumptions: readonly Consumption[],
  payments: readonly Payment[] = [],
): BarDatabase {
  return {
    consumers: [
      { id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR },
    ],
    items: [CERVEJA, AGUA],
    events: [{ id: 'event-encontro', name: 'Encontro', startsAt: '2026-09-19T18:00:00.000Z' }],
    tabs: [{
      id: 'tab-rafael', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
      eventId: 'event-encontro', visitorId: 'visitor-rafael',
      openedAt: '2026-09-19T18:10:00.000Z',
    }],
    consumptions: [...consumptions],
    payments: [...payments],
    stockMovements: [],
    monthlyClosings: [],
    memberStatements: [],
  }
}

describe('summarizeTab', () => {
  it('groups repeated launches of one item into a single line', () => {
    const summary = summarizeTab(
      database([
        consumption({ id: 'c1', quantity: 2 }),
        consumption({ id: 'c2', itemId: AGUA.id, unitPriceCents: AGUA.unitPriceCents }),
        consumption({ id: 'c3', quantity: 3 }),
      ]),
      'tab-rafael',
    )

    expect(summary?.lines).toEqual([
      {
        itemId: 'item-cerveja', itemName: 'Cerveja lata', quantity: 5,
        unitPriceCents: 700, subtotalCents: 3500,
      },
      {
        itemId: 'item-agua', itemName: 'Água mineral', quantity: 1,
        unitPriceCents: 400, subtotalCents: 400,
      },
    ])
    expect(summary?.totalCents).toBe(3900)
  })

  it('lists courtesy separately and keeps it out of the total', () => {
    const summary = summarizeTab(
      database([
        consumption({ id: 'c1', quantity: 2 }),
        consumption({
          id: 'c2', chargeKind: CHARGE_KIND.COURTESY, itemId: AGUA.id,
          unitPriceCents: AGUA.unitPriceCents, quantity: 3,
        }),
      ]),
      'tab-rafael',
    )

    expect(summary?.totalCents).toBe(1400)
    expect(summary?.lines.map(({ itemId }) => itemId)).toEqual(['item-cerveja'])
    expect(summary?.courtesyLines).toEqual([{
      itemId: 'item-agua', itemName: 'Água mineral', quantity: 3,
      unitPriceCents: 400, subtotalCents: 1200,
    }])
  })

  it('ignores cancelled launches in lines and total', () => {
    const summary = summarizeTab(
      database([
        consumption({ id: 'c1', quantity: 2 }),
        consumption({
          id: 'c2', quantity: 5, status: CONSUMPTION_STATUS.CANCELLED,
          cancelledAt: '2026-09-19T19:30:00.000Z', cancelledByActorId: 'admin-demo',
        }),
      ]),
      'tab-rafael',
    )

    expect(summary?.lines).toEqual([{
      itemId: 'item-cerveja', itemName: 'Cerveja lata', quantity: 2,
      unitPriceCents: 700, subtotalCents: 1400,
    }])
    expect(summary?.totalCents).toBe(1400)
  })

  it('reports a partial payment against the tab total', () => {
    const summary = summarizeTab(
      database(
        [consumption({ id: 'c1', quantity: 3 })],
        [{
          id: 'p1', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael',
          amountCents: 500, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo',
        }],
      ),
      'tab-rafael',
    )

    expect(summary?.payment).toEqual({
      paidCents: 500, remainingCents: 1600, status: PAYMENT_STATUS.PARTIAL,
    })
  })

  it('reports an unpaid tab with no payments and exposes tab and consumer', () => {
    const summary = summarizeTab(database([consumption({ id: 'c1' })]), 'tab-rafael')

    expect(summary?.payment).toEqual({
      paidCents: 0, remainingCents: 700, status: PAYMENT_STATUS.UNPAID,
    })
    expect(summary?.tab.id).toBe('tab-rafael')
    expect(summary?.consumer.name).toBe('Rafael Oliveira')
  })

  it('ignores payments aimed at another tab or at a statement', () => {
    const summary = summarizeTab(
      database(
        [consumption({ id: 'c1' })],
        [
          {
            id: 'p1', target: PAYMENT_TARGET.TAB, targetId: 'tab-outra',
            amountCents: 300, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo',
          },
          {
            id: 'p2', target: PAYMENT_TARGET.STATEMENT, targetId: 'tab-rafael',
            amountCents: 400, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo',
          },
        ],
      ),
      'tab-rafael',
    )

    expect(summary?.payment.paidCents).toBe(0)
  })

  it('returns undefined for a tab that does not exist', () => {
    expect(summarizeTab(database([]), 'tab-inexistente')).toBeUndefined()
  })

  it('summarizes an empty tab as a zero total with no lines', () => {
    const summary = summarizeTab(database([]), 'tab-rafael')

    expect(summary).toMatchObject({ lines: [], courtesyLines: [], totalCents: 0 })
    expect(summary?.payment.status).toBe(PAYMENT_STATUS.UNPAID)
  })
})
