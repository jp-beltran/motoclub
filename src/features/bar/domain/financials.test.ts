import { describe, expect, it } from 'vitest'

import { CHARGE_KIND, CONSUMPTION_STATUS } from './constants'
import type { Consumption } from './entities'
import {
  calculateFinancials,
  getConsumptionLineTotalCents,
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
})
