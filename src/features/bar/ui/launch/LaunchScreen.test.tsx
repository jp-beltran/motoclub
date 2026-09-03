import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { LancamentosPage } from '../../../../pages/LancamentosPage'
import { getCurrentMonth } from '../../../../shared/date'
import { renderWithBar } from '../../../../test/render-with-bar'
import type { BarDatabase, StorageLike } from '../../application/bar-repository'
import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  EVENT_STATUS,
  TAB_KIND,
  TAB_STATUS,
} from '../../domain/constants'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { LocalBarRepository } from '../../infrastructure/local-bar-repository'

/**
 * The seed's monthly tabs are stamped 2026-09. Restamping them with the month
 * the screen actually asks for keeps every member assertion true whenever the
 * suite runs, instead of only during September 2026.
 */
function currentMonthDemo(): BarDatabase {
  const database = createDemoDatabase()
  return {
    ...database,
    tabs: database.tabs.map((tab) =>
      tab.kind === TAB_KIND.MONTHLY ? { ...tab, month: getCurrentMonth() } : tab,
    ),
  }
}

/**
 * The real repository over in-memory storage: these tests have to prove that a
 * tap actually persists a consumption, which a stub could only pretend to do.
 */
function createRepository(database: BarDatabase = currentMonthDemo()) {
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

describe('LaunchScreen registration feedback', () => {
  it('confirms the launch with the item and undoes exactly that consumption', async () => {
    const repository = createRepository()
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Ana Paula/ }))
    await click(await screen.findByRole('button', { name: 'Lançar Cerveja lata' }))
    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
    await click(screen.getByRole('button', { name: 'Lançar Espetinho' }))
    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(2)
    })

    expect(screen.getByRole('status')).toHaveTextContent('1× Espetinho para Ana Paula')

    await click(screen.getByRole('button', { name: 'Desfazer' }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
    const snapshot = await repository.getSnapshot()
    expect(snapshot.consumptions.filter(({ id }) => id.startsWith('test-')).map(
      ({ itemId, status }) => ({ itemId, status }),
    )).toEqual([
      { itemId: 'item-cerveja', status: CONSUMPTION_STATUS.ACTIVE },
      { itemId: 'item-espetinho', status: CONSUMPTION_STATUS.CANCELLED },
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Lançamento desfeito.')
    expect(screen.queryByRole('button', { name: 'Desfazer' })).not.toBeInTheDocument()
  })

  it('warns about insufficient stock without blocking the launch', async () => {
    const database = currentMonthDemo()
    const repository = createRepository({
      ...database,
      items: database.items.map((item) =>
        item.id === 'item-camiseta' ? { ...item, stockQuantity: 0 } : item,
      ),
    })
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Ana Paula/ }))
    await click(await screen.findByRole('button', { name: 'Lançar Camiseta do motoclube' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Estoque insuficiente para este item. O lançamento foi registrado',
      )
    })
    expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('1× Camiseta do motoclube')
  })
})

