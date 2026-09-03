import { screen, within } from '@testing-library/react'
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

  it('adds a visitor created through the quick form to the list', async () => {
    const database = buildDatabase({
      consumers: [ANA], tabs: [], consumptions: [], payments: [], stockMovements: [],
    })
    const repository = createPersistentRepository(database)
    const user = userEvent.setup()
    renderWithBar(<ConsumersView />, { repository })

    await screen.findByRole('button', { name: /Ana Paula/ })
    await user.click(screen.getByRole('button', { name: 'Novo visitante' }))
    await user.type(screen.getByLabelText('Nome'), 'Carlos Lima')
    await user.click(screen.getByRole('button', { name: 'Cadastrar visitante' }))

    expect(await screen.findByRole('button', { name: /Carlos Lima/ })).toBeInTheDocument()
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
