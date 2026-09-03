import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { formatDateTime } from '../../../../shared/format'
import { PAYMENT_STATUS, PAYMENT_TARGET } from '../../domain/constants'
import type { PendingTarget } from './pending-targets'
import { PendingTargetRow } from './PendingTargetRow'

function makeTarget(overrides: Partial<PendingTarget> = {}): PendingTarget {
  return {
    target: PAYMENT_TARGET.TAB,
    targetId: 'tab-rafael',
    label: 'Rafael Oliveira — Encontro de setembro',
    totalCents: 1200,
    payment: { paidCents: 700, remainingCents: 500, status: PAYMENT_STATUS.PARTIAL },
    payments: [
      { id: 'p1', target: PAYMENT_TARGET.TAB, targetId: 'tab-rafael', amountCents: 700, paidAt: '2026-09-19T21:00:00.000Z', actorId: 'admin-demo' },
    ],
    ...overrides,
  }
}

describe('PendingTargetRow', () => {
  it('shows the target label, total, paid, remaining and payment status', () => {
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded={false}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText('Rafael Oliveira — Encontro de setembro')).toBeInTheDocument()
    expect(screen.getByText('R$ 12,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 7,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 5,00')).toBeInTheDocument()
    expect(screen.getByText('Parcial')).toBeInTheDocument()
  })

  it('does not show the amount form until expanded', () => {
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded={false}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )
    expect(screen.queryByRole('textbox', { name: 'Valor do pagamento' })).not.toBeInTheDocument()
  })

  it('calls onToggle when the action button is clicked', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded={false}
        onToggle={onToggle}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('shows the amount form and payment history when expanded', () => {
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Valor do pagamento' })).toBeInTheDocument()
    expect(screen.getAllByText('R$ 7,00').length).toBeGreaterThan(0)
  })

  it('rejects an invalid amount before calling onSubmit', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded
        onToggle={vi.fn()}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Valor do pagamento' }), '0')
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))

    expect(await screen.findByText('Informe um valor de pagamento válido, maior que zero.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects an amount above the remaining balance before calling onSubmit', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded
        onToggle={vi.fn()}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Valor do pagamento' }), '9,00')
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))

    expect(
      await screen.findByText(/maior do que o saldo em aberto \(R\$ 5,00\)/),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with the amount in cents for a valid partial amount', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded
        onToggle={vi.fn()}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Valor do pagamento' }), '5,00')
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))

    expect(onSubmit).toHaveBeenCalledWith(500)
  })

  it('shows the repository error message without breaking the screen', () => {
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
        submitErrorMessage="O valor informado é maior do que o saldo em aberto."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'O valor informado é maior do que o saldo em aberto.',
    )
    expect(screen.getByRole('button', { name: 'Confirmar pagamento' })).toBeInTheDocument()
  })

  it('lists the target payment history with date, amount and responsible', () => {
    render(
      <PendingTargetRow
        target={makeTarget()}
        expanded
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText(formatDateTime('2026-09-19T21:00:00.000Z'))).toBeInTheDocument()
    expect(screen.getByText('Gestor')).toBeInTheDocument()
  })
})
