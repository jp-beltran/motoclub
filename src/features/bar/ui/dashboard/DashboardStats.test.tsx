import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DashboardSummary } from '../../application/dashboard-summary'
import { DashboardStats } from './DashboardStats'

const SUMMARY: DashboardSummary = {
  revenueCents: 123_456,
  costCents: 45_678,
  profitCents: 77_778,
  margin: 0.63,
  receivedCents: 70_000,
  pendingCents: 53_456,
  openTabsCount: 3,
  lowStockItems: [],
}

describe('DashboardStats', () => {
  it('renders the six formatted indicators', () => {
    render(<DashboardStats summary={SUMMARY} />)

    expect(screen.getByText('Consumo do mês')).toBeInTheDocument()
    expect(screen.getByText('R$ 1.234,56')).toBeInTheDocument()

    expect(screen.getByText('Recebido')).toBeInTheDocument()
    expect(screen.getByText('R$ 700,00')).toBeInTheDocument()

    expect(screen.getByText('Pendente')).toBeInTheDocument()
    expect(screen.getByText('R$ 534,56')).toBeInTheDocument()

    expect(screen.getByText('Custo')).toBeInTheDocument()
    expect(screen.getByText('R$ 456,78')).toBeInTheDocument()

    expect(screen.getByText('Lucro')).toBeInTheDocument()
    expect(screen.getByText('R$ 777,78')).toBeInTheDocument()

    expect(screen.getByText('Margem')).toBeInTheDocument()
    expect(screen.getByText('63,0%')).toBeInTheDocument()
  })
})
