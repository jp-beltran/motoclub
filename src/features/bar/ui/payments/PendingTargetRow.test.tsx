import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { formatDateTime } from '../../../../shared/format'
import { getPaymentStatusTone } from '../../application/payment-status'
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

  it('colors the payment status per status, matching the shared tone used on /comandas', () => {
    const { rerender } = render(
      <PendingTargetRow
        target={makeTarget({ payment: { paidCents: 0, remainingCents: 1200, status: PAYMENT_STATUS.UNPAID } })}
        expanded={false}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )
    expect(screen.getByText('Não pago')).toHaveClass(getPaymentStatusTone(PAYMENT_STATUS.UNPAID))

    rerender(
      <PendingTargetRow
        target={makeTarget({ payment: { paidCents: 1200, remainingCents: 0, status: PAYMENT_STATUS.PAID } })}
        expanded={false}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )
    // Paid must never render with the same tone as unpaid/partial — this
    // regresses if the row goes back to hardcoding one tone for every status.
    // Scoped to <p> — "Pago" also appears as the "Pago" money field's <span> label.
    const paidStatus = screen.getByText('Pago', { selector: 'p' })
    expect(paidStatus).toHaveClass(getPaymentStatusTone(PAYMENT_STATUS.PAID))
    expect(paidStatus).not.toHaveClass('text-warning')
  })

  it('labels the target kind, comanda or extrato mensal, so it cannot be mistaken for the other', () => {
    const { rerender } = render(
      <PendingTargetRow
        target={makeTarget({ target: PAYMENT_TARGET.TAB, label: 'Rafael Oliveira — Encontro de setembro' })}
        expanded={false}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )
    expect(screen.getByText('Comanda')).toBeInTheDocument()

    rerender(
      <PendingTargetRow
        target={makeTarget({
          target: PAYMENT_TARGET.STATEMENT, targetId: 'statement-ana-2026-09',
          label: 'Ana Paula — setembro de 2026',
        })}
        expanded={false}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    )
    expect(screen.getByText('Extrato mensal')).toBeInTheDocument()
  })
})
