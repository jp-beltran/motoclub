import { describe, expect, it } from 'vitest'

import { CHARGE_KIND, CONSUMPTION_STATUS } from '../../domain/constants'
import type { Consumption, Item } from '../../domain/entities'
import type { BarDatabase } from '../../application/bar-repository'
import { listConsumerHistory } from './consumer-history'

const CERVEJA: Item = {
  id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700,
}

function consumption(overrides: Partial<Consumption> & { readonly id: string }): Consumption {
  return {
    tabId: 'tab-ana-2026-09',
    consumerId: 'member-ana',
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
    consumers: [],
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

describe('listConsumerHistory', () => {
  it('maps a consumption to a history row with item name, quantity, value, date and status', () => {
    const snapshot = database({
      consumptions: [consumption({ id: 'c1', quantity: 2, createdAt: '2026-09-12T20:00:00.000Z' })],
    })

    expect(listConsumerHistory(snapshot, 'member-ana')).toEqual([
      {
        id: 'c1', itemName: 'Cerveja lata', quantity: 2, valueCents: 1400,
        createdAt: '2026-09-12T20:00:00.000Z', status: CONSUMPTION_STATUS.ACTIVE,
      },
    ])
  })

  it('includes a cancelled consumption, marked with its status', () => {
    const snapshot = database({
      consumptions: [
        consumption({
          id: 'c1', status: CONSUMPTION_STATUS.CANCELLED,
          cancelledAt: '2026-09-13T00:00:00.000Z', cancelledByActorId: 'admin-demo',
        }),
      ],
    })

    expect(listConsumerHistory(snapshot, 'member-ana')).toEqual([
      expect.objectContaining({ id: 'c1', status: CONSUMPTION_STATUS.CANCELLED }),
    ])
  })

  it('orders rows newest first', () => {
    const snapshot = database({
      consumptions: [
        consumption({ id: 'c1', createdAt: '2026-09-10T20:00:00.000Z' }),
        consumption({ id: 'c2', createdAt: '2026-09-15T20:00:00.000Z' }),
      ],
    })

    expect(listConsumerHistory(snapshot, 'member-ana').map((row) => row.id)).toEqual(['c2', 'c1'])
  })

  it('falls back to a placeholder name when the item no longer exists', () => {
    const snapshot = database({
      items: [],
      consumptions: [consumption({ id: 'c1' })],
    })

    expect(listConsumerHistory(snapshot, 'member-ana')[0].itemName).toBe('Item removido')
  })

  it("excludes another consumer's consumption", () => {
    const snapshot = database({
      consumptions: [
        consumption({ id: 'c1', consumerId: 'member-ana' }),
        consumption({ id: 'c2', consumerId: 'member-bruno' }),
      ],
    })

    expect(listConsumerHistory(snapshot, 'member-ana').map((row) => row.id)).toEqual(['c1'])
  })
})
