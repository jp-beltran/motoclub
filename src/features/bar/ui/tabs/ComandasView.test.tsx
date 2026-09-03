import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithBar } from '../../../../test/render-with-bar'
import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import type { StorageLike } from '../../application/bar-repository'
import { LocalBarRepository } from '../../infrastructure/local-bar-repository'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { CONSUMER_KIND, EVENT_STATUS, TAB_KIND, TAB_STATUS } from '../../domain/constants'
import { ComandasView } from './ComandasView'

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
    storageKey: 'test-comandas',
    nextId: () => `id-${++id}`,
    now: () => '2026-09-19T21:30:00.000Z',
  })
}

describe('ComandasView', () => {
  it('lists event tabs grouped by event, with total and payment status', async () => {
    renderWithBar(<ComandasView />)

    const heading = await screen.findByRole('heading', { name: 'Encontro de setembro' })
    const section = heading.closest('section')
    expect(section).not.toBeNull()

    expect(within(section as HTMLElement).getByText('Rafael Oliveira')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText('Juliana Costa')).toBeInTheDocument()
    // Rafael: 2x refrigerante at 600 cents = 1200, partially paid 700 -> Parcial
    expect(within(section as HTMLElement).getAllByText('R$ 12,00').length).toBeGreaterThan(0)
    expect(within(section as HTMLElement).getByText('Parcial')).toBeInTheDocument()
  })

  it('shows an empty state when there is no event tab at all', async () => {
    const repository = createFakeBarRepository(
      {},
      { ...createDemoDatabase(), tabs: [], consumptions: [], payments: [] },
    )
    renderWithBar(<ComandasView />, { repository })

    expect(await screen.findByText(/Nenhuma comanda/)).toBeInTheDocument()
  })

  it('closing a tab preserves its summary and updates the status to closed', async () => {
    const repository = createRealRepository()
    const user = userEvent.setup()
    renderWithBar(<ComandasView />, { repository })

    const heading = await screen.findByRole('heading', { name: 'Encontro de setembro' })
    const section = heading.closest('section') as HTMLElement
    const rafaelCard = within(section).getByText('Rafael Oliveira').closest('div.rounded-lg') as HTMLElement
    const readTotal = () => rafaelCard.querySelector('p.text-lg')?.textContent

    expect(readTotal()).toBe('R$ 12,00')

    await user.click(within(rafaelCard).getByRole('button', { name: 'Fechar comanda' }))
    await user.click(within(rafaelCard).getByRole('button', { name: 'Confirmar fechamento' }))

    await waitFor(() => expect(within(rafaelCard).getByText('Fechada')).toBeInTheDocument())
    // The summary (total) is preserved after closing.
    expect(readTotal()).toBe('R$ 12,00')
  })

  it('requires an explicit confirmation before reopening, and only calls the repository after it', async () => {
    const repository = createRealRepository()
    await repository.closeVisitorTab('tab-rafael-evento')
    const reopenSpy = vi.spyOn(repository, 'reopenVisitorTab')
    const user = userEvent.setup()
    renderWithBar(<ComandasView />, { repository })

    const heading = await screen.findByRole('heading', { name: 'Encontro de setembro' })
    const section = heading.closest('section') as HTMLElement
    const rafaelCard = within(section).getByText('Rafael Oliveira').closest('div.rounded-lg') as HTMLElement

    await user.click(within(rafaelCard).getByRole('button', { name: 'Reabrir comanda' }))
    expect(reopenSpy).not.toHaveBeenCalled()

    await user.click(within(rafaelCard).getByRole('button', { name: 'Confirmar reabertura' }))
    await waitFor(() => expect(reopenSpy).toHaveBeenCalledWith('tab-rafael-evento'))
    await waitFor(() => expect(within(rafaelCard).getByText('Aberta')).toBeInTheDocument())
  })

  it('maps a repository rejection to a pt-BR message without breaking the screen', async () => {
    const repository = createFakeBarRepository(
      {
        closeVisitorTab: vi.fn(async () => {
          throw new Error('Event must be active')
        }),
      },
      createDemoDatabase(),
    )
    const user = userEvent.setup()
    renderWithBar(<ComandasView />, { repository })

    const heading = await screen.findByRole('heading', { name: 'Encontro de setembro' })
    const section = heading.closest('section') as HTMLElement
    const rafaelCard = within(section).getByText('Rafael Oliveira').closest('div.rounded-lg') as HTMLElement

    await user.click(within(rafaelCard).getByRole('button', { name: 'Fechar comanda' }))
    await user.click(within(rafaelCard).getByRole('button', { name: 'Confirmar fechamento' }))

    const alert = await within(rafaelCard).findByRole('alert')
    expect(alert).toHaveTextContent('Só é possível fechar ou reabrir comandas de um evento ativo.')
  })

  it('clears a stale close error when the confirmation is reopened, before any new attempt', async () => {
    const repository = createFakeBarRepository(
      {
        closeVisitorTab: vi.fn(async () => {
          throw new Error('Event must be active')
        }),
      },
      createDemoDatabase(),
    )
    const user = userEvent.setup()
    renderWithBar(<ComandasView />, { repository })

    const heading = await screen.findByRole('heading', { name: 'Encontro de setembro' })
    const section = heading.closest('section') as HTMLElement
    const rafaelCard = within(section).getByText('Rafael Oliveira').closest('div.rounded-lg') as HTMLElement

    await user.click(within(rafaelCard).getByRole('button', { name: 'Fechar comanda' }))
    await user.click(within(rafaelCard).getByRole('button', { name: 'Confirmar fechamento' }))
    await within(rafaelCard).findByRole('alert')

    await user.click(within(rafaelCard).getByRole('button', { name: 'Cancelar' }))
    await user.click(within(rafaelCard).getByRole('button', { name: 'Fechar comanda' }))

    // The old error must not reappear before the operator has retried anything.
    expect(within(rafaelCard).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the payment badge for its state right after closing a partially paid tab', async () => {
    const repository = createRealRepository()
    const user = userEvent.setup()
    renderWithBar(<ComandasView />, { repository })

    const heading = await screen.findByRole('heading', { name: 'Encontro de setembro' })
    const section = heading.closest('section') as HTMLElement
    const rafaelCard = within(section).getByText('Rafael Oliveira').closest('div.rounded-lg') as HTMLElement

    // tab-rafael-evento: total 1200, already paid 700 -> Parcial, before closing.
    expect(within(rafaelCard).getByText('Parcial')).toBeInTheDocument()

    await user.click(within(rafaelCard).getByRole('button', { name: 'Fechar comanda' }))
    await user.click(within(rafaelCard).getByRole('button', { name: 'Confirmar fechamento' }))

    await waitFor(() => expect(within(rafaelCard).getByText('Fechada')).toBeInTheDocument())
    // Closing never settles the debt — the payment badge must still say Parcial.
    expect(within(rafaelCard).getByText('Parcial')).toBeInTheDocument()
    expect(within(rafaelCard).getByText('Saldo em aberto: R$ 5,00')).toBeInTheDocument()
  })

  it('does not offer a reopen action for a closed tab whose event is no longer active', async () => {
    const database = createDemoDatabase()
    database.consumers.push({
      id: 'visitor-carlos', name: 'Carlos Souza', kind: CONSUMER_KIND.VISITOR, active: true,
    })
    database.events.push({
      id: 'event-antigo', name: 'Evento antigo', startsAt: '2026-08-01T18:00:00.000Z',
      status: EVENT_STATUS.CLOSED,
    })
    database.tabs.push({
      id: 'tab-carlos', kind: TAB_KIND.EVENT, status: TAB_STATUS.CLOSED,
      eventId: 'event-antigo', visitorId: 'visitor-carlos',
      openedAt: '2026-08-01T18:10:00.000Z', closedAt: '2026-08-01T22:00:00.000Z',
    })
    const repository = createFakeBarRepository({}, database)
    renderWithBar(<ComandasView />, { repository })

    const heading = await screen.findByRole('heading', { name: 'Evento antigo' })
    const section = heading.closest('section') as HTMLElement
    expect(within(section).queryByRole('button', { name: 'Reabrir comanda' })).not.toBeInTheDocument()
    expect(within(section).getByText(/evento.*encerrad/i)).toBeInTheDocument()
  })
})
