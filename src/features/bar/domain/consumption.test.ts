import { describe, expect, it } from 'vitest'

import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  STOCK_MOVEMENT_KIND,
  STOCK_WARNING,
  TAB_KIND,
  TAB_STATUS,
} from './constants'
import type {
  Consumption,
  EventTab,
  Item,
  MonthlyTab,
  StockMovement,
} from './entities'
import { cancelConsumption, recordConsumption } from './consumption'

const OPEN_TAB: MonthlyTab = {
  id: 'tab-1',
  kind: TAB_KIND.MONTHLY,
  status: TAB_STATUS.OPEN,
  memberId: 'member-1',
  month: '2026-09',
  openedAt: '2026-09-01T12:00:00.000Z',
}

const OPEN_EVENT_TAB: EventTab = {
  id: 'event-tab-1',
  kind: TAB_KIND.EVENT,
  status: TAB_STATUS.OPEN,
  eventId: 'event-1',
  visitorId: 'visitor-1',
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

const ORIGINAL_STOCK_MOVEMENT: StockMovement = {
  id: 'stock-movement-1',
  itemId: 'item-1',
  kind: STOCK_MOVEMENT_KIND.CONSUMPTION,
  quantityDelta: -2,
  occurredAt: '2026-09-02T12:00:00.000Z',
  actorId: 'actor-1',
  consumptionId: 'consumption-1',
}

describe('consumption rules', () => {
  it('creates consumption with immutable price snapshots and injected identity and time', () => {
    const result = recordConsumption(
      {
        tab: OPEN_TAB,
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

  it('derives a monthly consumption consumer from the tab member', () => {
    const result = recordConsumption(
      {
        tab: OPEN_TAB,
        item: UNTRACKED_ITEM,
        quantity: 1,
        chargeKind: CHARGE_KIND.CHARGED,
        actorId: 'actor-1',
      },
      {
        nextId: () => 'consumption-1',
        now: () => '2026-09-02T12:00:00.000Z',
      },
    )

    expect(result.consumption.consumerId).toBe('member-1')
  })

  it('derives an event consumption consumer from the tab visitor', () => {
    const result = recordConsumption(
      {
        tab: OPEN_EVENT_TAB,
        item: UNTRACKED_ITEM,
        quantity: 1,
        chargeKind: CHARGE_KIND.CHARGED,
        actorId: 'actor-1',
      },
      {
        nextId: () => 'consumption-1',
        now: () => '2026-09-02T12:00:00.000Z',
      },
    )

    expect(result.consumption.consumerId).toBe('visitor-1')
  })

  it('forbids new consumption on a closed tab', () => {
    expect(() =>
      recordConsumption(
        {
          tab: {
            ...OPEN_TAB,
            status: TAB_STATUS.CLOSED,
            closedAt: '2026-09-02T11:00:00.000Z',
          },
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

  it.each([
    ['negative cost', { unitCostCents: -1 }],
    ['unsafe cost', { unitCostCents: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative price', { unitPriceCents: -1 }],
    ['unsafe price', { unitPriceCents: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects an item with %s cents', (_caseName, itemOverride) => {
    expect(() =>
      recordConsumption(
        {
          tab: OPEN_TAB,
          item: { ...UNTRACKED_ITEM, ...itemOverride },
          quantity: 1,
          chargeKind: CHARGE_KIND.CHARGED,
          actorId: 'actor-1',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T12:00:00.000Z',
        },
      ),
    ).toThrow('Money amounts must use non-negative safe integer cents')
  })

  it('rejects a consumption whose line total overflows safe integer cents', () => {
    expect(() =>
      recordConsumption(
        {
          tab: OPEN_TAB,
          item: {
            ...UNTRACKED_ITEM,
            unitPriceCents: Number.MAX_SAFE_INTEGER,
          },
          quantity: 2,
          chargeKind: CHARGE_KIND.CHARGED,
          actorId: 'actor-1',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T12:00:00.000Z',
        },
      ),
    ).toThrow('Money product exceeds safe integer cents')
  })

  it('rejects a consumption whose cost total overflows safe integer cents', () => {
    expect(() =>
      recordConsumption(
        {
          tab: OPEN_TAB,
          item: {
            ...UNTRACKED_ITEM,
            unitCostCents: Number.MAX_SAFE_INTEGER,
          },
          quantity: 2,
          chargeKind: CHARGE_KIND.CHARGED,
          actorId: 'actor-1',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T12:00:00.000Z',
        },
      ),
    ).toThrow('Money product exceeds safe integer cents')
  })

  it('marks consumption cancelled and creates a tracked-stock reversal', () => {
    const result = cancelConsumption(
      {
        consumption: ACTIVE_CONSUMPTION,
        item: { ...UNTRACKED_ITEM, stockQuantity: 8 },
        originalStockMovement: ORIGINAL_STOCK_MOVEMENT,
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

  it('does not create a reversal without the original stock movement', () => {
    const result = cancelConsumption(
      {
        consumption: ACTIVE_CONSUMPTION,
        item: { ...UNTRACKED_ITEM, stockQuantity: 8 },
        actorId: 'actor-2',
      },
      {
        nextId: () => 'unexpected-id',
        now: () => '2026-09-02T13:00:00.000Z',
      },
    )

    expect(result.stockMovement).toBeUndefined()
  })

  it('rejects cancellation of an already-cancelled consumption', () => {
    expect(() =>
      cancelConsumption(
        {
          consumption: {
            ...ACTIVE_CONSUMPTION,
            status: CONSUMPTION_STATUS.CANCELLED,
            cancelledAt: '2026-09-02T12:30:00.000Z',
            cancelledByActorId: 'actor-1',
          },
          item: UNTRACKED_ITEM,
          actorId: 'actor-2',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T13:00:00.000Z',
        },
      ),
    ).toThrow('Only active consumption can be cancelled')
  })

  it('rejects cancellation with an item from another consumption', () => {
    expect(() =>
      cancelConsumption(
        {
          consumption: ACTIVE_CONSUMPTION,
          item: { ...UNTRACKED_ITEM, id: 'item-2' },
          actorId: 'actor-2',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T13:00:00.000Z',
        },
      ),
    ).toThrow('Consumption and item must match')
  })

  it('rejects a non-consumption original stock movement', () => {
    expect(() =>
      cancelConsumption(
        {
          consumption: ACTIVE_CONSUMPTION,
          item: UNTRACKED_ITEM,
          originalStockMovement: {
            ...ORIGINAL_STOCK_MOVEMENT,
            kind: STOCK_MOVEMENT_KIND.ENTRY,
          },
          actorId: 'actor-2',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T13:00:00.000Z',
        },
      ),
    ).toThrow('Original stock movement must match the consumption and item')
  })

  it('rejects an original stock movement for another consumption', () => {
    expect(() =>
      cancelConsumption(
        {
          consumption: ACTIVE_CONSUMPTION,
          item: UNTRACKED_ITEM,
          originalStockMovement: {
            ...ORIGINAL_STOCK_MOVEMENT,
            consumptionId: 'consumption-2',
          },
          actorId: 'actor-2',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T13:00:00.000Z',
        },
      ),
    ).toThrow('Original stock movement must match the consumption and item')
  })

  it('rejects an original stock movement for another item', () => {
    expect(() =>
      cancelConsumption(
        {
          consumption: ACTIVE_CONSUMPTION,
          item: UNTRACKED_ITEM,
          originalStockMovement: {
            ...ORIGINAL_STOCK_MOVEMENT,
            itemId: 'item-2',
          },
          actorId: 'actor-2',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T13:00:00.000Z',
        },
      ),
    ).toThrow('Original stock movement must match the consumption and item')
  })

  it('rejects an original stock movement with a mismatched quantity delta', () => {
    expect(() =>
      cancelConsumption(
        {
          consumption: ACTIVE_CONSUMPTION,
          item: UNTRACKED_ITEM,
          originalStockMovement: {
            ...ORIGINAL_STOCK_MOVEMENT,
            quantityDelta: -1,
          },
          actorId: 'actor-2',
        },
        {
          nextId: () => 'unexpected-id',
          now: () => '2026-09-02T13:00:00.000Z',
        },
      ),
    ).toThrow('Original stock movement must match the consumption and item')
  })
})
