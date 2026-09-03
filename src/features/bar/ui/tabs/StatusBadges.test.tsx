import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PAYMENT_STATUS, TAB_STATUS } from '../../domain/constants'
import { PaymentStatusBadge, TabStatusBadge } from './StatusBadges'

describe('TabStatusBadge', () => {
  it('shows the pt-BR text for an open tab', () => {
    render(<TabStatusBadge status={TAB_STATUS.OPEN} />)
    expect(screen.getByText('Aberta')).toBeInTheDocument()
  })

  it('shows the pt-BR text for a closed tab', () => {
    render(<TabStatusBadge status={TAB_STATUS.CLOSED} />)
    expect(screen.getByText('Fechada')).toBeInTheDocument()
  })
})

describe('PaymentStatusBadge', () => {
  it('shows the pt-BR text for each payment status, not color alone', () => {
    const { rerender } = render(<PaymentStatusBadge status={PAYMENT_STATUS.UNPAID} />)
    expect(screen.getByText('Não pago')).toBeInTheDocument()

    rerender(<PaymentStatusBadge status={PAYMENT_STATUS.PARTIAL} />)
    expect(screen.getByText('Parcial')).toBeInTheDocument()

    rerender(<PaymentStatusBadge status={PAYMENT_STATUS.PAID} />)
    expect(screen.getByText('Pago')).toBeInTheDocument()
  })
})