describe('LaunchScreen quantity and courtesy', () => {
  it('launches a manual quantity greater than one', async () => {
    const repository = createRepository()
    const { click, user } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Ana Paula/ }))
    await click(await screen.findByRole('button', {
      name: 'Quantidade e cortesia de Cerveja lata',
    }))
    const quantity = screen.getByLabelText('Quantidade de Cerveja lata')
    await user.clear(quantity)
    await user.type(quantity, '3')
    await click(screen.getByRole('button', { name: 'Confirmar lançamento de Cerveja lata' }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
    expect(launchedConsumptions(await repository.getSnapshot())[0]).toMatchObject({
      itemId: 'item-cerveja', quantity: 3, chargeKind: CHARGE_KIND.CHARGED,
    })
  })

  it('keeps a courtesy in the tab but out of its total', async () => {
    const repository = createRepository()
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Rafael Oliveira/ }))
    await click(await screen.findByRole('button', {
      name: 'Quantidade e cortesia de Água mineral',
    }))
    await click(screen.getByRole('button', { name: 'Lançar cortesia de Água mineral' }))
    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })

    expect(launchedConsumptions(await repository.getSnapshot())[0])
      .toMatchObject({ chargeKind: CHARGE_KIND.COURTESY, quantity: 1 })

    await click(screen.getByRole('button', { name: 'Ver comanda' }))
    const panel = screen.getByRole('complementary', { name: 'Comanda de Rafael Oliveira' })

    // The seeded 2x refrigerante at R$ 6,00 is the whole charged total: the
    // R$ 4,00 courtesy is listed but must not reach the total row.
    expect(within(panel).getByText('Total').parentElement).toHaveTextContent('R$ 12,00')
    expect(within(panel).getByText('Total').parentElement).not.toHaveTextContent('R$ 16,00')
    const courtesy = within(panel).getByText('Cortesias (não somam no total)').parentElement!
    expect(courtesy).toHaveTextContent('1× Água mineral')
    expect(courtesy).toHaveTextContent('R$ 4,00')
    // A visitor tab is settled directly, so its balance is shown.
    expect(within(panel).getByText('Pago').parentElement).toHaveTextContent('R$ 7,00')
    expect(within(panel).getByText('Em aberto').parentElement).toHaveTextContent('R$ 5,00')
  })

  it('groups repeated launches of one item into a single tab line', async () => {
    const repository = createRepository()
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Ana Paula/ }))
    await click(await screen.findByRole('button', { name: 'Lançar Cerveja lata' }))
    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
    await click(screen.getByRole('button', { name: 'Lançar Cerveja lata' }))
    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(2)
    })

    await click(screen.getByRole('button', { name: 'Ver comanda' }))
    const panel = screen.getByRole('complementary', { name: 'Comanda de Ana Paula' })

    // 3 seeded + 2 launched, at R$ 7,00 each, on one grouped line.
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1)
    expect(within(panel).getByRole('listitem')).toHaveTextContent('5× Cerveja lata')
    expect(within(panel).getByRole('listitem')).toHaveTextContent('R$ 35,00')
    expect(within(panel).getByText('Total').parentElement).toHaveTextContent('R$ 35,00')
    // A monthly tab is never settled here: it is charged in the statement.
    expect(panel).toHaveTextContent(
      'O saldo do integrante é cobrado no extrato mensal, após o fechamento.',
    )
    expect(within(panel).queryByText('Em aberto')).not.toBeInTheDocument()
  })
})

describe('LaunchScreen tab availability', () => {
  it('blocks a visitor without an active event and still allows a member', async () => {
    const database = currentMonthDemo()
    const repository = createRepository({
      ...database,
      events: database.events.map((event) => ({ ...event, status: EVENT_STATUS.CLOSED })),
    })
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Rafael Oliveira/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nenhum evento ativo. Visitantes só recebem consumo durante um evento; ' +
        'integrantes continuam disponíveis.',
    )
    expect(screen.queryByRole('button', { name: 'Lançar Cerveja lata' })).not.toBeInTheDocument()

    await click(screen.getByRole('button', { name: 'Trocar consumidor' }))
    await click(await screen.findByRole('button', { name: /Ana Paula/ }))
    await click(await screen.findByRole('button', { name: 'Lançar Cerveja lata' }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
  })

  it('explains a closed monthly tab instead of failing on the tap', async () => {
    const database = currentMonthDemo()
    const repository = createRepository({
      ...database,
      tabs: database.tabs.map((tab) =>
        tab.id === 'tab-ana-2026-09'
          ? { ...tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-30T23:00:00.000Z' }
          : tab,
      ),
    })
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Ana Paula/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A comanda mensal deste integrante já foi fechada. ' +
        'Lançamentos deste mês não são mais aceitos — o saldo é cobrado no extrato.',
    )
    expect(screen.queryByRole('button', { name: 'Lançar Cerveja lata' })).not.toBeInTheDocument()
    expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(0)
  })

  it('shows the real balance of a closed monthly tab instead of calling it empty', async () => {
    const database = currentMonthDemo()
    const repository = createRepository({
      ...database,
      tabs: database.tabs.map((tab) =>
        tab.id === 'tab-ana-2026-09'
          ? { ...tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-30T23:00:00.000Z' }
          : tab,
      ),
    })
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Ana Paula/ }))
    await click(screen.getByRole('button', { name: 'Ver comanda' }))
    const panel = screen.getByRole('complementary', { name: 'Comanda de Ana Paula' })

    // The seeded 3x cerveja at R$ 7,00 is still owed even though the tab is
    // closed. Claiming the tab is empty would be the opposite of the truth.
    expect(panel).not.toHaveTextContent('Nenhum consumo lançado ainda.')
    expect(within(panel).getByRole('listitem')).toHaveTextContent('3× Cerveja lata')
    expect(within(panel).getByText('Total').parentElement).toHaveTextContent('R$ 21,00')
  })

  it('offers no tab panel for a visitor when no event is active', async () => {
    const database = currentMonthDemo()
    const repository = createRepository({
      ...database,
      events: database.events.map((event) => ({ ...event, status: EVENT_STATUS.CLOSED })),
    })
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Rafael Oliveira/ }))

    expect(screen.queryByRole('button', { name: 'Ver comanda' })).not.toBeInTheDocument()
  })

  it('explains a closed visitor tab instead of failing on the tap', async () => {
    const database = currentMonthDemo()
    const repository = createRepository({
      ...database,
      tabs: database.tabs.map((tab) =>
        tab.id === 'tab-rafael-evento'
          ? { ...tab, status: TAB_STATUS.CLOSED, closedAt: '2026-09-19T22:00:00.000Z' }
          : tab,
      ),
    })
    const { click } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: /Rafael Oliveira/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A comanda deste visitante está fechada. Reabra a comanda para lançar consumo.',
    )
  })
})

