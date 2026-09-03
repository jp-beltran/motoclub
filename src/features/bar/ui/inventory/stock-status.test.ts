import { describe, expect, it } from 'vitest'

import { LOW_STOCK_THRESHOLD } from '../../application/constants'
import type { Item } from '../../domain/entities'
import { describeStockStatus, getTrackedItems, isLowStock } from './stock-status'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    name: 'Cerveja lata',
    unitCostCents: 350,
    unitPriceCents: 700,
    ...overrides,
  }
}

describe('isLowStock', () => {
  it('is false for an item that does not track stock', () => {
    expect(isLowStock(makeItem({ stockQuantity: undefined }))).toBe(false)
  })

  it('is true for an item exactly at the low-stock threshold', () => {
    expect(isLowStock(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD }))).toBe(true)
  })

  it('is true for an item below the low-stock threshold', () => {
    expect(isLowStock(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD - 1 }))).toBe(true)
  })

  it('is false for an item above the low-stock threshold', () => {
    expect(isLowStock(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD + 1 }))).toBe(false)
  })
})

describe('describeStockStatus', () => {
  it('marks an untracked item as "não controlado", never as zero', () => {
    expect(describeStockStatus(makeItem({ stockQuantity: undefined }))).toEqual({
      label: 'Não controlado',
      critical: false,
    })
  })

  it('labels a tracked item at the threshold as critical', () => {
    expect(describeStockStatus(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD }))).toEqual({
      label: `${LOW_STOCK_THRESHOLD} (estoque crítico)`,
      critical: true,
    })
  })

  it('labels a tracked item above the threshold without the critical marker', () => {
    expect(describeStockStatus(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD + 10 }))).toEqual({
      label: `${LOW_STOCK_THRESHOLD + 10}`,
      critical: false,
    })
  })
})

describe('getTrackedItems', () => {
  it('keeps only items that track stock', () => {
    const tracked = makeItem({ id: 'item-tracked', stockQuantity: 10 })
    const untracked = makeItem({ id: 'item-untracked', stockQuantity: undefined })

    expect(getTrackedItems([tracked, untracked])).toEqual([tracked])
  })
})
