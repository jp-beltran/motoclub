import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { StorageLike } from '../../application/bar-repository'
import { LOW_STOCK_THRESHOLD } from '../../application/constants'
import type { Item } from '../../domain/entities'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { LocalBarRepository } from '../../infrastructure/local-bar-repository'
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

/**
 * These run against a real `LocalBarRepository` over in-memory storage, the
 * way `PagamentosView.test.tsx` does, so what the screen shows after a
 * refusal is the domain's own refusal — not a message this test invented.
 */
class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function renderCatalogWithRealRepository() {
  let id = 0
  const repository = new LocalBarRepository({
    storage: new MemoryStorage(),
    storageKey: 'test-catalog',
    nextId: () => `catalog-${++id}`,
    now: () => new Date().toISOString(),
  })
  return { ...renderWithBar(<CatalogView />, { repository }), repository }
}

async function fillItemForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { name?: string; price?: string; cost?: string; category?: string; code?: string },
) {
  if (values.name !== undefined) {
    await user.clear(screen.getByLabelText('Nome'))
    if (values.name) await user.type(screen.getByLabelText('Nome'), values.name)
  }
  if (values.code !== undefined) {
    await user.clear(screen.getByLabelText('Código'))
    if (values.code) await user.type(screen.getByLabelText('Código'), values.code)
  }
  if (values.category !== undefined) {
    await user.clear(screen.getByLabelText('Categoria'))
    if (values.category) await user.type(screen.getByLabelText('Categoria'), values.category)
  }
  if (values.price !== undefined) {
    await user.clear(screen.getByLabelText('Preço de venda (R$)'))
    if (values.price) await user.type(screen.getByLabelText('Preço de venda (R$)'), values.price)
  }
  if (values.cost !== undefined) {
    await user.clear(screen.getByLabelText('Custo (R$)'))
    if (values.cost) await user.type(screen.getByLabelText('Custo (R$)'), values.cost)
  }
}

describe('CatalogView item registration', () => {
  it('registers a new item with its price and cost in cents', async () => {
    const user = userEvent.setup()
    const { repository } = renderCatalogWithRealRepository()
    await screen.findByRole('table', { name: 'Itens ativos' })

    await fillItemForm(user, {
      name: 'Cerveja artesanal', code: 'BEV-900', category: 'Bebidas',
      price: '12,50', cost: '7,00',
    })
    await user.click(screen.getByRole('button', { name: 'Cadastrar item' }))

    const row = await screen.findByRole('row', { name: /Cerveja artesanal/ })
    expect(within(row).getByText('R$ 12,50')).toBeInTheDocument()
    expect(within(row).getByText('R$ 7,00')).toBeInTheDocument()
    expect((await repository.listItems()).find(({ name }) => name === 'Cerveja artesanal'))
      .toMatchObject({ unitPriceCents: 1250, unitCostCents: 700, active: true })
  })

  it('clears the form after a successful registration, ready for the next item', async () => {
    const user = userEvent.setup()
    renderCatalogWithRealRepository()
    await screen.findByRole('table', { name: 'Itens ativos' })

    await fillItemForm(user, { name: 'Suco de laranja', price: '8', cost: '3' })
    await user.click(screen.getByRole('button', { name: 'Cadastrar item' }))

    await screen.findByRole('row', { name: /Suco de laranja/ })
    expect(screen.getByLabelText('Nome')).toHaveValue('')
    expect(screen.getByLabelText('Preço de venda (R$)')).toHaveValue('')
  })

  it('shows the domain refusal for a blank name, without inventing its own rule', async () => {
    const user = userEvent.setup()
    const { repository } = renderCatalogWithRealRepository()
    await screen.findByRole('table', { name: 'Itens ativos' })
    const itemsBefore = (await repository.listItems()).length

    await fillItemForm(user, { name: '', price: '5', cost: '2' })
    await user.click(screen.getByRole('button', { name: 'Cadastrar item' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o nome do item.')
    expect((await repository.listItems()).length).toBe(itemsBefore)
  })

  it('says which money field it could not read when the text is not an amount', async () => {
    const user = userEvent.setup()
    renderCatalogWithRealRepository()
    await screen.findByRole('table', { name: 'Itens ativos' })

    await fillItemForm(user, { name: 'Item torto', price: 'abc', cost: '2' })
    await user.click(screen.getByRole('button', { name: 'Cadastrar item' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/preço de venda/i)
  })

  it('edits the price of an existing item, leaving its other fields alone', async () => {
    const user = userEvent.setup()
    const { repository } = renderCatalogWithRealRepository()
    await screen.findByRole('row', { name: /Cerveja lata/ })

    await user.click(screen.getByRole('button', { name: 'Editar Cerveja lata' }))
    expect(screen.getByLabelText('Preço de venda (R$)')).toHaveValue('7,00')
    expect(screen.getByLabelText('Custo (R$)')).toHaveValue('3,50')

    await fillItemForm(user, { price: '9,00' })
    await user.click(screen.getByRole('button', { name: 'Salvar item' }))

    await waitFor(async () =>
      expect((await repository.listItems()).find(({ id }) => id === 'item-cerveja'))
        .toMatchObject({ name: 'Cerveja lata', code: 'BEV-001', unitPriceCents: 900,
          unitCostCents: 350 }),
    )
    const row = await screen.findByRole('row', { name: /Cerveja lata/ })
    expect(within(row).getByText('R$ 9,00')).toBeInTheDocument()
  })

  it('goes back to registering a new item after an edit is cancelled', async () => {
    const user = userEvent.setup()
    renderCatalogWithRealRepository()
    await screen.findByRole('row', { name: /Cerveja lata/ })

    await user.click(screen.getByRole('button', { name: 'Editar Cerveja lata' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Cerveja lata')

    await user.click(screen.getByRole('button', { name: 'Cancelar edição' }))

    expect(screen.getByLabelText('Nome')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Cadastrar item' })).toBeInTheDocument()
  })

  it('retires an item into the inactive table and brings it back', async () => {
    const user = userEvent.setup()
    renderCatalogWithRealRepository()
    await screen.findByRole('row', { name: /Cerveja lata/ })

    await user.click(screen.getByRole('button', { name: 'Desativar Cerveja lata' }))

    const inactiveTable = await screen.findByRole('table', { name: 'Itens inativos' })
    expect(within(inactiveTable).getByRole('row', { name: /Cerveja lata/ })).toBeInTheDocument()
    expect(
      within(screen.getByRole('table', { name: 'Itens ativos' }))
        .queryByRole('row', { name: /Cerveja lata/ }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reativar Cerveja lata' }))

    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Itens ativos' }))
          .getByRole('row', { name: /Cerveja lata/ }),
      ).toBeInTheDocument(),
    )
  })
})
