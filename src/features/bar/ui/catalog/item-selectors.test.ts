import { describe, expect, it } from 'vitest'

import type { Item } from '../../domain/entities'
import {
  ALL_CATEGORIES,
  filterCatalogItems,
  formatMarginRatio,
  getItemCategories,
  splitItemsByStatus,
} from './item-selectors'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    name: 'Cerveja lata',
    code: 'BEV-001',
    category: 'Bebidas',
    unitCostCents: 350,
    unitPriceCents: 700,
    active: true,
    ...overrides,
  }
}

describe('splitItemsByStatus', () => {
  it('separates active items from inactive ones', () => {
    const active = makeItem({ id: 'item-active', active: true })
    const inactive = makeItem({ id: 'item-inactive', active: false })

    expect(splitItemsByStatus([active, inactive])).toEqual({
      active: [active],
      inactive: [inactive],
    })
  })

  it('treats an item with no active flag as active', () => {
    const implicitlyActive = makeItem({ id: 'item-implicit', active: undefined })

    expect(splitItemsByStatus([implicitlyActive])).toEqual({
      active: [implicitlyActive],
      inactive: [],
    })
  })
})

describe('getItemCategories', () => {
  it('returns unique categories sorted alphabetically', () => {
    const items = [
      makeItem({ id: 'a', category: 'Comidas' }),
      makeItem({ id: 'b', category: 'Bebidas' }),
      makeItem({ id: 'c', category: 'Bebidas' }),
    ]

    expect(getItemCategories(items)).toEqual(['Bebidas', 'Comidas'])
  })

  it('ignores items without a category', () => {
    const items = [makeItem({ id: 'a', category: undefined })]

    expect(getItemCategories(items)).toEqual([])
  })
})

describe('filterCatalogItems', () => {
  const beer = makeItem({ id: 'item-beer', name: 'Cerveja lata', code: 'BEV-001', category: 'Bebidas' })
  const water = makeItem({ id: 'item-water', name: 'Água mineral', code: 'BEV-002', category: 'Bebidas' })
  const skewer = makeItem({ id: 'item-skewer', name: 'Espetinho', code: 'FOO-001', category: 'Comidas' })
  const items = [beer, water, skewer]

  it('returns every item when the search term and category are empty', () => {
    expect(filterCatalogItems(items, { searchTerm: '', category: ALL_CATEGORIES })).toEqual(items)
  })

  it('matches items by a case-insensitive substring of the name', () => {
    expect(filterCatalogItems(items, { searchTerm: 'cerv', category: ALL_CATEGORIES })).toEqual([beer])
  })

  it('matches items by a case-insensitive substring of the code', () => {
    expect(filterCatalogItems(items, { searchTerm: 'foo-001', category: ALL_CATEGORIES })).toEqual([skewer])
  })

  it('filters items by an exact category', () => {
    expect(filterCatalogItems(items, { searchTerm: '', category: 'Bebidas' })).toEqual([beer, water])
  })

  it('combines the search term and category filters', () => {
    expect(filterCatalogItems(items, { searchTerm: 'água', category: 'Bebidas' })).toEqual([water])
    expect(filterCatalogItems(items, { searchTerm: 'água', category: 'Comidas' })).toEqual([])
  })
})

describe('formatMarginRatio', () => {
  it('formats a positive ratio as a pt-BR percentage', () => {
    expect(formatMarginRatio(0.5)).toBe('50,0%')
  })

  it('formats a negative ratio as a pt-BR percentage', () => {
    expect(formatMarginRatio(-2 / 7)).toBe('-28,6%')
  })

  it('formats a zero ratio', () => {
    expect(formatMarginRatio(0)).toBe('0,0%')
  })
})
