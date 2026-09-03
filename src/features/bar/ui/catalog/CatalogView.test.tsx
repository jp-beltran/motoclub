import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { LOW_STOCK_THRESHOLD } from '../../application/constants'
import type { Item } from '../../domain/entities'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { renderWithBar } from '../../../../test/render-with-bar'
import { CatalogView } from './CatalogView'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-x',
    name: 'Item X',
    code: 'X-001',
    category: 'Bebidas',
    unit: 'unidade',
    active: true,
    favorite: false,
    unitCostCents: 300,
    unitPriceCents: 600,
    stockQuantity: 40,
    ...overrides,
  }
}

function renderCatalog(items: Item[]) {
  const database = { ...createDemoDatabase(), items }
  const repository = createFakeBarRepository({}, database)
  return renderWithBar(<CatalogView />, { repository })
}

describe('CatalogView', () => {
  it('lists active items with code, name, category, unit, cost, sale price, margin, stock and favorite', async () => {
    const beer = makeItem({
      id: 'item-beer',
      name: 'Cerveja lata',
      code: 'BEV-001',
      category: 'Bebidas',
      unit: 'lata',
      unitCostCents: 350,
      unitPriceCents: 700,
      stockQuantity: 40,
      favorite: true,
    })
    renderCatalog([beer])

    const row = await screen.findByRole('row', { name: /Cerveja lata/ })
    expect(within(row).getByText('BEV-001')).toBeInTheDocument()
    expect(within(row).getByText('Bebidas')).toBeInTheDocument()
    expect(within(row).getByText('lata')).toBeInTheDocument()
    expect(within(row).getByText('R$ 3,50')).toBeInTheDocument()
    expect(within(row).getByText('R$ 7,00')).toBeInTheDocument()
    expect(within(row).getByText('50,0%')).toBeInTheDocument()
    expect(within(row).getByText('40')).toBeInTheDocument()
    expect(within(row).getByText('Sim')).toBeInTheDocument()
  })

  it('filters items by a search term matching the name or code', async () => {
    const beer = makeItem({ id: 'item-beer', name: 'Cerveja lata', code: 'BEV-001' })
    const water = makeItem({ id: 'item-water', name: 'Água mineral', code: 'BEV-002' })
    const user = userEvent.setup()
    renderCatalog([beer, water])

    await screen.findByRole('row', { name: /Cerveja lata/ })
    const searchInput = screen.getByRole('searchbox', { name: 'Buscar por nome ou código' })
    await user.type(searchInput, 'água')

    expect(screen.queryByRole('row', { name: /Cerveja lata/ })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Água mineral/ })).toBeInTheDocument()
  })

  it('filters items by category', async () => {
    const beer = makeItem({ id: 'item-beer', name: 'Cerveja lata', category: 'Bebidas' })
    const skewer = makeItem({ id: 'item-skewer', name: 'Espetinho', category: 'Comidas' })
    const user = userEvent.setup()
    renderCatalog([beer, skewer])

    await screen.findByRole('row', { name: /Cerveja lata/ })
    const categorySelect = screen.getByRole('combobox', { name: 'Filtrar por categoria' })
    await user.selectOptions(categorySelect, 'Comidas')

    expect(screen.queryByRole('row', { name: /Cerveja lata/ })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Espetinho/ })).toBeInTheDocument()
  })

  it('separates inactive items from the active items table', async () => {
    const active = makeItem({ id: 'item-active', name: 'Item ativo', active: true })
    const inactive = makeItem({ id: 'item-inactive', name: 'Item inativo', active: false })
    renderCatalog([active, inactive])

    await screen.findByRole('row', { name: /Item ativo/ })
    expect(
      screen.getByRole('heading', { name: 'Itens inativos' }),
    ).toBeInTheDocument()

    const inactiveTable = screen.getByRole('table', { name: 'Itens inativos' })
    expect(within(inactiveTable).getByRole('row', { name: /Item inativo/ })).toBeInTheDocument()

    const activeTable = screen.getByRole('table', { name: 'Itens ativos' })
    expect(within(activeTable).queryByRole('row', { name: /Item inativo/ })).not.toBeInTheDocument()
  })

  it('shows an item without stock tracking as "não controlado", never as zero', async () => {
    const untracked = makeItem({ id: 'item-untracked', name: 'Camiseta', stockQuantity: undefined })
    renderCatalog([untracked])

    const row = await screen.findByRole('row', { name: /Camiseta/ })
    expect(within(row).getByText('Não controlado')).toBeInTheDocument()
    expect(within(row).queryByText('0')).not.toBeInTheDocument()
  })

  it('marks an item exactly at the low-stock threshold as critical', async () => {
    const critical = makeItem({
      id: 'item-critical',
      name: 'Espetinho',
      stockQuantity: LOW_STOCK_THRESHOLD,
    })
    renderCatalog([critical])

    const row = await screen.findByRole('row', { name: /Espetinho/ })
    expect(within(row).getByText(`${LOW_STOCK_THRESHOLD} (estoque crítico)`)).toBeInTheDocument()
  })
})
