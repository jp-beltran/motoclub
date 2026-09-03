import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BarDatabase } from '../../application/bar-repository'
import { CHARGE_KIND, CONSUMER_KIND, CONSUMPTION_STATUS, TAB_KIND, TAB_STATUS } from '../../domain/constants'
import type { Consumption, MemberStatement, MonthlyClosing } from '../../domain/entities'
import type { MonthlyConsolidation } from '../../domain/monthly-closing'
import { createFakeBarRepository } from '../../../../test/fake-bar-repository'
import { renderWithBar } from '../../../../test/render-with-bar'
import { formatMonth, getCurrentMonth } from '../../../../shared/date'
import { ClosingScreen } from './ClosingScreen'

const MONTH = getCurrentMonth()
const PREVIOUS_MONTH = previousMonthOf(MONTH)

function previousMonthOf(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return getCurrentMonth(new Date(year, monthNumber - 2, 1))
}

/**
 * `getMonthKey` is local-time based and `ClosingScreen` asks for whatever
 * `getCurrentMonth()` returns when the suite runs, so every fixture date
 * here is derived from that same month instead of a hardcoded one — the
 * tests hold on any date, not only while today happens to be within a
 * specific month.
 */
function isoInMonth(day: number, hour = 12): string {
  const [year, month] = MONTH.split('-').map(Number)
  return new Date(year, month - 1, day, hour, 0).toISOString()
}

function isoInPreviousMonth(day: number, hour = 12): string {
  const [year, month] = PREVIOUS_MONTH.split('-').map(Number)
  return new Date(year, month - 1, day, hour, 0).toISOString()
}

function emptyDatabase(): BarDatabase {
  return {
    consumers: [],
    items: [],
    events: [],
    tabs: [],
    consumptions: [],
    payments: [],
    stockMovements: [],
    monthlyClosings: [],
    memberStatements: [],
  }
}

function consumptionFixture(
  overrides: Partial<Consumption> & { readonly id: string; readonly consumerId: string; readonly tabId: string },
): Consumption {
  return {
    itemId: 'item-cerveja',
    status: CONSUMPTION_STATUS.ACTIVE,
    chargeKind: CHARGE_KIND.CHARGED,
    quantity: 1,
    unitPriceCents: 700,
    unitCostCents: 350,
    createdAt: isoInMonth(12),
    actorId: 'admin-demo',
    ...overrides,
  } as Consumption
}

function baseDatabase(): BarDatabase {
  const anaConsumption = consumptionFixture({
    id: 'c1', consumerId: 'member-ana', tabId: 'tab-ana', quantity: 3,
  })
  const brunoConsumption = consumptionFixture({
    id: 'c2', consumerId: 'member-bruno', tabId: 'tab-bruno', quantity: 1,
  })

  return {
    ...emptyDatabase(),
    consumers: [
      { id: 'member-ana', name: 'Ana Paula', kind: CONSUMER_KIND.MEMBER, active: true },
      { id: 'member-bruno', name: 'Bruno Santos', kind: CONSUMER_KIND.MEMBER, active: true },
      { id: 'member-celia', name: 'Célia Martins', kind: CONSUMER_KIND.MEMBER, active: true },
    ],
    items: [
      { id: 'item-cerveja', name: 'Cerveja lata', unitCostCents: 350, unitPriceCents: 700 },
    ],
    tabs: [
      {
        id: 'tab-ana', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
        memberId: 'member-ana', month: MONTH, openedAt: isoInMonth(1),
      },
      {
        id: 'tab-bruno', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
        memberId: 'member-bruno', month: MONTH, openedAt: isoInMonth(1),
      },
      {
        id: 'tab-celia', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
        memberId: 'member-celia', month: MONTH, openedAt: isoInMonth(1),
      },
    ],
    consumptions: [anaConsumption, brunoConsumption],
  }
}

