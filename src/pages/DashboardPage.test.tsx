import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { BarRepository } from '../features/bar/application/bar-repository'
import { BarRepositoryProvider } from '../features/bar/application/repository-context'
import { formatMonth, getCurrentMonth } from '../shared/date'
import { createFakeBarRepository } from '../test/fake-bar-repository'
import { DashboardPage } from './DashboardPage'

function createWrapper(repository: BarRepository) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BarRepositoryProvider repository={repository}>
          <MemoryRouter>{children}</MemoryRouter>
        </BarRepositoryProvider>
      </QueryClientProvider>
    )
  }
}

describe('DashboardPage', () => {
  it('renders the heading and the current month label right away', () => {
    const repository = createFakeBarRepository()

    render(<DashboardPage />, { wrapper: createWrapper(repository) })

    expect(screen.getByRole('heading', { name: 'Painel' })).toBeInTheDocument()
    expect(screen.getByText(formatMonth(getCurrentMonth()))).toBeInTheDocument()
  })

  it('renders the six financial indicators computed from the demo snapshot for the current month', async () => {
    const repository = createFakeBarRepository()

    render(<DashboardPage />, { wrapper: createWrapper(repository) })

    expect(await screen.findByText('R$ 57,00')).toBeInTheDocument() // consumo do mês
    expect(screen.getByText('R$ 7,00')).toBeInTheDocument() // recebido
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument() // pendente
    expect(screen.getByText('R$ 27,60')).toBeInTheDocument() // custo
    expect(screen.getByText('R$ 29,40')).toBeInTheDocument() // lucro
    expect(screen.getByText('51,6%')).toBeInTheDocument() // margem
  })

  it('renders the open tabs count and the low-stock empty state from the demo snapshot', async () => {
    const repository = createFakeBarRepository()

    render(<DashboardPage />, { wrapper: createWrapper(repository) })

    expect(await screen.findByText('5')).toBeInTheDocument()
    expect(screen.getByText('Comandas abertas')).toBeInTheDocument()
    expect(screen.getByText('Nenhum item em estoque crítico')).toBeInTheDocument()
  })
})
