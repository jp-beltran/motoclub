import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { LancamentosPage } from '../../../../pages/LancamentosPage'
import { renderWithBar } from '../../../../test/render-with-bar'
import type { BarDatabase, StorageLike } from '../../application/bar-repository'
import { CONSUMPTION_STATUS } from '../../domain/constants'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { LocalBarRepository } from '../../infrastructure/local-bar-repository'

/**
 * The real repository over in-memory storage: these tests have to prove that a
 * tap actually persists a consumption, which a stub could only pretend to do.
 */
function createRepository(database: BarDatabase = createDemoDatabase()) {
  const values = new Map<string, string>([
    ['launch-test', JSON.stringify({ version: 1, data: database })],
  ])
  const storage: StorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
  let id = 0
  return new LocalBarRepository({
    storage,
    storageKey: 'launch-test',
    nextId: () => `test-${++id}`,
    now: () => new Date().toISOString(),
  })
}

/** Only ids this test's repository minted, so the demo seed never counts. */
function launchedConsumptions(snapshot: BarDatabase) {
  return snapshot.consumptions.filter(
    ({ id, status }) => id.startsWith('test-') && status === CONSUMPTION_STATUS.ACTIVE,
  )
}

function setupCountingUser() {
  const user = userEvent.setup()
  const counter = { clicks: 0 }
  return {
    counter,
    click: async (element: HTMLElement) => {
      counter.clicks += 1
      await user.click(element)
    },
    user,
  }
}

describe('LaunchScreen speed acceptance (global constraint 13)', () => {
  it('registers the first consumption in two clicks and each next one in one', async () => {
    const repository = createRepository()
    const { counter, click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    // Click 1 of 2: pick the consumer.
    await click(await screen.findByRole('button', { name: /Ana Paula/ }))
    // Click 2 of 2: tap the item. No confirmation step in between.
    await click(await screen.findByRole('button', { name: 'Lançar Cerveja lata' }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
    expect(counter.clicks).toBe(2)

    // Click 3: one single tap registers the next consumption.
    await click(screen.getByRole('button', { name: 'Lançar Espetinho' }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(2)
    })
    expect(counter.clicks).toBe(3)

    // Click 4: tapping the same item again still costs one click.
    await click(screen.getByRole('button', { name: 'Lançar Espetinho' }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(3)
    })
    expect(counter.clicks).toBe(4)

    const snapshot = await repository.getSnapshot()
    expect(launchedConsumptions(snapshot).map(({ itemId, quantity, chargeKind }) => ({
      itemId, quantity, chargeKind,
    }))).toEqual([
      { itemId: 'item-cerveja', quantity: 1, chargeKind: 'charged' },
      { itemId: 'item-espetinho', quantity: 1, chargeKind: 'charged' },
      { itemId: 'item-espetinho', quantity: 1, chargeKind: 'charged' },
    ])
    expect(launchedConsumptions(snapshot).every(
      ({ consumerId }) => consumerId === 'member-ana',
    )).toBe(true)
  })

  it('keeps the consumer selected across launches instead of returning to step 1', async () => {
    const repository = createRepository()
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Rafael Oliveira/ }))
    await click(await screen.findByRole('button', { name: 'Lançar Água mineral' }))
    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })

    expect(screen.getByRole('button', { name: 'Lançar Água mineral' })).toBeInTheDocument()
    expect(screen.getByText('Rafael Oliveira')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ana Paula/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trocar consumidor' })).toBeInTheDocument()
  })
})
