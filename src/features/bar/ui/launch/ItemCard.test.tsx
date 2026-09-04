import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LOW_STOCK_THRESHOLD } from '../../application/constants'
import { CHARGE_KIND } from '../../domain/constants'
import type { Item } from '../../domain/entities'
import { ItemCard } from './ItemCard'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-cerveja',
    name: 'Cerveja lata',
    unitCostCents: 350,
    unitPriceCents: 700,
    ...overrides,
  }
}

function renderCard(item: Item) {
  const onLaunch = vi.fn()
  render(<ItemCard item={item} onLaunch={onLaunch} />)
  return { onLaunch }
}

function stockHint(): HTMLElement {
  return screen.getByText(/Estoque/)
}

describe('ItemCard stock hint', () => {
  it('says nothing about a level for an item that does not track stock', () => {
    renderCard(makeItem({ stockQuantity: undefined }))

    expect(screen.getByText('Estoque não controlado')).toBeInTheDocument()
  })

  it('warns at exactly the low-stock threshold, like the stock screen does', () => {
    // The threshold is inclusive everywhere else (stock-status.ts,
    // dashboard-summary.ts). An item sitting on it used to render as neutral
    // text here — on the one screen where the operator is about to sell it.
    renderCard(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD }))

    const hint = stockHint()
    expect(hint).toHaveTextContent(`Estoque estimado: ${LOW_STOCK_THRESHOLD} · estoque baixo`)
    expect(hint.className).toContain('text-warning')
  })

  it('warns below the threshold', () => {
    renderCard(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD - 1 }))

    expect(stockHint()).toHaveTextContent('· estoque baixo')
  })

  it('stays neutral above the threshold', () => {
    renderCard(makeItem({ stockQuantity: LOW_STOCK_THRESHOLD + 1 }))

    const hint = stockHint()
    expect(hint).not.toHaveTextContent('estoque baixo')
    expect(hint.className).toContain('text-content-muted')
  })

  it('shows a negative balance as a deficit needing adjustment, not as "baixo"', () => {
    renderCard(makeItem({ stockQuantity: -7 }))

    const hint = stockHint()
    expect(hint).toHaveTextContent('Estoque estimado: -7 · déficit, ajuste o estoque')
    expect(hint).not.toHaveTextContent('estoque baixo')
    expect(hint.className).toContain('text-accent')
  })

  it('keeps the launch available while stock is in deficit', async () => {
    // The plan requires the shortage warning to show "sem bloquear o registro".
    const { onLaunch } = renderCard(makeItem({ stockQuantity: -7 }))

    await userEvent.click(screen.getByRole('button', { name: 'Lançar Cerveja lata' }))

    expect(onLaunch).toHaveBeenCalledWith(1, CHARGE_KIND.CHARGED)
  })
})
