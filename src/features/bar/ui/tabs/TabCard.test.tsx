import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TabSummary } from '../../application/tab-summary'
import {
  CONSUMER_KIND,
  PAYMENT_STATUS,
  TAB_KIND,
  TAB_STATUS,
} from '../../domain/constants'
import { TabCard } from './TabCard'

function makeSummary(overrides: Partial<TabSummary> = {}): TabSummary {
  return {
    tab: {
      id: 'tab-rafael', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
      eventId: 'event-encontro', visitorId: 'visitor-rafael',
      openedAt: '2026-09-19T18:20:00.000Z',
    },
    consumer: { id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR },
    lines: [
      { itemId: 'item-cerveja', itemName: 'Cerveja lata', quantity: 2, unitPriceCents: 700, subtotalCents: 1400 },
      { itemId: 'item-agua', itemName: 'Água mineral', quantity: 1, unitPriceCents: 400, subtotalCents: 400 },
    ],
    courtesyLines: [],
    totalCents: 1800,
    payment: { paidCents: 900, remainingCents: 900, status: PAYMENT_STATUS.PARTIAL },
    ...overrides,
  } as TabSummary
}

describe('TabCard', () => {
  it('shows the consumer, total, tab status and payment status', () => {
    render(
      <TabCard
        summary={makeSummary()}
        eventActive
        onClose={vi.fn()}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
      />,
    )

    expect(screen.getByText('Rafael Oliveira')).toBeInTheDocument()
    expect(screen.getByText('R$ 18,00')).toBeInTheDocument()
    expect(screen.getByText('Aberta')).toBeInTheDocument()
    expect(screen.getByText('Parcial')).toBeInTheDocument()
  })

  it('always shows the lines of the tab, charged and courtesy', () => {
    render(
      <TabCard
        summary={makeSummary({
          courtesyLines: [
            { itemId: 'item-refri', itemName: 'Refrigerante', quantity: 1, unitPriceCents: 600, subtotalCents: 600 },
          ],
        })}
        eventActive
        onClose={vi.fn()}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
      />,
    )

    expect(screen.getByText(/Cerveja lata/)).toBeInTheDocument()
    expect(screen.getByText(/Água mineral/)).toBeInTheDocument()
    expect(screen.getByText(/Refrigerante/)).toBeInTheDocument()
  })

  it('requires an explicit confirmation before closing an open tab', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <TabCard
        summary={makeSummary()}
        eventActive
        onClose={onClose}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Fechar comanda' }))
    expect(onClose).not.toHaveBeenCalled()

    expect(screen.getByText(/total registrado é R\$ 18,00/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirmar fechamento' }))
    expect(onClose).toHaveBeenCalledWith('tab-rafael')
  })

  it('cancels the close confirmation without calling onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <TabCard
        summary={makeSummary()}
        eventActive
        onClose={onClose}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Fechar comanda' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Fechar comanda' })).toBeInTheDocument()
  })

  it('requires an explicit confirmation before reopening a closed tab of an active event', async () => {
    const onReopen = vi.fn()
    const user = userEvent.setup()
    render(
      <TabCard
        summary={makeSummary({ tab: { ...makeSummary().tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-19T22:00:00.000Z' } })}
        eventActive
        onClose={vi.fn()}
        onReopen={onReopen}
        isClosePending={false}
        isReopenPending={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Reabrir comanda' }))
    expect(onReopen).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirmar reabertura' }))
    expect(onReopen).toHaveBeenCalledWith('tab-rafael')
  })

  it('does not offer reopening a closed tab whose event is no longer active', () => {
    render(
      <TabCard
        summary={makeSummary({ tab: { ...makeSummary().tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-19T22:00:00.000Z' } })}
        eventActive={false}
        onClose={vi.fn()}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Reabrir comanda' })).not.toBeInTheDocument()
    expect(screen.getByText(/evento.*encerrad/i)).toBeInTheDocument()
  })

  it('shows the close error message without breaking the screen', async () => {
    const user = userEvent.setup()
    render(
      <TabCard
        summary={makeSummary()}
        eventActive
        onClose={vi.fn()}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
        closeErrorMessage="Só é possível fechar ou reabrir comandas de um evento ativo."
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Fechar comanda' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Só é possível fechar ou reabrir comandas de um evento ativo.')
    expect(screen.getByRole('button', { name: 'Confirmar fechamento' })).toBeInTheDocument()
  })

  it('notifies the parent when opening the close confirmation, so a stale error can be cleared', async () => {
    const onStartClose = vi.fn()
    const user = userEvent.setup()
    render(
      <TabCard
        summary={makeSummary()}
        eventActive
        onClose={vi.fn()}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
        onStartClose={onStartClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Fechar comanda' }))
    expect(onStartClose).toHaveBeenCalledTimes(1)
  })

  it('notifies the parent when opening the reopen confirmation, so a stale error can be cleared', async () => {
    const onStartReopen = vi.fn()
    const user = userEvent.setup()
    render(
      <TabCard
        summary={makeSummary({ tab: { ...makeSummary().tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-19T22:00:00.000Z' } })}
        eventActive
        onClose={vi.fn()}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
        onStartReopen={onStartReopen}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Reabrir comanda' }))
    expect(onStartReopen).toHaveBeenCalledTimes(1)
  })
})

describe('TabCard with nothing to charge', () => {
  it('does not bill a courtesy-only tab as unpaid', () => {
    // The seed's Juliana tab: one courtesy, R$ 0,00 due. /pagamentos rightly
    // does not list it, so /comandas must not show it in red as a debt.
    render(
      <TabCard
        summary={makeSummary({
          lines: [],
          courtesyLines: [
            { itemId: 'item-agua', itemName: 'Água mineral', quantity: 1, unitPriceCents: 400, subtotalCents: 400 },
          ],
          totalCents: 0,
          payment: { paidCents: 0, remainingCents: 0, status: PAYMENT_STATUS.UNPAID },
        })}
        eventActive
        onClose={vi.fn()}
        onReopen={vi.fn()}
        isClosePending={false}
        isReopenPending={false}
      />,
    )

    expect(screen.getByText('Sem valor a cobrar')).toBeInTheDocument()
    expect(screen.queryByText('Não pago')).not.toBeInTheDocument()
  })
})
