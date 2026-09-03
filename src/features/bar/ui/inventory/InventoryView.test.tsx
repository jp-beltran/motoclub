import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CURRENT_ACTOR_ID, CURRENT_ACTOR_NAME } from '../../application/actor'
import { LOW_STOCK_THRESHOLD } from '../../application/constants'
import type { AddStockMovementInput, BarRepository } from '../../application/bar-repository'
import { STOCK_MOVEMENT_KIND } from '../../domain/constants'
import type { Item, StockMovement } from '../../domain/entities'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { formatDateTime } from '../../../../shared/format'
import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { renderWithBar } from '../../../../test/render-with-bar'
import { InventoryView } from './InventoryView'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-beer',
    name: 'Cerveja lata',
    code: 'BEV-001',
    category: 'Bebidas',
    unit: 'lata',
    active: true,
    unitCostCents: 350,
    unitPriceCents: 700,
    stockQuantity: 10,
    ...overrides,
  }
}

interface StatefulFixture {
  readonly repository: BarRepository
  readonly getItems: () => Item[]
}

function createStatefulRepository(
  initialItems: Item[],
  initialMovements: StockMovement[] = [],
): StatefulFixture {
  let items = initialItems
  let movements = initialMovements
  let nextId = 1

  const repository = createFakeBarRepository(
    {
      getSnapshot: vi.fn(async () => ({
        ...createDemoDatabase(),
        items: structuredClone(items),
        stockMovements: structuredClone(movements),
      })),
      addStockMovement: vi.fn(async (input: AddStockMovementInput) => {
        const index = items.findIndex(({ id }) => id === input.itemId)
        if (index === -1) throw new Error('Item not found')
        const item = items[index]
        if (item.stockQuantity === undefined) {
          throw new Error('Item does not track stock')
        }
        const updated = { ...item, stockQuantity: item.stockQuantity + input.quantityDelta }
        items = [...items.slice(0, index), updated, ...items.slice(index + 1)]
        const movement: StockMovement = {
          id: `movement-${nextId++}`,
          itemId: input.itemId,
          kind: input.kind,
          quantityDelta: input.quantityDelta,
          occurredAt: '2026-09-03T12:00:00.000Z',
          actorId: input.actorId,
        }
        movements = [...movements, movement]
        return movement
      }),
    },
    createDemoDatabase(),
  )

  return { repository, getItems: () => items }
}

function renderInventory(repository: BarRepository) {
  return renderWithBar(<InventoryView />, { repository })
}

describe('InventoryView adjustment guidance', () => {
  it('says what a negative balance means before the operator creates one', async () => {
    renderWithBar(<InventoryView />)

    await userEvent.click(await screen.findByLabelText('Ajuste'))

    expect(
      screen.getByText(/Se o saldo ficar negativo, o item fica marcado como déficit/),
    ).toBeInTheDocument()
  })
})

