import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { Item } from '../../domain/entities'
import { LowStockItemsCard } from './LowStockItemsCard'

function buildItem(overrides: Partial<Item> & { id: string; name: string }): Item {
  return {
    unitCostCents: 100,
    unitPriceCents: 200,
    ...overrides,
  } as Item
}

describe('LowStockItemsCard', () => {
  it('lists each critical item with its remaining quantity and a link to the estoque area', () => {
    const items = [
      buildItem({ id: 'item-camiseta', name: 'Camiseta do motoclube', stockQuantity: 5 }),
      buildItem({ id: 'item-porcao', name: 'Porção de fritas', stockQuantity: 2 }),
    ]

    render(
      <MemoryRouter>
        <LowStockItemsCard items={items} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Itens em estoque crítico')).toBeInTheDocument()
    expect(screen.getByText('Camiseta do motoclube')).toBeInTheDocument()
    expect(screen.getByText('Porção de fritas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver estoque/i })).toHaveAttribute('href', '/estoque')
  })

  it('renders a coherent empty state when no item is critical', () => {
    render(
      <MemoryRouter>
        <LowStockItemsCard items={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Nenhum item em estoque crítico')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver estoque/i })).toHaveAttribute('href', '/estoque')
  })
})
