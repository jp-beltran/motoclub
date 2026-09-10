import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { renderWithBar } from '../../../../test/render-with-bar'
import type { BarDatabase, StorageLike } from '../../application/bar-repository'
import { EVENT_STATUS } from '../../domain/constants'
import type { Event } from '../../domain/entities'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { LocalBarRepository } from '../../infrastructure/local-bar-repository'
import { ActiveEventCard } from './ActiveEventCard'

const RUNNING: Event = {
  id: 'event-encontro',
  name: 'Encontro de setembro',
  startsAt: '2026-09-19T18:00:00.000Z',
  status: EVENT_STATUS.ACTIVE,
}

/** The seed with its own event closed, so the card has none to show. */
function databaseWithoutActiveEvent(): BarDatabase {
  const database = createDemoDatabase()
  return {
    ...database,
    events: database.events.map((event) => ({ ...event, status: EVENT_STATUS.CLOSED })),
  }
}

function createPersistentRepository(database: BarDatabase) {
  const values = new Map<string, string>([
    ['event-card-test', JSON.stringify({ version: 1, data: database })],
  ])
  const storage: StorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
  let id = 0
  return new LocalBarRepository({
    storage,
    storageKey: 'event-card-test',
    nextId: () => `test-${++id}`,
    now: () => new Date().toISOString(),
  })
}

describe('ActiveEventCard', () => {
  it('names the running event and offers no form while it runs', () => {
    renderWithBar(<ActiveEventCard event={RUNNING} />)

    const card = screen.getByRole('region', { name: 'Evento ativo' })
    expect(within(card).getByText('Encontro de setembro')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Abrir evento' })).not.toBeInTheDocument()
  })

  it('opens the event the operator names when none is running', async () => {
    const selectOrCreateActiveEvent = vi.fn(async () => RUNNING)
    const user = userEvent.setup()
    renderWithBar(<ActiveEventCard />, {
      repository: createFakeBarRepository({ selectOrCreateActiveEvent }),
    })

    const form = screen.getByRole('form', { name: 'Abrir evento' })
    await user.type(within(form).getByLabelText('Nome do evento'), 'Passeio de domingo')
    await user.click(within(form).getByRole('button', { name: 'Abrir evento' }))

    await waitFor(() => {
      expect(selectOrCreateActiveEvent).toHaveBeenCalledWith({ name: 'Passeio de domingo' })
    })
  })

  it('shows the domain refusal for an empty event name, with no rule of its own', async () => {
    const user = userEvent.setup()
    renderWithBar(<ActiveEventCard />, {
      repository: createPersistentRepository(databaseWithoutActiveEvent()),
    })

    const form = screen.getByRole('form', { name: 'Abrir evento' })
    await user.type(within(form).getByLabelText('Nome do evento'), '   ')
    await user.click(within(form).getByRole('button', { name: 'Abrir evento' }))

    expect(await within(form).findByRole('alert'))
      .toHaveTextContent('Informe o nome do evento.')
  })

  it('explains why a visitor cannot consume while no event is running', () => {
    renderWithBar(<ActiveEventCard />)

    expect(screen.getByText('Nenhum evento ativo')).toBeInTheDocument()
    expect(screen.getByText(/Visitantes só recebem consumo durante um evento/))
      .toBeInTheDocument()
  })
})
