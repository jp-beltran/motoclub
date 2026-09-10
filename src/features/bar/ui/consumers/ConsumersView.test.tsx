import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { renderWithBar } from '../../../../test/render-with-bar'
import { getCurrentMonth } from '../../../../shared/date'
import {
  CHARGE_KIND,
  CONSUMER_KIND,
  CONSUMPTION_STATUS,
  PAYMENT_TARGET,
  TAB_KIND,
  TAB_STATUS,
} from '../../domain/constants'
import type { Consumer, Consumption, Tab } from '../../domain/entities'
import type { BarDatabase, StorageLike } from '../../application/bar-repository'
import { createDemoDatabase } from '../../infrastructure/demo-seed'
import { LocalBarRepository } from '../../infrastructure/local-bar-repository'
import { ConsumersView } from './ConsumersView'

const CURRENT_MONTH = getCurrentMonth()

const ANA: Consumer = {
  id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER,
  phone: '(11) 98888-1001', active: true,
}
const BRUNO: Consumer = {
  id: 'member-bruno', name: 'Bruno Santos', kind: CONSUMER_KIND.MEMBER, active: true,
}
const RAFAEL: Consumer = {
  id: 'visitor-rafael', name: 'Rafael Oliveira', kind: CONSUMER_KIND.VISITOR,
  phone: '(11) 96666-3003', active: true,
}

const ANA_TAB: Tab = {
  id: 'tab-ana', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
  memberId: ANA.id, month: CURRENT_MONTH, openedAt: '2026-09-01T12:00:00.000Z',
}
const RAFAEL_TAB: Tab = {
  id: 'tab-rafael', kind: TAB_KIND.EVENT, status: TAB_STATUS.OPEN,
  eventId: 'event-1', visitorId: RAFAEL.id, openedAt: '2026-09-19T18:00:00.000Z',
}