describe('LaunchScreen visitor registration', () => {
  it('selects the visitor it just created so the next tap registers consumption', async () => {
    const repository = createRepository()
    const { click, user } = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await click(await screen.findByRole('button', { name: 'Novo visitante' }))
    await user.type(screen.getByLabelText('Nome'), 'Carlos Lima')
    await click(screen.getByRole('button', { name: 'Cadastrar visitante' }))

    expect(await screen.findByText('Carlos Lima')).toBeInTheDocument()
    expect(screen.getByText('Visitante')).toBeInTheDocument()

    await click(await screen.findByRole('button', { name: 'Lançar Cerveja lata' }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
    const snapshot = await repository.getSnapshot()
    const visitor = snapshot.consumers.find(({ name }) => name === 'Carlos Lima')!
    expect(launchedConsumptions(snapshot)[0].consumerId).toBe(visitor.id)
  })
})

describe('LaunchScreen recent launches panel', () => {
  async function launchOneForAna() {
    const repository = createRepository()
    const helpers = setupCountingUser()
    renderWithBar(<LancamentosPage />, { repository, route: '/lancamentos' })

    await helpers.click(await screen.findByRole('button', { name: /Ana Paula/ }))
    await helpers.click(await screen.findByRole('button', { name: 'Lançar Cerveja lata' }))
    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(1)
    })
    return { repository, ...helpers }
  }

  it('edits the quantity of a launch of the day', async () => {
    const { repository, click, user } = await launchOneForAna()

    await click(await screen.findByRole('button', {
      name: 'Editar quantidade de Cerveja lata de Ana Paula',
    }))
    const field = screen.getByLabelText('Nova quantidade de Cerveja lata de Ana Paula')
    await user.clear(field)
    await user.type(field, '4')
    await click(screen.getByRole('button', {
      name: 'Salvar quantidade de Cerveja lata de Ana Paula',
    }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())[0].quantity).toBe(4)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Quantidade alterada para 4.')
  })

  it('moves a launch to another consumer', async () => {
    const { repository, click, user } = await launchOneForAna()

    await click(await screen.findByRole('button', {
      name: 'Trocar consumidor de Cerveja lata de Ana Paula',
    }))
    await user.selectOptions(
      screen.getByLabelText('Novo consumidor de Cerveja lata de Ana Paula'),
      'tab-bruno-2026-09',
    )
    await click(screen.getByRole('button', {
      name: 'Confirmar troca de Cerveja lata de Ana Paula',
    }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())[0].consumerId)
        .toBe('member-bruno')
    })
    expect(screen.getByRole('status')).toHaveTextContent('Lançamento movido para Bruno Santos.')
  })

  it('cancels a launch of the day', async () => {
    const { repository, click } = await launchOneForAna()

    await click(await screen.findByRole('button', {
      name: 'Cancelar Cerveja lata de Ana Paula',
    }))

    await waitFor(async () => {
      expect(launchedConsumptions(await repository.getSnapshot())).toHaveLength(0)
    })
    expect(screen.queryByRole('button', {
      name: 'Cancelar Cerveja lata de Ana Paula',
    })).not.toBeInTheDocument()
  })
})
