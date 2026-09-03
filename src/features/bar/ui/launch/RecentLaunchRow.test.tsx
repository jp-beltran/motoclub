import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { describeCancellationBlock } from '../../application/error-messages'
import type { RecentLaunch } from '../../application/recent-launches'
import { CANCELLATION_BLOCK } from '../../domain/cancellation'
import {
  CHARGE_KIND,
  CONSUMPTION_STATUS,
  TAB_KIND,
  TAB_STATUS,
} from '../../domain/constants'
import type { ActiveConsumption, Tab } from '../../domain/entities'
import { RecentLaunchRow } from './RecentLaunchRow'

const TAB: Tab = {
  id: 'tab-ana-2026-09',
  kind: TAB_KIND.MONTHLY,
  status: TAB_STATUS.OPEN,
  memberId: 'member-ana',
  month: '2026-09',
  openedAt: '2026-09-01T12:00:00.000Z',
}

const CONSUMPTION: ActiveConsumption = {
  id: 'cons-ana-cerveja',
  tabId: TAB.id,
  consumerId: 'member-ana',
  itemId: 'item-cerveja',
  status: CONSUMPTION_STATUS.ACTIVE,
  chargeKind: CHARGE_KIND.CHARGED,
  quantity: 3,
  unitPriceCents: 700,
  unitCostCents: 350,
  createdAt: '2026-09-19T20:00:00.000Z',
  actorId: 'admin-demo',
}

function makeLaunch(overrides: Partial<RecentLaunch> = {}): RecentLaunch {
  return {
    consumption: CONSUMPTION,
    tab: TAB,
    itemName: 'Cerveja lata',
    consumerName: 'Ana Paula',
    lineTotalCents: 2100,
    isCourtesy: false,
    ...overrides,
  }
}

function renderRow(launch: RecentLaunch, onCancel = vi.fn()) {
  render(
    <ul>
      <RecentLaunchRow
        launch={launch}
        targets={[]}
        onEditQuantity={vi.fn()}
        onReassign={vi.fn()}
        onCancel={onCancel}
      />
    </ul>,
  )
  return { onCancel }
}

const CANCEL_NAME = 'Cancelar Cerveja lata de Ana Paula'
const EDIT_NAME = 'Editar quantidade de Cerveja lata de Ana Paula'

describe('RecentLaunchRow', () => {
  it('offers the corrections while the launch is still freely cancellable', () => {
    renderRow(makeLaunch())

    expect(screen.getByRole('button', { name: CANCEL_NAME })).toBeEnabled()
    expect(screen.getByRole('button', { name: EDIT_NAME })).toBeEnabled()
  })

  it('disables the corrections the repository would refuse', () => {
    renderRow(makeLaunch({ cancellationBlock: CANCELLATION_BLOCK.CONSOLIDATED }))

    expect(screen.getByRole('button', { name: CANCEL_NAME })).toBeDisabled()
    expect(screen.getByRole('button', { name: EDIT_NAME })).toBeDisabled()
  })

  it('states the reason in pt-BR next to the disabled controls', () => {
    renderRow(makeLaunch({ cancellationBlock: CANCELLATION_BLOCK.CLOSED_TAB }))

    expect(
      screen.getByText(describeCancellationBlock(CANCELLATION_BLOCK.CLOSED_TAB)),
    ).toBeInTheDocument()
  })

  it('never fires the cancellation of a blocked launch', async () => {
    const { onCancel } = renderRow(
      makeLaunch({ cancellationBlock: CANCELLATION_BLOCK.SETTLED_PAYMENT }),
    )

    await userEvent.click(screen.getByRole('button', { name: CANCEL_NAME }))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('says nothing about blocking while the launch is correctable', () => {
    renderRow(makeLaunch())

    Object.values(CANCELLATION_BLOCK).forEach((block) => {
      expect(screen.queryByText(describeCancellationBlock(block))).not.toBeInTheDocument()
    })
  })
})
