import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithBar } from '../../../../test/render-with-bar'
import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { CURRENT_ACTOR_ID } from '../../application/actor'
import { getCurrentMonth } from '../../../../shared/date'
import type { StorageLike } from '../../application/bar-repository'
import { summarizeTab } from '../../application/tab-summary'
import { PAYMENT_STATUS, PAYMENT_TARGET } from '../../domain/constants'
import { LocalBarRepository } from '../../infrastructure/local-bar-repository'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { PagamentosView } from './PagamentosView'

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function createRealRepository() {
  let id = 0
  return new LocalBarRepository({
    storage: new MemoryStorage(),
    storageKey: 'test-pagamentos',
    nextId: () => `id-${++id}`,
    now: () => new Date().toISOString(),
  })
}

describe('PagamentosView', () => {
  it('lists pending targets from the snapshot', async () => {
    renderWithBar(<PagamentosView />)

    // tab-rafael-evento: 2x refrigerante (600) = 1200, paid 700 -> remaining 500.
    expect(await screen.findByText(/Rafael Oliveira/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is pending', async () => {
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), tabs: [], consumptions: [], payments: [], memberStatements: [] },
    )
    renderWithBar(<PagamentosView />, { repository })
    expect(await screen.findByText(/Nenhuma pendência/)).toBeInTheDocument()
  })

  it('discloses that current-month member debt only appears here after the monthly closing, and links to /fechamento', async () => {
    renderWithBar(<PagamentosView />)
    await screen.findByText(/Rafael Oliveira/)

    expect(screen.getAllByText(/fechamento mensal/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /fechamento/i })).toHaveAttribute('href', '/fechamento')
  })

  it('shows the same disclosure even when the pending list is empty, not just when it has rows', async () => {
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), tabs: [], consumptions: [], payments: [], memberStatements: [] },
    )
    renderWithBar(<PagamentosView />, { repository })
    await screen.findByText(/Nenhuma pendência/)

    expect(screen.getAllByText(/fechamento mensal/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /fechamento/i })).toHaveAttribute('href', '/fechamento')
  })

  it('records a partial payment on an event tab and leaves it partial with the right remaining balance', async () => {
    const repository = createRealRepository()
    const user = userEvent.setup()
    renderWithBar(<PagamentosView />, { repository })

    const row = await screen.findByText(/Rafael Oliveira/)
    const card = row.closest('div.rounded-lg') as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'Registrar pagamento' }))
    await user.type(within(card).getByRole('textbox', { name: 'Valor do pagamento' }), '2,00')
    await user.click(within(card).getByRole('button', { name: 'Confirmar pagamento' }))

    await waitFor(async () => {
      const snapshot = await repository.getSnapshot()
      const summary = summarizeTab(snapshot, 'tab-rafael-evento')
      expect(summary?.payment.remainingCents).toBe(300)
      expect(summary?.payment.status).toBe(PAYMENT_STATUS.PARTIAL)
    })
  })

  it('records a full payment on an event tab, settling it to paid and dropping it from the pending list', async () => {
    const repository = createRealRepository()
    const user = userEvent.setup()
    renderWithBar(<PagamentosView />, { repository })

    const row = await screen.findByText(/Rafael Oliveira/)
    const card = row.closest('div.rounded-lg') as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'Registrar pagamento' }))
    await user.type(within(card).getByRole('textbox', { name: 'Valor do pagamento' }), '5,00')
    await user.click(within(card).getByRole('button', { name: 'Confirmar pagamento' }))

    await waitFor(() => expect(screen.queryByText(/Rafael Oliveira/)).not.toBeInTheDocument())

    const snapshot = await repository.getSnapshot()
    const summary = summarizeTab(snapshot, 'tab-rafael-evento')
    expect(summary?.payment.remainingCents).toBe(0)
    expect(summary?.payment.status).toBe(PAYMENT_STATUS.PAID)
  })

  it('records a payment against a member statement, target "statement"', async () => {
    const repository = createRealRepository()
    // member-ana has a September consumption (cons-ana-cerveja); closing the
    // month turns it into a real member statement to pay against.
    await repository.createMonthlyClosing({ month: getCurrentMonth(), actorId: CURRENT_ACTOR_ID })
    const recordPaymentSpy = vi.spyOn(repository, 'recordPayment')
    const user = userEvent.setup()
    renderWithBar(<PagamentosView />, { repository })

    const row = await screen.findByText(/Ana Paula/)
    const card = row.closest('div.rounded-lg') as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'Registrar pagamento' }))
    await user.type(within(card).getByRole('textbox', { name: 'Valor do pagamento' }), '21,00')
    await user.click(within(card).getByRole('button', { name: 'Confirmar pagamento' }))

    await waitFor(() =>
      expect(recordPaymentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ target: PAYMENT_TARGET.STATEMENT, amountCents: 2100 }),
      ),
    )
  })

  it('maps an excessive-payment rejection from the repository to a pt-BR message without breaking the screen', async () => {
    const repository = createFakeBarRepository(
      {
        recordPayment: vi.fn(async () => {
          throw new Error('Payment cannot exceed the amount due')
        }),
      },
      createDemoDatabase(),
    )
    const user = userEvent.setup()
    renderWithBar(<PagamentosView />, { repository })

    const row = await screen.findByText(/Rafael Oliveira/)
    const card = row.closest('div.rounded-lg') as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'Registrar pagamento' }))
    await user.type(within(card).getByRole('textbox', { name: 'Valor do pagamento' }), '5,00')
    await user.click(within(card).getByRole('button', { name: 'Confirmar pagamento' }))

    const alert = await within(card).findByRole('alert')
    expect(alert).toHaveTextContent('O valor informado é maior do que o saldo em aberto.')
    expect(within(card).getByRole('button', { name: 'Confirmar pagamento' })).toBeInTheDocument()
  })
})
