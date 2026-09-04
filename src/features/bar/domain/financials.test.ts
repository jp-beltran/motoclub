import { describe, expect, it } from 'vitest'

import { expectBarErrorCode } from '../../../test/bar-error-assertions'
import { CHARGE_KIND, CONSUMPTION_STATUS } from './constants'
import type { Consumption, Item } from './entities'
import {
  calculateFinancials,
  getConsumptionLineTotalCents,
  getItemMarginRatio,
  summarizeTabConsumptions,
} from './financials'

const BASE_CONSUMPTION: Consumption = {
  id: 'consumption-1',
  tabId: 'tab-1',
  consumerId: 'member-1',
  itemId: 'item-1',
  status: CONSUMPTION_STATUS.ACTIVE,
  chargeKind: CHARGE_KIND.CHARGED,
  quantity: 3,
  unitPriceCents: 750,
  unitCostCents: 400,
  createdAt: '2026-09-02T12:00:00.000Z',
  actorId: 'actor-1',
}

describe('bar financial rules', () => {
  it('calculates a consumption line total from its price snapshot', () => {
    expect(getConsumptionLineTotalCents(BASE_CONSUMPTION)).toBe(2_250)
  })

  it('rejects a line total that overflows safe integer cents', () => {
    expectBarErrorCode(() =>
      getConsumptionLineTotalCents({
        ...BASE_CONSUMPTION,
        quantity: 2,
        unitPriceCents: Number.MAX_SAFE_INTEGER,
      }), 'money-product-overflow')
  })

  it('totals only active charged revenue and retains active courtesies', () => {
    const courtesy = {
      ...BASE_CONSUMPTION,
      id: 'courtesy-1',
      chargeKind: CHARGE_KIND.COURTESY,
    }
    const cancelled = {
      ...BASE_CONSUMPTION,
      id: 'cancelled-1',
      status: CONSUMPTION_STATUS.CANCELLED,
      cancelledAt: '2026-09-02T13:00:00.000Z',
      cancelledByActorId: 'actor-2',
    }

    const summary = summarizeTabConsumptions([
      BASE_CONSUMPTION,
      courtesy,
      cancelled,
    ])

    expect(summary.totalCents).toBe(2_250)
    expect(summary.courtesyConsumptions).toEqual([courtesy])
  })

  it('calculates cost, profit, and margin from active charged and courtesy lines', () => {
    const courtesy = {
      ...BASE_CONSUMPTION,
      id: 'courtesy-1',
      chargeKind: CHARGE_KIND.COURTESY,
      quantity: 1,
    }

    expect(calculateFinancials([BASE_CONSUMPTION, courtesy])).toEqual({
      revenueCents: 2_250,
      costCents: 1_600,
      profitCents: 650,
      margin: 650 / 2_250,
    })
  })

  it('uses zero margin when revenue is zero', () => {
    const courtesy = {
      ...BASE_CONSUMPTION,
      chargeKind: CHARGE_KIND.COURTESY,
    }

    expect(calculateFinancials([courtesy])).toEqual({
      revenueCents: 0,
      costCents: 1_200,
      profitCents: -1_200,
      margin: 0,
    })
  })

  it('rejects revenue totals that overflow safe integer cents', () => {
    expectBarErrorCode(() =>
      summarizeTabConsumptions([
        { ...BASE_CONSUMPTION, quantity: 1, unitPriceCents: Number.MAX_SAFE_INTEGER },
        { ...BASE_CONSUMPTION, id: 'consumption-2', quantity: 1, unitPriceCents: 1 },
      ]), 'money-total-overflow')
  })

  it('rejects cost totals that overflow safe integer cents', () => {
    expectBarErrorCode(() =>
      calculateFinancials([
        { ...BASE_CONSUMPTION, quantity: 1, unitCostCents: Number.MAX_SAFE_INTEGER },
        { ...BASE_CONSUMPTION, id: 'consumption-2', quantity: 1, unitCostCents: 1 },
      ]), 'money-total-overflow')
  })
})

const BASE_ITEM: Item = {
  id: 'item-1',
  name: 'Cerveja lata',
  unitCostCents: 350,
  unitPriceCents: 700,
}

describe('getItemMarginRatio', () => {
  it('calculates the margin ratio between unit price and unit cost', () => {
    expect(getItemMarginRatio(BASE_ITEM)).toBe((700 - 350) / 700)
  })

  it('returns zero margin when the sale price equals the cost', () => {
    expect(
      getItemMarginRatio({ ...BASE_ITEM, unitCostCents: 700, unitPriceCents: 700 }),
    ).toBe(0)
  })

  it('returns zero margin when the sale price is zero', () => {
    expect(
      getItemMarginRatio({ ...BASE_ITEM, unitCostCents: 350, unitPriceCents: 0 }),
    ).toBe(0)
  })

  it('returns a negative margin when the cost exceeds the sale price', () => {
    expect(
      getItemMarginRatio({ ...BASE_ITEM, unitCostCents: 900, unitPriceCents: 700 }),
    ).toBe((700 - 900) / 700)
  })
})