function consumption(overrides: Partial<Consumption> & { readonly id: string }): Consumption {
  return {
    tabId: ANA_TAB.id,
    consumerId: ANA.id,
    itemId: 'item-cerveja',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 700,
    unitCostCents: 350,
    createdAt: '2026-09-12T20:00:00.000Z',
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function buildDatabase(overrides: Partial<BarDatabase> = {}): BarDatabase {
  return { ...createDemoDatabase(), ...overrides }
}

/**
 * The seed's roster narrowed to Ana alone, with every row that referenced
 * the other consumers dropped: `LocalBarRepository` revalidates the whole
 * database on read, and a tab pointing at a consumer who is not there is
 * refused as `stored-data-invalid` — so a fixture cannot keep the seed's
 * tabs while replacing its people.
 */
function anaOnlyDatabase(): BarDatabase {
  return buildDatabase({
    consumers: [ANA], tabs: [], consumptions: [], payments: [], stockMovements: [],
  })
}

function renderConsumers(database: BarDatabase) {
  const repository = createFakeBarRepository({}, database)
  return renderWithBar(<ConsumersView />, { repository })
}

/**
 * The real repository over in-memory storage: verifying that a visitor
 * created through the quick form persists and shows back up in the list
 * needs a repository that actually stores it, not a stub that only pretends
 * to (mirrors LaunchScreen.test.tsx's `createRepository`).
 */
function createPersistentRepository(database: BarDatabase) {
  const values = new Map<string, string>([
    ['consumers-test', JSON.stringify({ version: 1, data: database })],
  ])
  const storage: StorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
  let id = 0
  return new LocalBarRepository({
    storage,
    storageKey: 'consumers-test',
    nextId: () => `test-${++id}`,
    now: () => new Date().toISOString(),
  })
}

describe('ConsumersView', () => {
  it("lists each consumer's type, phone and outstanding total, scoped by kind", async () => {
    const database = buildDatabase({
      consumers: [ANA, RAFAEL],
      tabs: [ANA_TAB, RAFAEL_TAB],
      consumptions: [
        consumption({ id: 'c1', quantity: 3 }),
        consumption({
          id: 'c2', tabId: RAFAEL_TAB.id, consumerId: RAFAEL.id, quantity: 2, unitPriceCents: 600,
        }),
      ],
    })
    renderConsumers(database)

    const anaRow = await screen.findByRole('button', { name: /Ana Paula/ })
    expect(within(anaRow).getByText(/Integrante/)).toBeInTheDocument()
    expect(within(anaRow).getByText(/\(11\) 98888-1001/)).toBeInTheDocument()
    expect(within(anaRow).getByText('R$ 21,00')).toBeInTheDocument()

    const rafaelRow = screen.getByRole('button', { name: /Rafael Oliveira/ })
    expect(within(rafaelRow).getByText(/Visitante/)).toBeInTheDocument()
    expect(within(rafaelRow).getByText('R$ 12,00')).toBeInTheDocument()
  })

  it('does not show a phone for a consumer that has none', async () => {
    renderConsumers(buildDatabase({ consumers: [BRUNO], tabs: [], consumptions: [] }))

    const row = await screen.findByRole('button', { name: /Bruno Santos/ })
    expect(within(row).queryByText('undefined')).not.toBeInTheDocument()
  })

  it('filters the list by a name search', async () => {
    const user = userEvent.setup()
    renderConsumers(buildDatabase({ consumers: [ANA, RAFAEL], tabs: [], consumptions: [] }))

    await screen.findByRole('button', { name: /Ana Paula/ })
    await user.type(screen.getByLabelText('Buscar por nome'), 'rafael')

    expect(screen.queryByRole('button', { name: /Ana Paula/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rafael Oliveira/ })).toBeInTheDocument()
  })

  it('filters the list by kind', async () => {
    const user = userEvent.setup()
    renderConsumers(buildDatabase({ consumers: [ANA, RAFAEL], tabs: [], consumptions: [] }))

    await screen.findByRole('button', { name: /Ana Paula/ })
    await user.click(screen.getByRole('button', { name: 'Visitantes' }))

    expect(screen.queryByRole('button', { name: /Ana Paula/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rafael Oliveira/ })).toBeInTheDocument()
  })

  it('shows an EmptyState when the search has no results', async () => {
    const user = userEvent.setup()
    renderConsumers(buildDatabase({ consumers: [ANA], tabs: [], consumptions: [] }))

    await screen.findByRole('button', { name: /Ana Paula/ })
    await user.type(screen.getByLabelText('Buscar por nome'), 'zzz')

    expect(screen.getByText('Nenhum consumidor encontrado')).toBeInTheDocument()
  })

  /**
   * The gap the user found by testing the app: "a opção é apenas de
   * visitante". `/consumidores` is now the register — the kind is picked
   * explicitly, and an integrante is the default because that is the one
   * that could not be created at all.
   *
   * These run against the real `LocalBarRepository` over in-memory storage:
   * a registration that only a stub confirmed would prove nothing about
   * what is stored, and the refusals below have to be the domain's own.
   */
  it.each([
    ['Integrante', 'Integrante'],
    ['Visitante', 'Visitante'],
  ])('registers a %s through the form and lists them as such', async (kindLabel, rowLabel) => {
    const user = userEvent.setup()
    renderWithBar(<ConsumersView />, {
      repository: createPersistentRepository(anaOnlyDatabase()),
    })

    await screen.findByRole('button', { name: /Ana Paula/ })
    await user.click(screen.getByRole('button', { name: 'Cadastrar consumidor' }))
    const form = screen.getByRole('form', { name: 'Cadastrar consumidor' })
    await user.click(within(form).getByRole('radio', { name: kindLabel }))
    await user.type(within(form).getByLabelText('Nome'), 'Marcos Silva')
    await user.type(within(form).getByLabelText('Telefone (opcional)'), '(11) 90000-0000')
    await user.click(within(form).getByRole('button', { name: 'Cadastrar' }))

    const row = await screen.findByRole('button', { name: /Marcos Silva/ })
    expect(within(row).getByText(new RegExp(rowLabel))).toBeInTheDocument()
    expect(within(row).getByText(/\(11\) 90000-0000/)).toBeInTheDocument()
  })

  it('defaults the new consumer to integrante', async () => {
    const user = userEvent.setup()
    renderWithBar(<ConsumersView />, {
      repository: createPersistentRepository(anaOnlyDatabase()),
    })

    await user.click(await screen.findByRole('button', { name: 'Cadastrar consumidor' }))

    expect(screen.getByRole('radio', { name: 'Integrante' })).toBeChecked()
  })

  it('shows the domain refusal for an empty name instead of a message of its own', async () => {
    const user = userEvent.setup()
    renderWithBar(<ConsumersView />, {
      repository: createPersistentRepository(anaOnlyDatabase()),
    })

    await user.click(await screen.findByRole('button', { name: 'Cadastrar consumidor' }))
    const form = screen.getByRole('form', { name: 'Cadastrar consumidor' })
    await user.type(within(form).getByLabelText('Nome'), '   ')
    await user.click(within(form).getByRole('button', { name: 'Cadastrar' }))

    expect(await within(form).findByRole('alert'))
      .toHaveTextContent('Informe o nome do consumidor.')
  })

  it('reports a duplicate integrante name in pt-BR and keeps the form open', async () => {
    const user = userEvent.setup()
    renderWithBar(<ConsumersView />, {
      repository: createPersistentRepository(anaOnlyDatabase()),
    })

    await user.click(await screen.findByRole('button', { name: 'Cadastrar consumidor' }))
    const form = screen.getByRole('form', { name: 'Cadastrar consumidor' })
    await user.type(within(form).getByLabelText('Nome'), 'ana paula')
    await user.click(within(form).getByRole('button', { name: 'Cadastrar' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Já existe um integrante com esse nome. Use um nome que diferencie os dois.',
    )
    expect(within(form).getByLabelText('Nome')).toHaveValue('ana paula')
  })

  it('corrects a mistyped name and phone from the consumer detail', async () => {
    const user = userEvent.setup()
    renderWithBar(<ConsumersView />, {
      repository: createPersistentRepository(anaOnlyDatabase()),
    })

    await user.click(await screen.findByRole('button', { name: /Ana Paula/ }))
    const detail = await screen.findByRole('region', { name: /Ana Paula/ })
    await user.click(within(detail).getByRole('button', { name: 'Corrigir dados' }))

    const form = screen.getByRole('form', { name: /Corrigir dados de Ana Paula/ })
    await user.clear(within(form).getByLabelText('Nome'))
    await user.type(within(form).getByLabelText('Nome'), 'Ana Paula Souza')
    await user.clear(within(form).getByLabelText('Telefone (opcional)'))
    await user.click(within(form).getByRole('button', { name: 'Salvar' }))

    const row = await screen.findByRole('button', { name: /Ana Paula Souza/ })
    // The phone was cleared, not replaced by an empty-looking value.
    expect(within(row).queryByText(/98888-1001/)).not.toBeInTheDocument()
  })

  /**
   * The user's ruling in the register itself: deactivating an integrante
   * who still owes money is allowed, and the debt stays on screen. What
   * disappears is the ability to launch new consumption for them, which
   * `/lancamentos` covers.
   */
  it('deactivates a consumer who still owes money, keeping the debt on screen', async () => {
    const user = userEvent.setup()
    renderWithBar(<ConsumersView />, {
      repository: createPersistentRepository(
        buildDatabase({
          consumers: [ANA],
          tabs: [ANA_TAB],
          consumptions: [consumption({ id: 'c1', quantity: 3 })],
          payments: [],
          stockMovements: [],
        }),
      ),
    })

    await user.click(await screen.findByRole('button', { name: /Ana Paula/ }))
    const detail = await screen.findByRole('region', { name: /Ana Paula/ })
    expect(within(detail).getByText('Total em aberto').parentElement)
      .toHaveTextContent('R$ 21,00')

    await user.click(within(detail).getByRole('button', { name: 'Desativar' }))

    const inactiveRow = await screen.findByRole('button', { name: /Ana Paula/ })
    expect(within(inactiveRow).getByText('Inativo')).toBeInTheDocument()
    // R$ 21,00 still owed, in the list row and in the detail panel.
    expect(within(inactiveRow).getByText('R$ 21,00')).toBeInTheDocument()
    const inactiveDetail = screen.getByRole('region', { name: /Ana Paula/ })
    expect(within(inactiveDetail).getByText('Total em aberto').parentElement)
      .toHaveTextContent('R$ 21,00')

    await user.click(
      within(screen.getByRole('region', { name: /Ana Paula/ }))
        .getByRole('button', { name: 'Reativar' }),
    )
    await waitFor(() => {
      expect(screen.queryByText('Inativo')).not.toBeInTheDocument()
    })
  })

  it("shows the selected consumer's history, marking a cancelled item and leaving it out of the total", async () => {
    const database = buildDatabase({
      consumers: [ANA],
      tabs: [ANA_TAB],
      consumptions: [
        consumption({ id: 'c1', quantity: 1, createdAt: '2026-09-12T20:00:00.000Z' }),
        consumption({
          id: 'c2', itemId: 'item-agua', unitPriceCents: 400, quantity: 1,
          createdAt: '2026-09-12T20:05:00.000Z',
        }),
        consumption({
          id: 'c3', quantity: 5, createdAt: '2026-09-13T20:00:00.000Z',
          status: CONSUMPTION_STATUS.CANCELLED,
          cancelledAt: '2026-09-13T21:00:00.000Z', cancelledByActorId: 'admin-demo',
        }),
      ],
    })
    const user = userEvent.setup()
    renderConsumers(database)

    await user.click(await screen.findByRole('button', { name: /Ana Paula/ }))

    const detail = await screen.findByRole('region', { name: /Ana Paula/ })
    expect(within(detail).getByText('Cancelado')).toBeInTheDocument()
    // The cancelled line still shows its own value (5 × R$ 7,00 = R$ 35,00)...
    expect(within(detail).getByText('R$ 35,00')).toBeInTheDocument()
    // ...but only the two active lines (R$ 7,00 + R$ 4,00 = R$ 11,00) count
    // toward the outstanding total — never R$ 46,00, which is what summing
    // every line including the cancelled one would (wrongly) produce.
    expect(within(detail).getByText('R$ 11,00')).toBeInTheDocument()
    expect(within(detail).queryByText('R$ 46,00')).not.toBeInTheDocument()
  })

  it('reports a payment already made against a visitor event tab in their outstanding total', async () => {
    const database = buildDatabase({
      consumers: [RAFAEL],
      tabs: [RAFAEL_TAB],
      consumptions: [
        consumption({
          id: 'c1', tabId: RAFAEL_TAB.id, consumerId: RAFAEL.id, quantity: 2, unitPriceCents: 600,
        }),
      ],
      payments: [
        {
          id: 'payment-1', target: PAYMENT_TARGET.TAB, targetId: RAFAEL_TAB.id,
          amountCents: 500, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo',
        },
      ],
    })
    renderConsumers(database)

    const row = await screen.findByRole('button', { name: /Rafael Oliveira/ })
    // Due 1200, paid 500 -> outstanding 700.
    expect(within(row).getByText('R$ 7,00')).toBeInTheDocument()
  })
})
