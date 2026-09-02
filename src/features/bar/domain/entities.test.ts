import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_TARGET,
  STOCK_MOVEMENT_KIND,
  TAB_KIND,
  TAB_STATUS,
} from './constants'
import type {
  Consumption,
  Consumer,
  Event,
  Item,
  MemberStatement,
  MonthlyClosing,
  Payment,
  StockMovement,
  Tab,
} from './entities'

describe('bar domain entities', () => {
  it('exposes typed status constants for every entity variant', () => {
    expect(CONSUMER_KIND).toEqual({ MEMBER: 'member', VISITOR: 'visitor' })
    expect(TAB_KIND).toEqual({ EVENT: 'event', MONTHLY: 'monthly' })
    expect(TAB_STATUS).toEqual({ OPEN: 'open', CLOSED: 'closed' })
    expect(CONSUMPTION_STATUS).toEqual({ ACTIVE: 'active', CANCELLED: 'cancelled' })
    expect(CHARGE_KIND).toEqual({ CHARGED: 'charged', COURTESY: 'courtesy' })
    expect(PAYMENT_TARGET).toEqual({ TAB: 'tab', STATEMENT: 'statement' })
    expect(STOCK_MOVEMENT_KIND).toEqual({
      ENTRY: 'entry',
      CONSUMPTION: 'consumption',
      REVERSAL: 'reversal',
      ADJUSTMENT: 'adjustment',
    })

    expectTypeOf<Consumer>().toBeObject()
    expectTypeOf<Item>().toBeObject()
    expectTypeOf<Event>().toBeObject()
    expectTypeOf<Tab>().toBeObject()
    expectTypeOf<Consumption>().toBeObject()
    expectTypeOf<Payment>().toBeObject()
    expectTypeOf<StockMovement>().toBeObject()
    expectTypeOf<MonthlyClosing>().toBeObject()
    expectTypeOf<MemberStatement>().toBeObject()
  })

  it('prevents invalid tab and consumption lifecycle combinations', () => {
    // @ts-expect-error open tabs cannot carry a closing timestamp
    const openTabWithClosedAt: Tab = {
      id: 'tab-1',
      kind: TAB_KIND.MONTHLY,
      status: TAB_STATUS.OPEN,
      memberId: 'member-1',
      month: '2026-09',
      openedAt: '2026-09-01T12:00:00.000Z',
      closedAt: '2026-09-02T12:00:00.000Z',
    }
    // @ts-expect-error closed tabs require a closing timestamp
    const closedTabWithoutClosedAt: Tab = {
      id: 'tab-2',
      kind: TAB_KIND.MONTHLY,
      status: TAB_STATUS.CLOSED,
      memberId: 'member-1',
      month: '2026-09',
      openedAt: '2026-09-01T12:00:00.000Z',
    }
    // @ts-expect-error active consumption cannot carry cancellation metadata
    const activeWithCancellation: Consumption = {
      id: 'consumption-1',
      tabId: 'tab-1',
      consumerId: 'member-1',
      itemId: 'item-1',
      status: CONSUMPTION_STATUS.ACTIVE,
      chargeKind: CHARGE_KIND.CHARGED,
      quantity: 1,
      unitPriceCents: 600,
      unitCostCents: 300,
      createdAt: '2026-09-02T12:00:00.000Z',
      actorId: 'actor-1',
      cancelledAt: '2026-09-02T13:00:00.000Z',
      cancelledByActorId: 'actor-2',
    }
    // @ts-expect-error cancelled consumption requires cancellation metadata
    const cancelledWithoutMetadata: Consumption = {
      id: 'consumption-2',
      tabId: 'tab-1',
      consumerId: 'member-1',
      itemId: 'item-1',
      status: CONSUMPTION_STATUS.CANCELLED,
      chargeKind: CHARGE_KIND.CHARGED,
      quantity: 1,
      unitPriceCents: 600,
      unitCostCents: 300,
      createdAt: '2026-09-02T12:00:00.000Z',
      actorId: 'actor-1',
    }

    expect([
      openTabWithClosedAt,
      closedTabWithoutClosedAt,
      activeWithCancellation,
      cancelledWithoutMetadata,
    ]).toHaveLength(4)
  })
})
