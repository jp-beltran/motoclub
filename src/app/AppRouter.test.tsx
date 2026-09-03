import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { BarRepositoryProvider } from '../features/bar/application/repository-context'
import { createFakeBarRepository } from '../test/fake-bar-repository'
import { AppRouter } from './AppRouter'

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repository = createFakeBarRepository()
  return render(
    <QueryClientProvider client={queryClient}>
      <BarRepositoryProvider repository={repository}>
        <MemoryRouter initialEntries={[path]}>
          <AppRouter />
        </MemoryRouter>
      </BarRepositoryProvider>
    </QueryClientProvider>,
  )
}

describe('AppRouter', () => {
  it('renders the dashboard placeholder at the root route', async () => {
    renderAt('/')

    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeInTheDocument()
  })

  it('renders the lançamentos page when navigating to /lancamentos', async () => {
    renderAt('/lancamentos')

    expect(await screen.findByRole('heading', { name: 'Lançamentos' })).toBeInTheDocument()
    expect(screen.getByText('Em construção.')).toBeInTheDocument()
  })

  it.each([
    ['/consumidores', 'Consumidores'],
    ['/itens', 'Itens'],
    ['/comandas', 'Comandas'],
    ['/fechamento', 'Fechamento'],
    ['/pagamentos', 'Pagamentos'],
    ['/estoque', 'Estoque'],
  ])('renders the %s page heading "%s"', async (path, heading) => {
    renderAt(path)

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })
})
