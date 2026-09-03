import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PAYMENT_STATUS, PAYMENT_TARGET } from '../../domain/constants'
import type { PendingTarget } from './pending-targets'
import { PendingTargetsList } from './PendingTargetsList'

function makeTarget(overrides: Partial<PendingTarget> = {}): PendingTarget {
  return {
    target: PAYMENT_TARGET.TAB,
    targetId: 'tab-rafael',
    label: 'Rafael Oliveira — Encontro de setembro',
    totalCents: 1200,
    payment: { paidCents: 700, remainingCents: 500, status: PAYMENT_STATUS.PARTIAL },
    payments: [],
    ...overrides,
  }
}

describe('PendingTargetsList', () => {
  it('shows an empty state when there is nothing pending', () => {
    render(
      <PendingTargetsList
        targets={[]}
        expandedKey={undefined}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        submittingKey={undefined}
        errorKey={undefined}
        errorMessage={undefined}
      />,
    )
    expect(screen.getByText(/Nenhuma pendência/)).toBeInTheDocument()
  })

  it('renders one row per pending target', () => {
    render(
      <PendingTargetsList
        targets={[
          makeTarget({ targetId: 'tab-rafael', label: 'Rafael Oliveira' }),
          makeTarget({
            target: PAYMENT_TARGET.STATEMENT, targetId: 'statement-ana-2026-09',
            label: 'Ana Paula — setembro de 2026',
          }),
        ]}
        expandedKey={undefined}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        submittingKey={undefined}
        errorKey={undefined}
        errorMessage={undefined}
      />,
    )
    expect(screen.getByText('Rafael Oliveira')).toBeInTheDocument()
    expect(screen.getByText('Ana Paula — setembro de 2026')).toBeInTheDocument()
  })

  it('expands only the row matching expandedKey and toggles with the right key', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(
      <PendingTargetsList
        targets={[
          makeTarget({ targetId: 'tab-rafael', label: 'Rafael Oliveira' }),
          makeTarget({ targetId: 'tab-juliana', label: 'Juliana Costa' }),
        ]}
        expandedKey="tab:tab-rafael"
        onToggle={onToggle}
        onSubmit={vi.fn()}
        submittingKey={undefined}
        errorKey={undefined}
        errorMessage={undefined}
      />,
    )

    // Only the expanded row shows the amount form.
    expect(screen.getAllByRole('textbox', { name: 'Valor do pagamento' })).toHaveLength(1)

    const buttons = screen.getAllByRole('button', { name: 'Registrar pagamento' })
    await user.click(buttons[1])
    expect(onToggle).toHaveBeenCalledWith('tab:tab-juliana')
  })

  it('routes the submit error only to the matching row', () => {
    render(
      <PendingTargetsList
        targets={[
          makeTarget({ targetId: 'tab-rafael', label: 'Rafael Oliveira' }),
          makeTarget({ targetId: 'tab-juliana', label: 'Juliana Costa' }),
        ]}
        expandedKey="tab:tab-rafael"
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        submittingKey={undefined}
        errorKey="tab:tab-rafael"
        errorMessage="O valor informado é maior do que o saldo em aberto."
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'O valor informado é maior do que o saldo em aberto.',
    )
  })
})
