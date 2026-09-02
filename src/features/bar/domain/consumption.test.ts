import { describe, expect, it } from 'vitest'

import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  STOCK_MOVEMENT_KIND,
  STOCK_WARNING,
  TAB_KIND,
  TAB_STATUS,
} from './constants'
import type { Consumption, Item, MonthlyTab } from './entities'
import { cancelConsumption, recordConsumption } from './consumption'

const OPEN_TAB: MonthlyTab = {
  id: 'tab-1',
  kind: TAB_KIND.MONTHLY,
  status: TAB_STATUS.OPEN,
  memberId: 'member-1',
  month: '2026-09',
  openedAt: '2026-09-01T12:00:00.000Z',
}

const UNTRACKED_ITEM: Item = {
  id: 'item-1',
  name: 'Refrigerante',
  unitCostCents: 300,
  unitPriceCents: 600,
}

const ACTIVE_CONSUMPTION: Consumption = {
  id: 'consumption-1',
  tabId: 'tab-1',
  consumerId: 'member-1',
  itemId: 'item-1',
  status: CONSUMPTION_STATUS.ACTIVE,
  chargeKind: CHARGE_KIND.CHARGED,
  quantity: 2,
  unitPriceCents: 600,
  unitCostCents: 300,
  createdAt: '2026-09-02T12:00:00.000Z',
  actorId: 'actor-1',
}

describe('consumption rules', () => {
  it('creates consumption with immutable price snapshots and injected identity and time', () => {
    const result = recordConsumption(
      {
        tab: OPEN_TAB,
        consumerId: 'member-1',
        item: UNTRACKED_ITEM,
        quantity: 2,
        chargeKind: CHARGE_KIND.CHARGED,
        actorId: 'actor-1',
      },
      {
        nextId: () => 'consumption-1',
        now: () => '2026-09-02T12:00:00.000Z',
      },
    )

    expect(result.consumption).toEqual({
      id: 'consumption-1',
      tabId: 'tab-1',
      consumerId: 'member-1',
      itemId: 'item-1',
      status: CONSUMPTION_STATUS.ACTIVE,
      chargeKind: CHARGE_KIND.CHARGED,
      quantity: 2,
      unitPriceCents: 600,
      unitCostCents: 300,
      createdAt: '2026-09-02T12:00:00.000Z',
      actorId: 'actor-1',
    })
    expect(result.stockMovement).toBeUndefined()
    expect(result.warnings).toEqual([])
  })

  it('forbids new consumption on a closed tab', () => {
    expect(() =>
      recordConsumption(
        {
          tab: { ...OPEN_TAB, status: TAB_STATUS.CLOSED },
          consumerId: 'member-1',
          item: UNTRACKED_ITEM,
          quantity: 1,
          chargeKind: CHARGE_KIND.CHARGED,
          actorId: 'actor-1',
        },
        {
          nextId: () => 'consumption-1',
          now: () => '2026-09-02T12:00:00.000Z',
        },
      ),
    ).toThrow('Cannot add consumption to a closed tab')
  })

  it('creates a stock decrement for tracked courtesy consumption', () => {
    const ids = ['consumption-1', 'stock-movement-1']
    const result = recordConsumption(
      {
        tab: OPEN_TAB,
        consumerId: 'member-1',
        item: { ...UNTRACKED_ITEM, stockQuantity: 10 },
        quantity: 2,
        chargeKind: CHARGE_KIND.COURTESY,
        actorId: 'actor-1',
      },
      {
        nextId: () => ids.shift() ?? 'unexpected-id',
        now: () => '2026-09-02T12:00:00.000Z',
      },
    )

    expect(result.stockMovement).toEqual({
      id: 'stock-movement-1',
      itemId: 'item-1',
      kind: STOCK_MOVEMENT_KIND.CONSUMPTION,
      quantityDelta: -2,
      occurredAt: '2026-09-02T12:00:00.000Z',
      actorId: 'actor-1',
      consumptionId: 'consumption-1',
    })
    expect(result.warnings).toEqual([])
  })

  it('warns about insufficient stock without blocking consumption', () => {
    const ids = ['consumption-1', 'stock-movement-1']
    const result = recordConsumption(
      {
        tab: OPEN_TAB,
        consumerId: 'member-1',
        item: { ...UNTRACKED_ITEM, stockQuantity: 1 },
        quantity: 2,
        chargeKind: CHARGE_KIND.CHARGED,
        actorId: 'actor-1',
      },
      {
        nextId: () => ids.shift() ?? 'unexpected-id',
        now: () => '2026-09-02T12:00:00.000Z',
      },
    )

    expect(result.consumption.id).toBe('consumption-1')
    expect(result.stockMovement?.quantityDelta).toBe(-2)
    expect(result.warnings).toEqual([STOCK_WARNING.INSUFFICIENT])
  })

  it('marks consumption cancelled and creates a tracked-stock reversal', () => {
    const result = cancelConsumption(
      {
        consumption: ACTIVE_CONSUMPTION,
        item: { ...UNTRACKED_ITEM, stockQuantity: 8 },
        actorId: 'actor-2',
      },
      {
        nextId: () => 'stock-movement-2',
        now: () => '2026-09-02T13:00:00.000Z',
      },
    )

    expect(result.consumption).toEqual({
      ...ACTIVE_CONSUMPTION,
      status: CONSUMPTION_STATUS.CANCELLED,
      cancelledAt: '2026-09-02T13:00:00.000Z',
      cancelledByActorId: 'actor-2',
    })
    expect(result.stockMovement).toEqual({
      id: 'stock-movement-2',
      itemId: 'item-1',
      kind: STOCK_MOVEMENT_KIND.REVERSAL,
      quantityDelta: 2,
      occurredAt: '2026-09-02T13:00:00.000Z',
      actorId: 'actor-2',
      consumptionId: 'consumption-1',
    })
  })
})