describe('ClosingScreen', () => {
  it('renders the heading and the current month label', async () => {
    renderWithBar(<ClosingScreen />, {
      repository: createFakeBarRepository({}, baseDatabase()),
    })

    expect(await screen.findByRole('heading', { name: 'Fechamento' })).toBeInTheDocument()
  })

  it('previews only members with consumption in the month, before anything is saved', async () => {
    renderWithBar(<ClosingScreen />, {
      repository: createFakeBarRepository({}, baseDatabase()),
    })

    expect(await screen.findByText('Ana Paula')).toBeInTheDocument()
    expect(screen.getByText('Bruno Santos')).toBeInTheDocument()
    expect(screen.queryByText('Célia Martins')).not.toBeInTheDocument()
  })

  it('closes the month through the repository exactly once and then shows the statements', async () => {
    let database = baseDatabase()
    const closing: MonthlyClosing = {
      id: 'closing-1', month: MONTH,
      statementIds: ['statement-ana', 'statement-bruno'],
      closedAt: isoInMonth(28), actorId: 'admin-demo',
    }
    const statements: MemberStatement[] = [
      {
        id: 'statement-ana', memberId: 'member-ana', month: MONTH,
        consumptions: [database.consumptions[0]], createdAt: isoInMonth(28),
      },
      {
        id: 'statement-bruno', memberId: 'member-bruno', month: MONTH,
        consumptions: [database.consumptions[1]], createdAt: isoInMonth(28),
      },
    ]
    const consolidation: MonthlyConsolidation = { closing, statements }
    const createMonthlyClosing = vi.fn(async () => {
      database = {
        ...database,
        monthlyClosings: [...database.monthlyClosings, closing],
        memberStatements: [...database.memberStatements, ...statements],
      }
      return consolidation
    })
    const repository = createFakeBarRepository({
      createMonthlyClosing,
      getSnapshot: vi.fn(async () => structuredClone(database)),
    })
    const user = userEvent.setup()

    renderWithBar(<ClosingScreen />, { repository })

    await screen.findByText('Ana Paula')
    await user.click(screen.getByRole('button', { name: 'Fechar mês' }))
    expect(createMonthlyClosing).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirmar fechamento' }))

    await waitFor(() => expect(createMonthlyClosing).toHaveBeenCalledTimes(1))
    expect(createMonthlyClosing).toHaveBeenCalledWith({ month: MONTH, actorId: 'admin-demo' })
    expect(await screen.findByText(/Fechado em/)).toBeInTheDocument()
    expect(screen.getByText('Ana Paula')).toBeInTheDocument()
    expect(createMonthlyClosing).toHaveBeenCalledTimes(1)
  })

  it('requires an explicit confirmation before closing the month, naming the month and the tab effect', async () => {
    const createMonthlyClosing = vi.fn()
    const repository = createFakeBarRepository({ createMonthlyClosing }, baseDatabase())
    const user = userEvent.setup()

    renderWithBar(<ClosingScreen />, { repository })

    await screen.findByText('Ana Paula')
    await user.click(screen.getByRole('button', { name: 'Fechar mês' }))

    expect(createMonthlyClosing).not.toHaveBeenCalled()
    const confirmation = screen.getByText(/irreversível/i)
    expect(confirmation).toHaveTextContent(/comandas mensais/i)
    expect(confirmation).toHaveTextContent(formatMonth(MONTH))
    expect(screen.getByRole('button', { name: 'Confirmar fechamento' })).toBeInTheDocument()
  })

  it('cancels the close confirmation without calling the repository', async () => {
    const createMonthlyClosing = vi.fn()
    const repository = createFakeBarRepository({ createMonthlyClosing }, baseDatabase())
    const user = userEvent.setup()

    renderWithBar(<ClosingScreen />, { repository })

    await screen.findByText('Ana Paula')
    await user.click(screen.getByRole('button', { name: 'Fechar mês' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(createMonthlyClosing).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Fechar mês' })).toBeInTheDocument()
  })

  it('defaults the month picker to the current month', async () => {
    renderWithBar(<ClosingScreen />, {
      repository: createFakeBarRepository({}, baseDatabase()),
    })

    const picker = await screen.findByLabelText('Mês do fechamento')
    expect(picker).toHaveValue(MONTH)
  })

  it('offers an earlier month that still has consumption nobody closed', async () => {
    const database = baseDatabase()
    database.tabs = [...database.tabs, {
      id: 'tab-ana-previous', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: 'member-ana', month: PREVIOUS_MONTH, openedAt: isoInPreviousMonth(1),
    }]
    database.consumptions = [...database.consumptions, consumptionFixture({
      id: 'c-previous', consumerId: 'member-ana', tabId: 'tab-ana-previous',
      quantity: 2, createdAt: isoInPreviousMonth(12),
    })]

    renderWithBar(<ClosingScreen />, {
      repository: createFakeBarRepository({}, database),
    })

    const picker = await screen.findByLabelText('Mês do fechamento')
    expect(
      [...picker.querySelectorAll('option')].map((option) => option.value),
    ).toEqual([MONTH, PREVIOUS_MONTH])
  })

  it('closes whichever month the operator picked, not the current one', async () => {
    const database = baseDatabase()
    database.tabs = [...database.tabs, {
      id: 'tab-ana-previous', kind: TAB_KIND.MONTHLY, status: TAB_STATUS.OPEN,
      memberId: 'member-ana', month: PREVIOUS_MONTH, openedAt: isoInPreviousMonth(1),
    }]
    database.consumptions = [...database.consumptions, consumptionFixture({
      id: 'c-previous', consumerId: 'member-ana', tabId: 'tab-ana-previous',
      quantity: 2, createdAt: isoInPreviousMonth(12),
    })]
    const createMonthlyClosing = vi.fn()
    const repository = createFakeBarRepository({ createMonthlyClosing }, database)
    const user = userEvent.setup()

    renderWithBar(<ClosingScreen />, { repository })

    await user.selectOptions(await screen.findByLabelText('Mês do fechamento'), PREVIOUS_MONTH)
    await user.click(screen.getByRole('button', { name: 'Fechar mês' }))
    expect(screen.getByText(/irreversível/i)).toHaveTextContent(formatMonth(PREVIOUS_MONTH))

    await user.click(screen.getByRole('button', { name: 'Confirmar fechamento' }))

    await waitFor(() =>
      expect(createMonthlyClosing).toHaveBeenCalledWith({
        month: PREVIOUS_MONTH, actorId: 'admin-demo',
      }),
    )
  })

  it("still reaches an earlier month's frozen statements once the calendar rolled over", async () => {
    const database = baseDatabase()
    database.monthlyClosings = [{
      id: 'closing-previous', month: PREVIOUS_MONTH, statementIds: ['statement-ana-previous'],
      closedAt: isoInMonth(1), actorId: 'admin-demo',
    }]
    database.memberStatements = [{
      id: 'statement-ana-previous', memberId: 'member-ana', month: PREVIOUS_MONTH,
      consumptions: [consumptionFixture({
        id: 'c-previous', consumerId: 'member-ana', tabId: 'tab-ana-previous',
        quantity: 2, createdAt: isoInPreviousMonth(12),
      })],
      createdAt: isoInMonth(1),
    }]
    const user = userEvent.setup()

    renderWithBar(<ClosingScreen />, {
      repository: createFakeBarRepository({}, database),
    })

    await user.selectOptions(await screen.findByLabelText('Mês do fechamento'), PREVIOUS_MONTH)

    expect(await screen.findByText(/já foi fechado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar mês' })).toBeDisabled()
    expect(screen.getByText('Total: R$ 14,00')).toBeInTheDocument()
  })

  it('cannot close a month that already has a closing, and explains why', async () => {
    const database = baseDatabase()
    const closing: MonthlyClosing = {
      id: 'closing-1', month: MONTH, statementIds: ['statement-ana'],
      closedAt: isoInMonth(28), actorId: 'admin-demo',
    }
    database.monthlyClosings = [closing]
    database.memberStatements = [{
      id: 'statement-ana', memberId: 'member-ana', month: MONTH,
      consumptions: [database.consumptions[0]], createdAt: isoInMonth(28),
    }]
    const createMonthlyClosing = vi.fn()
    const repository = createFakeBarRepository({ createMonthlyClosing }, database)

    renderWithBar(<ClosingScreen />, { repository })

    const closeButton = await screen.findByRole('button', { name: 'Fechar mês' })
    expect(closeButton).toBeDisabled()
    expect(screen.getByText(/já foi fechado/i)).toBeInTheDocument()
    expect(screen.getByText('Ana Paula')).toBeInTheDocument()
    expect(createMonthlyClosing).not.toHaveBeenCalled()
  })
})
