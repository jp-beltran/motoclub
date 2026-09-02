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
})
