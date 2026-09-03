import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LOW_STOCK_THRESHOLD } from '../../application/constants'
import type { Item } from '../../domain/entities'
import { StockStatusBadge } from './StockStatusBadge'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    name: 'Cerveja lata',
    unitCostCents: 350,
    unitPriceCents: 700,
    ...overrides,
  }
}

describe('StockStatusBadge', () => {
  it('shows "Não controlado" for an item without stock tracking, never zero', () => {
    render(<StockStatusBadge item={makeItem({ stockQuantity: undefined })} />)

    expect(screen.getByText('Não controlado')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('highlights an item at the low-stock threshold with the critical label', () => {
    render(<StockStatusBadge item={makeItem({ stockQuantity: LOW_STOCK_THRESHOLD })} />)

    const badge = screen.getByText(`${LOW_STOCK_THRESHOLD} (estoque crítico)`)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('text-warning')
  })

  it('does not mark an item above the threshold as critical', () => {
    render(<StockStatusBadge item={makeItem({ stockQuantity: LOW_STOCK_THRESHOLD + 10 })} />)

    const badge = screen.getByText(`${LOW_STOCK_THRESHOLD + 10}`)
    expect(badge.className).not.toContain('text-warning')
  })
})