describe('InventoryView', () => {
  it('gives both movement-kind radios a visible focus-visible ring', async () => {
    const beer = makeItem({ stockQuantity: 10 })
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), items: [beer] },
    )
    renderInventory(repository)

    await screen.findByText('10', { exact: true })

    const entryRadio = screen.getByRole('radio', { name: 'Entrada' })
    const adjustmentRadio = screen.getByRole('radio', { name: 'Ajuste' })

    for (const radio of [entryRadio, adjustmentRadio]) {
      expect(radio.className).toContain('focus-visible:outline')
      expect(radio.className).toContain('focus-visible:outline-2')
      expect(radio.className).toContain('focus-visible:outline-offset-2')
      expect(radio.className).toContain('focus-visible:outline-accent')
    }
  })

  it('registers an entry and increases the displayed current stock', async () => {
    const beer = makeItem({ stockQuantity: 10 })
    const { repository } = createStatefulRepository([beer])
    const user = userEvent.setup()
    renderInventory(repository)

    await screen.findByText('10', { exact: true })

    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Item' }), beer.id)
    await user.type(screen.getByRole('textbox', { name: 'Quantidade' }), '5')
    await user.click(screen.getByRole('button', { name: 'Registrar movimentação' }))

    await waitFor(() => expect(screen.getByText('15', { exact: true })).toBeInTheDocument())
    expect(screen.queryByText('10', { exact: true })).not.toBeInTheDocument()
  })

  it('registers a negative adjustment and decreases the displayed current stock', async () => {
    const beer = makeItem({ stockQuantity: 10 })
    const { repository } = createStatefulRepository([beer])
    const user = userEvent.setup()
    renderInventory(repository)

    await screen.findByText('10', { exact: true })

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Item' }), beer.id)
    await user.type(screen.getByRole('textbox', { name: 'Quantidade' }), '-4')
    await user.click(screen.getByRole('button', { name: 'Registrar movimentação' }))

    await waitFor(() => expect(screen.getByText('6', { exact: true })).toBeInTheDocument())
  })

  it('shows the repository error message without breaking the screen', async () => {
    const beer = makeItem({ stockQuantity: 10 })
    const repository = createFakeBarRepository(
      {
        addStockMovement: vi.fn(async () => {
          throw new Error('Item does not track stock')
        }),
      },
      { ...createDemoDatabase(), items: [beer] },
    )
    const user = userEvent.setup()
    renderInventory(repository)

    await screen.findByText('10', { exact: true })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Item' }), beer.id)
    await user.type(screen.getByRole('textbox', { name: 'Quantidade' }), '5')
    await user.click(screen.getByRole('button', { name: 'Registrar movimentação' }))

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByText('Este item não possui controle de estoque.'),
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Registrar movimentação' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Item' })).toBeInTheDocument()
  })

  it('prevents submission and shows a validation message for an invalid quantity', async () => {
    const beer = makeItem({ stockQuantity: 10 })
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), items: [beer] },
    )
    const user = userEvent.setup()
    renderInventory(repository)

    await screen.findByText('10', { exact: true })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Item' }), beer.id)
    await user.type(screen.getByRole('textbox', { name: 'Quantidade' }), '0')
    await user.click(screen.getByRole('button', { name: 'Registrar movimentação' }))

    expect(
      await screen.findByText('A quantidade de entrada deve ser maior que zero.'),
    ).toBeInTheDocument()
    expect(repository.addStockMovement).not.toHaveBeenCalled()
  })

  it('prevents submission and shows a validation message when no item is selected', async () => {
    const beer = makeItem({ stockQuantity: 10 })
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), items: [beer] },
    )
    const user = userEvent.setup()
    renderInventory(repository)

    await screen.findByText('10', { exact: true })

    await user.type(screen.getByRole('textbox', { name: 'Quantidade' }), '5')
    await user.click(screen.getByRole('button', { name: 'Registrar movimentação' }))

    expect(await screen.findByText('Selecione um item.')).toBeInTheDocument()
    expect(repository.addStockMovement).not.toHaveBeenCalled()
  })

  it('shows the movement history with kind, date, item, delta and responsible', async () => {
    const beer = makeItem({ stockQuantity: 10 })
    const movement: StockMovement = {
      id: 'movement-1',
      itemId: beer.id,
      kind: STOCK_MOVEMENT_KIND.ENTRY,
      quantityDelta: 45,
      occurredAt: '2026-09-01T10:00:00.000Z',
      actorId: CURRENT_ACTOR_ID,
    }
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), items: [beer], stockMovements: [movement] },
    )
    renderInventory(repository)

    const historyTable = await screen.findByRole('table', { name: 'Histórico de movimentações' })
    const row = within(historyTable).getByRole('row', { name: /Cerveja lata/ })
    expect(within(row).getByText('Entrada')).toBeInTheDocument()
    expect(within(row).getByText(formatDateTime(movement.occurredAt))).toBeInTheDocument()
    expect(within(row).getByText('+45')).toBeInTheDocument()
    expect(within(row).getByText(CURRENT_ACTOR_NAME)).toBeInTheDocument()
  })

  it('does not mark an item without stock tracking as critical, and marks one at the threshold as critical', async () => {
    const untracked = makeItem({ id: 'item-untracked', name: 'Camiseta', stockQuantity: undefined })
    const critical = makeItem({ id: 'item-critical', name: 'Espetinho', stockQuantity: LOW_STOCK_THRESHOLD })
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), items: [untracked, critical] },
    )
    renderInventory(repository)

    const stockPanel = await screen.findByRole('table', { name: 'Estoque atual' })
    expect(within(stockPanel).getByText('Espetinho')).toBeInTheDocument()
    expect(
      within(stockPanel).getByText(`${LOW_STOCK_THRESHOLD} (estoque crítico)`),
    ).toBeInTheDocument()
    expect(screen.queryByText('Camiseta')).not.toBeInTheDocument()
  })
})
